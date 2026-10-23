import { Router } from 'express';
import { z } from 'zod';
import { pool, withTx } from '../../core/db.js';
import { condicionRango, rangoFechas } from '../../core/fechas.js';
import { likeParam, listResponse, paging, uuid } from '../../core/sql.js';
import { correoSchema } from '../../core/correo.js';
import { comprobantePedido, enviarComprobantePedido } from './comprobante.js';
import { estadoSchema, pagosSchema, pedidoSchema } from './esquemas.js';
import {
  buscarProductosVendibles, cambiarEstado, cancelarPedido, codigoPedido, crearPedido, detallePedido, expirarPendientes,
  registrarPagos, reemplazarPedido, reservarPedido,
} from './servicio.js';

const r = Router();

// Buscador de líneas del pedido: productos vendibles con su precio y stock disponible en la sucursal.
r.get('/catalogo', async (req, res) => {
  const { limit } = paging(req.query);
  res.json(await buscarProductosVendibles(pool, {
    sucursalId: req.query.sucursal_id, q: String(req.query.q ?? '').trim() || null, remoto: req.query.canal !== 'Presencial', limit,
  }));
});

r.get('/', async (req, res) => {
  const { limit, page, offset } = paging(req.query);
  const { desde, hasta } = rangoFechas(req.query);
  const texto = String(req.query.q ?? '').trim();
  // "PED-000123", "123" o "ped 123" buscan por número; cualquier otro texto, por cliente.
  const numero = /^(ped[-\s]?)?\d+$/i.test(texto) ? Number(texto.replace(/\D/g, '')) : null;
  const { rows } = await pool.query(
    `SELECT COUNT(*) OVER() AS total_filas, p.id, p.numero, p.fecha, p.total, p.nombre_cliente,
            e.nombre AS estado, cv.nombre AS canal, s.nombre AS sucursal, u.nombre AS vendedor
       FROM pedido p
       JOIN estado_pedido e ON e.id = p.estado_pedido_id
       JOIN canal_venta cv ON cv.id = p.canal_venta_id
       LEFT JOIN sucursal s ON s.id = p.sucursal_id
       LEFT JOIN usuario u ON u.id = p.vendedor_id
      WHERE ($1::uuid IS NULL OR p.estado_pedido_id = $1)
        AND ($2::uuid IS NULL OR p.canal_venta_id = $2)
        AND ($3::uuid IS NULL OR p.sucursal_id = $3)
        AND ($4::bigint IS NOT NULL AND p.numero = $4 OR $4::bigint IS NULL AND ($5::text IS NULL OR p.nombre_cliente ILIKE $5))
        AND ${condicionRango('p.fecha', 6, 7)}
      ORDER BY p.numero DESC LIMIT $8 OFFSET $9`,
    [req.query.estado_id || null, req.query.canal_id || null, req.query.sucursal_id || null, numero,
      numero === null ? likeParam(texto) : null, desde, hasta, limit, offset]);
  res.json(listResponse(rows.map((p) => ({ ...p, codigo: codigoPedido(p.numero) })), { page, limit }));
});

r.get('/:id', async (req, res) => res.json(await detallePedido(pool, req.params.id)));

// Pedido a distancia (canal Online) creado desde el backoffice, p. ej. telefónico. La venta presencial entra por la caja.
r.post('/', async (req, res) => {
  const d = pedidoSchema.parse(req.body);
  const id = await withTx(req.usuarioId, (db) => crearPedido(db, d, { canal: 'Online', usuarioId: req.usuarioId }));
  res.status(201).json(await detallePedido(pool, id));
});

r.put('/:id', async (req, res) => {
  const d = pedidoSchema.parse(req.body);
  await withTx(req.usuarioId, (db) => reemplazarPedido(db, req.params.id, d));
  res.json(await detallePedido(pool, req.params.id));
});

r.post('/expirar-pendientes', async (req, res) => {
  const { minutos } = z.object({ minutos: z.number().int().min(1).max(1440).default(20) }).parse(req.body ?? {});
  const expirados = await withTx(req.usuarioId, (db) => expirarPendientes(db, minutos));
  res.json({ expirados });
});

r.post('/:id/reservar', async (req, res) => {
  await withTx(req.usuarioId, (db) => reservarPedido(db, req.params.id));
  res.json(await detallePedido(pool, req.params.id));
});

r.post('/:id/pagos', async (req, res) => {
  const { pagos } = pagosSchema.parse(req.body);
  await withTx(req.usuarioId, (db) => registrarPagos(db, req.params.id, pagos));
  res.json(await detallePedido(pool, req.params.id));
});

r.post('/:id/estado', async (req, res) => {
  const { estado } = estadoSchema.parse(req.body);
  await withTx(req.usuarioId, (db) => cambiarEstado(db, req.params.id, estado));
  res.json(await detallePedido(pool, req.params.id));
});

r.post('/:id/cancelar', async (req, res) => {
  await withTx(req.usuarioId, (db) => cancelarPedido(db, req.params.id));
  res.json(await detallePedido(pool, req.params.id));
});

// Envía el comprobante por correo (PDF adjunto) a la dirección indicada.
r.post('/:id/enviar', async (req, res) => {
  const { correo } = correoSchema.parse(req.body);
  res.json(await enviarComprobantePedido(pool, uuid.parse(req.params.id), correo));
});

r.get('/:id/pdf', async (req, res) => {
  uuid.parse(req.params.id);
  res.json(await comprobantePedido(pool, req.params.id));
});

export default r;
