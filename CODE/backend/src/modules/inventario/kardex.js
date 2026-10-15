import { Router } from 'express';
import { pool } from '../../core/db.js';
import { formatoNumero } from '../../core/documentos.js';
import { condicionRango, rangoFechas } from '../../core/fechas.js';
import { likeParam, listResponse, paging } from '../../core/sql.js';

const r = Router();

// Kardex: historial inmutable de movimientos. cantidad es siempre positiva; `signo` (+1 entrada, -1 salida)
// viene del tipo de movimiento y `cantidad_signada` ya lo aplica.
r.get('/', async (req, res) => {
  const { limit, page, offset } = paging(req.query);
  const { desde, hasta } = rangoFechas(req.query);
  const tipo = ['Entrada', 'Salida'].includes(req.query.tipo) ? req.query.tipo : null;
  const { rows } = await pool.query(
    `SELECT COUNT(*) OVER() AS total_filas, m.id, m.fecha, m.cantidad, (m.cantidad * t.signo)::int AS cantidad_signada,
            t.nombre AS tipo, t.signo, mm.nombre AS motivo, m.observacion,
            p.id AS producto_id, p.sku, p.nombre AS producto, s.id AS sucursal_id, s.nombre AS sucursal,
            l.numero_lote, l.fecha_vencimiento, u.nombre AS usuario,
            oc.numero AS orden_compra_numero, ped.numero AS pedido_numero
       FROM movimiento_inventario m
       JOIN motivo_movimiento mm ON mm.id = m.motivo_movimiento_id
       JOIN tipo_movimiento t ON t.id = mm.tipo_movimiento_id
       JOIN producto p ON p.id = m.producto_id
       JOIN sucursal s ON s.id = m.sucursal_id
       JOIN lote l ON l.id = m.lote_id
       JOIN usuario u ON u.id = m.usuario_id
       LEFT JOIN orden_compra oc ON oc.id = m.orden_compra_id
       LEFT JOIN pedido ped ON ped.id = m.pedido_id
      WHERE ($1::uuid IS NULL OR m.sucursal_id = $1)
        AND ($2::uuid IS NULL OR m.producto_id = $2)
        AND ($3::uuid IS NULL OR m.motivo_movimiento_id = $3)
        AND ($4::text IS NULL OR t.nombre = $4)
        AND ($5::text IS NULL OR p.sku ILIKE $5 OR p.nombre ILIKE $5 OR l.numero_lote ILIKE $5)
        AND ${condicionRango('m.fecha', 6, 7)}
      ORDER BY m.fecha DESC, m.id LIMIT $8 OFFSET $9`,
    [req.query.sucursal_id || null, req.query.producto_id || null, req.query.motivo_id || null, tipo,
      likeParam(req.query.q), desde, hasta, limit, offset]);
  res.json(listResponse(
    rows.map(({ orden_compra_numero, pedido_numero, ...m }) => ({
      ...m,
      referencia: orden_compra_numero ? formatoNumero('OC', orden_compra_numero) : pedido_numero ? formatoNumero('PED', pedido_numero) : null,
    })),
    { page, limit }));
});

export default r;
