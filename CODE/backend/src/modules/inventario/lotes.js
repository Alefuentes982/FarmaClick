import { Router } from 'express';
import { pool, withTx } from '../../core/db.js';
import { HttpError } from '../../core/errors.js';
import { formatoNumero } from '../../core/documentos.js';
import { likeParam, listResponse, paging, uuid } from '../../core/sql.js';
import { z } from 'zod';
import { bloquearLote, bloquearProducto, insertarMovimiento } from './movimientos.js';

const r = Router();

const ESTADOS = ['vigente', 'por_vencer', 'vencido', 'sin_vencimiento'];

// Lotes con su estado de vencimiento: vencido, por_vencer (dentro de `dias`, 30 por defecto), vigente o sin_vencimiento.
// Por defecto solo muestra lotes con stock; con_stock=false incluye los agotados.
r.get('/', async (req, res) => {
  const { limit, page, offset } = paging(req.query);
  const dias = Math.min(Math.max(parseInt(req.query.dias) || 30, 1), 365);
  const estado = ESTADOS.includes(req.query.estado) ? req.query.estado : null;
  const conStock = req.query.con_stock !== 'false';
  const { rows } = await pool.query(
    `WITH hoy AS (SELECT (NOW() AT TIME ZONE 'America/Santiago')::date AS d),
          base AS (
            SELECT l.id, l.numero_lote, l.fecha_vencimiento, l.fecha_ingreso, l.cantidad_recibida, l.cantidad_actual,
                   p.id AS producto_id, p.sku, p.nombre AS producto, s.id AS sucursal_id, s.nombre AS sucursal,
                   oc.numero AS orden_compra_numero,
                   CASE WHEN l.fecha_vencimiento IS NULL THEN 'sin_vencimiento'
                        WHEN l.fecha_vencimiento < hoy.d THEN 'vencido'
                        WHEN l.fecha_vencimiento <= hoy.d + $5::int THEN 'por_vencer'
                        ELSE 'vigente' END AS estado,
                   (l.fecha_vencimiento - hoy.d) AS dias_para_vencer
              FROM lote l CROSS JOIN hoy
              JOIN producto p ON p.id = l.producto_id
              JOIN sucursal s ON s.id = l.sucursal_id
              LEFT JOIN orden_compra_detalle d ON d.id = l.orden_compra_detalle_id
              LEFT JOIN orden_compra oc ON oc.id = d.orden_compra_id)
     SELECT COUNT(*) OVER() AS total_filas, b.*
       FROM base b
      WHERE ($1::uuid IS NULL OR b.sucursal_id = $1)
        AND ($2::uuid IS NULL OR b.producto_id = $2)
        AND ($3::text IS NULL OR b.sku ILIKE $3 OR b.producto ILIKE $3 OR b.numero_lote ILIKE $3)
        AND ($4::text IS NULL OR b.estado = $4)
        AND (NOT $6::boolean OR b.cantidad_actual > 0)
      ORDER BY b.fecha_vencimiento NULLS LAST, b.producto LIMIT $7 OFFSET $8`,
    [req.query.sucursal_id || null, req.query.producto_id || null, likeParam(req.query.q), estado, dias, conStock, limit, offset]);
  res.json(listResponse(
    rows.map((l) => ({ ...l, orden_compra: l.orden_compra_numero ? formatoNumero('OC', l.orden_compra_numero) : null })),
    { page, limit }));
});

const OBS_VENCIDO = 'Baja por vencimiento';

// Da de baja lo que queda de un lote vencido (movimiento "Producto vencido"). Lo mismo que hace el job nocturno
// fn_baja_lotes_vencidos, pero a pedido (en modo local no hay pg_cron).
async function darDeBaja(db, loteId, usuarioId) {
  const lote = await bloquearLote(db, loteId);
  if (!lote.vencido) throw new HttpError(409, 'El lote no está vencido.');
  if (lote.cantidad_actual <= 0) throw new HttpError(409, 'El lote ya no tiene stock.');
  await insertarMovimiento(db, {
    productoId: lote.producto_id, sucursalId: lote.sucursal_id, cantidad: lote.cantidad_actual,
    motivo: 'Producto vencido', loteId: lote.id, usuarioId, observacion: OBS_VENCIDO,
  });
  return lote.cantidad_actual;
}

r.post('/:id/baja-vencido', async (req, res) => {
  const { rows } = await pool.query('SELECT producto_id FROM lote WHERE id = $1', [req.params.id]);
  if (!rows[0]) throw new HttpError(404, 'Lote no encontrado.');
  const unidades = await withTx(req.usuarioId, async (db) => {
    await bloquearProducto(db, rows[0].producto_id); // producto antes que lote
    return darDeBaja(db, req.params.id, req.usuarioId);
  });
  res.json({ lotes: 1, unidades });
});

// Baja de todos los lotes vencidos con stock (opcionalmente de una sucursal).
r.post('/bajas-vencidos', async (req, res) => {
  const { sucursal_id } = z.object({ sucursal_id: uuid.nullish() }).parse(req.body ?? {});
  const resultado = await withTx(req.usuarioId, async (db) => {
    const { rows } = await db.query(
      `SELECT l.producto_id, l.id FROM lote l
        WHERE l.cantidad_actual > 0 AND l.fecha_vencimiento < (NOW() AT TIME ZONE 'America/Santiago')::date
          AND ($1::uuid IS NULL OR l.sucursal_id = $1)
        ORDER BY l.producto_id, l.id`, [sucursal_id ?? null]);
    let unidades = 0;
    let bloqueado = null;
    for (const l of rows) {
      if (l.producto_id !== bloqueado) { await bloquearProducto(db, l.producto_id); bloqueado = l.producto_id; }
      unidades += await darDeBaja(db, l.id, req.usuarioId);
    }
    return { lotes: rows.length, unidades };
  });
  res.json(resultado);
});

export default r;
