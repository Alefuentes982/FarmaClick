import { Router } from 'express';
import { z } from 'zod';
import { pool, withTx } from '../../core/db.js';
import { HttpError, notFound } from '../../core/errors.js';
import { paging, uuid } from '../../core/sql.js';
import { correoSchema } from '../../core/correo.js';
import { comprobantePedido, enviarComprobantePedido } from '../pedidos/comprobante.js';
import {
  buscarProductosVendibles, codigoPedido, cotizar, crearPedido, detallePedido, entregarEnMostrador, registrarPagos,
} from '../pedidos/servicio.js';
import { aperturaSchema, cajaSchema, cierreSchema, cotizacionSchema, ventaSchema } from './esquemas.js';
import { esAdministrador, esJefeOAdmin, operaSobreSucursal } from '../../core/roles.js';
import { abrirTurno, cerrarTurno, resumenTurno, turnoAbierto } from './turnos.js';

const r = Router();

// Configurar cajas: el Administrador (todas) y el Jefe de local (las de su sucursal).
const configuraCajas = (req, _res, next) => (esJefeOAdmin(req.user)
  ? next() : next(new HttpError(403, 'Solo el Administrador o el Jefe de local pueden configurar cajas.')));
const exigirSucursal = (user, sucursalId) => {
  if (!operaSobreSucursal(user, sucursalId)) throw new HttpError(403, 'Solo puede configurar las cajas de su sucursal.');
};

const exigirTurno = async (db, usuarioId) => {
  const t = await turnoAbierto(db, usuarioId);
  if (!t) throw new HttpError(409, 'Abra un turno de caja para vender.');
  return t;
};

// ---- Turno -----------------------------------------------------------------
r.get('/turno', async (req, res) => {
  const t = await turnoAbierto(pool, req.usuarioId);
  res.json(t ? { ...t, resumen: await resumenTurno(pool, t.id) } : null);
});

r.post('/turnos', async (req, res) => {
  const d = aperturaSchema.parse(req.body);
  await withTx(req.usuarioId, (db) => abrirTurno(db, req.user, d));
  const t = await turnoAbierto(pool, req.usuarioId);
  res.status(201).json({ ...t, resumen: await resumenTurno(pool, t.id) });
});

r.post('/turnos/:id/cerrar', async (req, res) => {
  const { monto_contado: contado } = cierreSchema.parse(req.body);
  res.json(await withTx(req.usuarioId, (db) => cerrarTurno(db, req.usuarioId, req.params.id, contado)));
});

r.get('/turno/ventas', async (req, res) => {
  const t = await exigirTurno(pool, req.usuarioId);
  const { rows } = await pool.query(
    `SELECT p.id, p.numero, p.fecha, p.total, p.nombre_cliente, e.nombre AS estado,
            COALESCE(string_agg(DISTINCT mp.nombre, ', '), '—') AS medios
       FROM pedido p
       JOIN estado_pedido e ON e.id = p.estado_pedido_id
       LEFT JOIN transaccion_pago tp ON tp.pedido_id = p.id
       LEFT JOIN medio_pago mp ON mp.id = tp.medio_pago_id
      WHERE p.turno_caja_id = $1 GROUP BY p.id, e.nombre ORDER BY p.numero DESC`, [t.id]);
  res.json(rows.map((p) => ({ ...p, codigo: codigoPedido(p.numero) })));
});

// ---- Venta -----------------------------------------------------------------
// Buscador de productos de la sucursal del turno (por SKU o nombre). Por mostrador se ofrece todo el catálogo activo.
r.get('/productos', async (req, res) => {
  const t = await exigirTurno(pool, req.usuarioId);
  const { limit } = paging(req.query);
  res.json(await buscarProductosVendibles(pool, { sucursalId: t.sucursal_id, q: String(req.query.q ?? '').trim() || null, remoto: false, limit }));
});

// Totales y descuentos antes de cobrar (no guarda nada).
r.post('/cotizar', async (req, res) => {
  const { items } = cotizacionSchema.parse(req.body);
  await exigirTurno(pool, req.usuarioId);
  res.json(await cotizar(pool, items));
});

// Crea el pedido presencial, reserva el stock, registra el pago y lo entrega, todo en una transacción:
// si falta stock o el pago no calza, no queda nada a medias.
r.post('/ventas', async (req, res) => {
  const d = ventaSchema.parse(req.body);
  const id = await withTx(req.usuarioId, async (db) => {
    const turno = await exigirTurno(db, req.usuarioId);
    const pedidoId = await crearPedido(db, {
      sucursal_id: turno.sucursal_id, nombre_cliente: d.nombre_cliente ?? 'Cliente mostrador', telefono: null,
      direccion_pedido: null, comuna_id: null, items: d.items, reservar: false,
    }, { canal: 'Presencial', usuarioId: req.usuarioId, turnoId: turno.id });
    await registrarPagos(db, pedidoId, d.pagos);
    await entregarEnMostrador(db, pedidoId);
    return pedidoId;
  });
  res.status(201).json(await detallePedido(pool, id));
});

