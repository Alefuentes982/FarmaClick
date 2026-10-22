import { Router } from 'express';
import { pool, withTx } from '../../core/db.js';
import { condicionRango, rangoFechas } from '../../core/fechas.js';
import { likeParam, listResponse, paging, uuid } from '../../core/sql.js';
import { codigoPedido } from '../pedidos/servicio.js';
import { correoSchema } from '../../core/correo.js';
import { comprobanteDevolucion, enviarComprobanteDevolucion } from './comprobante.js';
import { cotizacionSchema, devolucionSchema, filtrosDevolviblesSchema } from './esquemas.js';
import { codigoDevolucion, cotizarDevolucion, crearDevolucion, detalleDevolucion, MAX_DIAS, pedidoDevolvible } from './servicio.js';

const r = Router();

r.get('/', async (req, res) => {
  const { limit, page, offset } = paging(req.query);
  const { desde, hasta } = rangoFechas(req.query);
  const texto = String(req.query.q ?? '').trim();
  // "DEV-000012", "12" buscan por número de devolución; "PED-000123" por pedido; otro texto, por cliente.
  const dev = /^(dev[-\s]?)?\d+$/i.test(texto) ? Number(texto.replace(/\D/g, '')) : null;
  const ped = /^ped[-\s]?\d+$/i.test(texto) ? Number(texto.replace(/\D/g, '')) : null;
  const { rows } = await pool.query(
    `SELECT COUNT(*) OVER() AS total_filas, d.id, d.numero, d.fecha, d.motivo, d.total_reembolso, d.pedido_id,
            p.numero AS pedido_numero, p.nombre_cliente, s.nombre AS sucursal, u.nombre AS usuario
       FROM devolucion d
       JOIN pedido p ON p.id = d.pedido_id
       LEFT JOIN sucursal s ON s.id = p.sucursal_id
       JOIN usuario u ON u.id = d.usuario_id
      WHERE ($1::uuid IS NULL OR d.pedido_id = $1)
        AND ($2::uuid IS NULL OR p.sucursal_id = $2)
        AND (($3::bigint IS NULL AND $4::bigint IS NULL AND ($5::text IS NULL OR p.nombre_cliente ILIKE $5))
             OR ($3::bigint IS NOT NULL AND d.numero = $3) OR ($4::bigint IS NOT NULL AND p.numero = $4))
        AND ${condicionRango('d.fecha', 6, 7)}
      ORDER BY d.numero DESC LIMIT $8 OFFSET $9`,
    [req.query.pedido_id || null, req.query.sucursal_id || null, ped === null ? dev : null, ped,
      dev === null && ped === null ? likeParam(texto) : null, desde, hasta, limit, offset]);
  res.json(listResponse(
    rows.map((d) => ({ ...d, codigo: codigoDevolucion(d.numero), pedido_codigo: codigoPedido(d.pedido_numero) })),
    { page, limit }));
});