r.get('/ventas/:id/pdf', async (req, res) => {
  uuid.parse(req.params.id);
  const { rows } = await pool.query('SELECT turno_caja_id FROM pedido WHERE id = $1', [req.params.id]);
  if (!rows[0]?.turno_caja_id) throw notFound('Venta');
  res.json(await comprobantePedido(pool, req.params.id));
});

// Envía por correo el comprobante de una venta de caja.
r.post('/ventas/:id/enviar', async (req, res) => {
  const { correo } = correoSchema.parse(req.body);
  uuid.parse(req.params.id);
  const { rows } = await pool.query('SELECT turno_caja_id FROM pedido WHERE id = $1', [req.params.id]);
  if (!rows[0]?.turno_caja_id) throw notFound('Venta');
  res.json(await enviarComprobantePedido(pool, req.params.id, correo));
});

// ---- Cajas -----------------------------------------------------------------
r.get('/cajas', async (req, res) => {
  const sucursal = req.query.sucursal_id || req.user.sucursal_id || null; // quien tiene sucursal ve solo la suya
  const { rows } = await pool.query(
    `SELECT c.id, c.numero, c.activa, s.id AS sucursal_id, s.nombre AS sucursal,
            t.id AS turno_id, t.fecha_apertura, u.nombre AS usuario_turno
       FROM caja c JOIN sucursal s ON s.id = c.sucursal_id
       LEFT JOIN turno_caja t ON t.caja_id = c.id AND t.fecha_cierre IS NULL
       LEFT JOIN usuario u ON u.id = t.usuario_id
      WHERE ($1::uuid IS NULL OR c.sucursal_id = $1) AND ($2::boolean IS NULL OR c.activa = $2)
      ORDER BY s.nombre, c.numero`,
    [sucursal, req.query.activa === 'true' ? true : req.query.activa === 'false' ? false : null]);
  res.json(rows);
});

r.post('/cajas', configuraCajas, async (req, res) => {
  const { sucursal_id: sucursalId } = cajaSchema.parse(req.body);
  exigirSucursal(req.user, sucursalId);
  const { rows } = await pool.query(
    `INSERT INTO caja (sucursal_id, numero)
     SELECT $1::uuid, COALESCE(MAX(numero), 0) + 1 FROM caja WHERE sucursal_id = $1 RETURNING id, numero`, [sucursalId]);
  res.status(201).json(rows[0]);
});

r.patch('/cajas/:id', configuraCajas, async (req, res) => {
  const { activa } = z.object({ activa: z.boolean() }).parse(req.body);
  const caja = await pool.query('SELECT sucursal_id FROM caja WHERE id = $1', [uuid.parse(req.params.id)]);
  if (!caja.rows[0]) throw notFound('Caja');
  exigirSucursal(req.user, caja.rows[0].sucursal_id);
  const abierto = await pool.query('SELECT 1 FROM turno_caja WHERE caja_id = $1 AND fecha_cierre IS NULL', [req.params.id]);
  if (!activa && abierto.rowCount) throw new HttpError(409, 'No se puede desactivar una caja con un turno abierto.');
  const { rowCount } = await pool.query('UPDATE caja SET activa = $1 WHERE id = $2', [activa, req.params.id]);
  if (!rowCount) throw notFound('Caja');
  res.json({ id: req.params.id, activa });
});

// ---- Sucursales: farmacia de turno (24 horas, sin cierre automático de caja a las 23:59) ---------------------
r.get('/sucursales', configuraCajas, async (_req, res) => {
  const { rows } = await pool.query('SELECT id, nombre, farmacia_de_turno FROM sucursal WHERE activa ORDER BY nombre');
  res.json(rows);
});

// Solo el Administrador define qué sucursales son farmacia de turno.
r.patch('/sucursales/:id', async (req, res) => {
  if (!esAdministrador(req.user)) throw new HttpError(403, 'Solo el Administrador define las farmacias de turno.');
  const { farmacia_de_turno: deTurno } = z.object({ farmacia_de_turno: z.boolean() }).parse(req.body);
  const { rowCount } = await pool.query('UPDATE sucursal SET farmacia_de_turno = $1 WHERE id = $2', [deTurno, uuid.parse(req.params.id)]);
  if (!rowCount) throw notFound('Sucursal');
  res.json({ id: req.params.id, farmacia_de_turno: deTurno });
});

export default r;