// Pedidos que todavía se pueden devolver: entregados, dentro del plazo (DEVOLUCION_MAX_DIAS) y con alguna unidad
// sin devolver. Sin filtros entrega los más recientes; los filtros ayudan cuando el cliente no recuerda el número.
//   q: "PED-000123" o "123" (número) u otro texto (cliente) · producto: SKU o nombre de algo que compró
//   medio_pago_id · desde/hasta (AAAA-MM-DD) · monto_desde/monto_hasta (lo cobrado) · sucursal_id
r.get('/pedidos-devolvibles', async (req, res) => {
  const f = filtrosDevolviblesSchema.parse(req.query);
  const { desde, hasta } = rangoFechas(req.query);
  const texto = f.q ?? '';
  const numero = /^(ped[-\s]?)?\d+$/i.test(texto) ? Number(texto.replace(/\D/g, '')) : null;
  const { rows } = await pool.query(
    `WITH elegibles AS (
       SELECT p.id, p.numero, p.fecha, p.nombre_cliente, (p.total + p.redondeo) AS cobrado,
              s.nombre AS sucursal, u.nombre AS vendedor,
              ((NOW() AT TIME ZONE 'America/Santiago')::date - (p.fecha AT TIME ZONE 'America/Santiago')::date)::int AS dias
         FROM pedido p
         JOIN estado_pedido e ON e.id = p.estado_pedido_id AND e.nombre = 'Entregado'
         LEFT JOIN sucursal s ON s.id = p.sucursal_id
         LEFT JOIN usuario u ON u.id = p.vendedor_id
        WHERE ($1::bigint IS NULL OR p.numero = $1)
          AND ($2::text IS NULL OR p.nombre_cliente ILIKE $2)
          AND ($3::uuid IS NULL OR p.sucursal_id = $3)
          AND ${condicionRango('p.fecha', 4, 5)}
          AND ($6::numeric IS NULL OR p.total + p.redondeo >= $6)
          AND ($7::numeric IS NULL OR p.total + p.redondeo <= $7)
          AND ($8::int <= 0 OR p.fecha >= (((NOW() AT TIME ZONE 'America/Santiago')::date - $8::int)::timestamp AT TIME ZONE 'America/Santiago'))
          AND ($9::text IS NULL OR EXISTS (
                SELECT 1 FROM detalle_pedido d JOIN producto pr ON pr.id = d.producto_id
                 WHERE d.pedido_id = p.id AND (pr.sku ILIKE $9 OR d.nombre_producto ILIKE $9)))
          AND ($10::uuid IS NULL OR EXISTS (
                SELECT 1 FROM transaccion_pago tp
                  JOIN estado_transaccion et ON et.id = tp.estado_transaccion_id AND et.nombre = 'Aprobado'
                 WHERE tp.pedido_id = p.id AND tp.medio_pago_id = $10))
          AND EXISTS (
                SELECT 1 FROM detalle_pedido d
                 WHERE d.pedido_id = p.id
                   AND d.cantidad > COALESCE((SELECT SUM(dd.cantidad) FROM devolucion_detalle dd WHERE dd.detalle_pedido_id = d.id), 0))
        ORDER BY p.fecha DESC
        LIMIT 50)
     SELECT el.*,
            (SELECT json_agg(json_build_object('nombre', d.nombre_producto, 'cantidad', d.cantidad) ORDER BY d.nombre_producto)
               FROM detalle_pedido d WHERE d.pedido_id = el.id) AS productos,
            (SELECT string_agg(DISTINCT mp.nombre, ', ')
               FROM transaccion_pago tp
               JOIN medio_pago mp ON mp.id = tp.medio_pago_id
               JOIN estado_transaccion et ON et.id = tp.estado_transaccion_id AND et.nombre = 'Aprobado'
              WHERE tp.pedido_id = el.id) AS medios
       FROM elegibles el
      ORDER BY el.fecha DESC`,
    [numero, numero === null ? likeParam(texto) : null, f.sucursal_id ?? null, desde, hasta,
      f.monto_desde ?? null, f.monto_hasta ?? null, MAX_DIAS, likeParam(f.producto), f.medio_pago_id ?? null]);
  res.json({
    plazo_dias: MAX_DIAS,
    data: rows.map((p) => ({
      ...p, codigo: codigoPedido(p.numero), cobrado: Number(p.cobrado), productos: p.productos ?? [],
      dias_restantes: MAX_DIAS > 0 ? MAX_DIAS - p.dias : null,
    })),
  });
});

// Pedido con lo devuelto y lo que queda por devolver (líneas y medios de pago).
r.get('/pedido/:id', async (req, res) => res.json(await pedidoDevolvible(pool, uuid.parse(req.params.id))));

// Reembolso por línea, total y reparto sugerido por medio de pago, sin guardar nada.
r.post('/cotizar', async (req, res) => {
  const { pedido_id: pedidoId, items } = cotizacionSchema.parse(req.body);
  res.json(cotizarDevolucion(await pedidoDevolvible(pool, pedidoId), items));
});

r.post('/', async (req, res) => {
  const d = devolucionSchema.parse(req.body);
  const id = await withTx(req.usuarioId, (db) => crearDevolucion(db, d, { usuarioId: req.usuarioId }));
  res.status(201).json(await detalleDevolucion(pool, id));
});

r.get('/:id', async (req, res) => res.json(await detalleDevolucion(pool, uuid.parse(req.params.id))));

r.post('/:id/enviar', async (req, res) => {
  const { correo } = correoSchema.parse(req.body);
  res.json(await enviarComprobanteDevolucion(pool, uuid.parse(req.params.id), correo));
});

r.get('/:id/pdf', async (req, res) => res.json(await comprobanteDevolucion(pool, uuid.parse(req.params.id))));

export default r;
