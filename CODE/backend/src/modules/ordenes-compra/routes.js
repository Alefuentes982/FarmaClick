import { Router } from 'express';
import { z } from 'zod';
import { pool, withTx } from '../../core/db.js';
import { HttpError, notFound } from '../../core/errors.js';
import { clp, fechaDMA, formatoNumero, generarDocumentoPdf, pdfABuffer } from '../../core/documentos.js';
import { condicionRango, rangoFechas } from '../../core/fechas.js';
import { likeParam, listResponse, paging, uuid } from '../../core/sql.js';

const r = Router();

// Ciclo de vida: Borrador (se guarda y edita) -> Pendiente (emitida al proveedor, ya no se edita)
// -> Recibida parcial -> Recibida. Se puede cancelar un Borrador o una Pendiente sin recepciones.
const codigo = (n) => formatoNumero('OC', n);

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD).');
const linea = z.object({
  producto_id: uuid,
  cantidad_solicitada: z.number().int().positive(),
  costo_unitario: z.number().min(0),
});
const lineas = z
  .array(linea)
  .min(1, 'La orden necesita al menos una línea.')
  .refine((l) => new Set(l.map((x) => x.producto_id)).size === l.length, 'Producto repetido en la orden.');

// emitir=false guarda como Borrador; emitir=true la deja Pendiente (enviada al proveedor).
const guardar = z.object({
  proveedor_id: uuid,
  sucursal_id: uuid,
  fecha_esperada: fecha.nullish().transform((v) => v ?? null),
  items: lineas,
  emitir: z.boolean().default(false),
});
const recibir = z.object({
  items: z
    .array(z.object({
      detalle_id: uuid,
      cantidad: z.number().int().positive(),
      numero_lote: z.string().trim().max(50).nullish().transform((v) => v || null),
      fecha_vencimiento: fecha.nullish().transform((v) => v ?? null),
    }))
    .min(1, 'Indique al menos una línea a recibir.'),
});

async function estadoId(db, nombre) {
  const { rows } = await db.query('SELECT id FROM estado_orden_compra WHERE nombre = $1', [nombre]);
  if (!rows[0]) {
    const pista = nombre === 'Borrador' ? ' Ejecute db/migraciones/001_orden_compra_borrador_numero.sql.' : '';
    throw new HttpError(500, `Falta el estado de orden de compra "${nombre}".${pista}`);
  }
  return rows[0].id;
}

async function getOrden(db, id) {
  const { rows } = await db.query(
    `SELECT oc.id, oc.numero, oc.fecha, oc.fecha_esperada, oc.subtotal_neto, oc.iva, oc.total,
            oc.estado_orden_compra_id, e.nombre AS estado,
            oc.proveedor_id, pr.nombre AS proveedor, pr.rut AS proveedor_rut, pr.contacto AS proveedor_contacto,
            oc.sucursal_id, s.nombre AS sucursal, s.direccion AS sucursal_direccion, s.telefono AS sucursal_telefono,
            oc.usuario_id, u.nombre AS usuario
       FROM orden_compra oc
       JOIN estado_orden_compra e ON e.id = oc.estado_orden_compra_id
       JOIN proveedor pr ON pr.id = oc.proveedor_id
       JOIN sucursal s ON s.id = oc.sucursal_id
       JOIN usuario u ON u.id = oc.usuario_id
      WHERE oc.id = $1`, [id]);
  if (!rows[0]) throw notFound('Orden de compra');
  const items = await db.query(
    `SELECT d.id, d.producto_id, p.sku, p.nombre AS producto, p.requiere_lote, p.requiere_vencimiento,
            d.cantidad_solicitada, d.cantidad_recibida, d.costo_unitario
       FROM orden_compra_detalle d JOIN producto p ON p.id = d.producto_id
      WHERE d.orden_compra_id = $1 ORDER BY p.nombre`, [id]);
  return { ...rows[0], codigo: codigo(rows[0].numero), items: items.rows };
}

// Bloquea la orden y valida su estado. `permitidos` son los estados desde los que se puede operar;
// con `sinRecepciones` además no debe haberse recibido nada.
async function lockEstado(db, id, permitidos, mensaje, { sinRecepciones = false } = {}) {
  const { rows } = await db.query(
    `SELECT e.nombre AS estado,
            EXISTS (SELECT 1 FROM orden_compra_detalle d WHERE d.orden_compra_id = oc.id AND d.cantidad_recibida > 0) AS con_recepcion
       FROM orden_compra oc JOIN estado_orden_compra e ON e.id = oc.estado_orden_compra_id
      WHERE oc.id = $1 FOR UPDATE OF oc`, [id]);
  if (!rows[0]) throw notFound('Orden de compra');
  if (!permitidos.includes(rows[0].estado) || (sinRecepciones && rows[0].con_recepcion)) throw new HttpError(409, mensaje);
  return rows[0];
}

async function insertarLineas(db, ocId, items) {
  for (const it of items) {
    await db.query(
      `INSERT INTO orden_compra_detalle (orden_compra_id, producto_id, cantidad_solicitada, costo_unitario)
       VALUES ($1,$2,$3,$4)`, [ocId, it.producto_id, it.cantidad_solicitada, it.costo_unitario]);
  }
}

r.get('/', async (req, res) => {
  const { limit, page, offset } = paging(req.query);
  const { desde, hasta } = rangoFechas(req.query);
  const texto = String(req.query.q ?? '').trim();
  // "OC-000123", "123" o "oc 123" buscan por número; cualquier otro texto, por proveedor.
  const numero = /^(oc[-\s]?)?\d+$/i.test(texto) ? Number(texto.replace(/\D/g, '')) : null;
  const { rows } = await pool.query(
    `SELECT COUNT(*) OVER() AS total_filas, oc.id, oc.numero, oc.fecha, oc.fecha_esperada, oc.subtotal_neto, oc.iva, oc.total,
            e.nombre AS estado, pr.nombre AS proveedor, s.nombre AS sucursal
       FROM orden_compra oc
       JOIN estado_orden_compra e ON e.id = oc.estado_orden_compra_id
       JOIN proveedor pr ON pr.id = oc.proveedor_id
       JOIN sucursal s ON s.id = oc.sucursal_id
      WHERE ($1::uuid IS NULL OR oc.estado_orden_compra_id = $1)
        AND ($2::uuid IS NULL OR oc.proveedor_id = $2)
        AND ($3::bigint IS NOT NULL AND oc.numero = $3 OR $3::bigint IS NULL AND ($4::text IS NULL OR pr.nombre ILIKE $4))
        AND ${condicionRango('oc.fecha', 5, 6)}
      ORDER BY oc.numero DESC LIMIT $7 OFFSET $8`,
    [req.query.estado_id || null, req.query.proveedor_id || null, numero, numero === null ? likeParam(texto) : null,
      desde, hasta, limit, offset]);
  res.json(listResponse(rows.map((o) => ({ ...o, codigo: codigo(o.numero) })), { page, limit }));
});

r.get('/:id', async (req, res) => res.json(await getOrden(pool, req.params.id)));

r.post('/', async (req, res) => {
  const d = guardar.parse(req.body);
  const id = await withTx(req.usuarioId, async (db) => {
    const { rows } = await db.query(
      `INSERT INTO orden_compra (fecha_esperada, estado_orden_compra_id, proveedor_id, usuario_id, sucursal_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [d.fecha_esperada, await estadoId(db, d.emitir ? 'Pendiente' : 'Borrador'), d.proveedor_id, req.usuarioId, d.sucursal_id]);
    await insertarLineas(db, rows[0].id, d.items); // los totales los recalcula el trigger
    return rows[0].id;
  });
  res.status(201).json(await getOrden(pool, id));
});

// Solo un Borrador se edita. Al emitirla queda congelada: es lo que ya recibió el proveedor.
r.put('/:id', async (req, res) => {
  const d = guardar.parse(req.body);
  await withTx(req.usuarioId, async (db) => {
    await lockEstado(db, req.params.id, ['Borrador'], 'Solo se puede modificar una orden en estado Borrador.');
    await db.query(
      `UPDATE orden_compra SET proveedor_id = $1, sucursal_id = $2, fecha_esperada = $3, estado_orden_compra_id = $4 WHERE id = $5`,
      [d.proveedor_id, d.sucursal_id, d.fecha_esperada, await estadoId(db, d.emitir ? 'Pendiente' : 'Borrador'), req.params.id]);
    await db.query('DELETE FROM orden_compra_detalle WHERE orden_compra_id = $1', [req.params.id]);
    await insertarLineas(db, req.params.id, d.items);
  });
  res.json(await getOrden(pool, req.params.id));
});

r.post('/:id/emitir', async (req, res) => {
  await withTx(req.usuarioId, async (db) => {
    await lockEstado(db, req.params.id, ['Borrador'], 'Solo se puede emitir una orden en estado Borrador.');
    await db.query('UPDATE orden_compra SET estado_orden_compra_id = $1 WHERE id = $2',
      [await estadoId(db, 'Pendiente'), req.params.id]);
  });
  res.json(await getOrden(pool, req.params.id));
});

r.post('/:id/cancelar', async (req, res) => {
  await withTx(req.usuarioId, async (db) => {
    await lockEstado(db, req.params.id, ['Borrador', 'Pendiente'],
      'Solo se puede cancelar una orden Borrador o Pendiente que no tenga recepciones.', { sinRecepciones: true });
    await db.query('UPDATE orden_compra SET estado_orden_compra_id = $1 WHERE id = $2',
      [await estadoId(db, 'Cancelada'), req.params.id]);
  });
  res.json(await getOrden(pool, req.params.id));
});

// Recepción (total o parcial): crea el lote, registra el movimiento "Recepción OC" en el kardex
// (los triggers suman el stock y recalculan el costo por PMP) y actualiza el estado de la orden.
r.post('/:id/recibir', async (req, res) => {
  const d = recibir.parse(req.body);
  await withTx(req.usuarioId, async (db) => {
    await lockEstado(db, req.params.id, ['Pendiente', 'Recibida parcial'],
      'Solo se puede recibir una orden emitida (Pendiente o Recibida parcial).');
    const { rows: oc } = await db.query('SELECT sucursal_id FROM orden_compra WHERE id = $1', [req.params.id]);
    const motivo = await db.query("SELECT id FROM motivo_movimiento WHERE nombre = 'Recepción OC'");
    if (!motivo.rows[0]) throw new HttpError(500, 'Falta el motivo de movimiento "Recepción OC".');

    const detalles = await db.query(
      `SELECT d.id, d.producto_id, d.cantidad_solicitada, d.cantidad_recibida, p.requiere_lote
         FROM orden_compra_detalle d JOIN producto p ON p.id = d.producto_id
        WHERE d.orden_compra_id = $1`, [req.params.id]);
    const porId = new Map(detalles.rows.map((x) => [x.id, x]));
    const vistos = new Set();

    for (const it of d.items) {
      const det = porId.get(it.detalle_id);
      if (!det) throw new HttpError(400, 'Una de las líneas no pertenece a esta orden.');
      if (vistos.has(it.detalle_id)) throw new HttpError(400, 'Línea repetida en la recepción.');
      vistos.add(it.detalle_id);
      const pendiente = det.cantidad_solicitada - det.cantidad_recibida;
      if (it.cantidad > pendiente) {
        throw new HttpError(400, `La cantidad a recibir (${it.cantidad}) supera lo pendiente (${pendiente}).`);
      }
      // Sin lote exigido se genera uno técnico: la restricción única (producto, sucursal, lote) no admite dos NULL.
      const numeroLote = it.numero_lote ?? (det.requiere_lote ? null
        : `OC-${req.params.id.slice(0, 8)}-${Date.now().toString(36)}`);

      const lote = await db.query(
        `INSERT INTO lote (numero_lote, fecha_vencimiento, cantidad_recibida, producto_id, sucursal_id, orden_compra_detalle_id)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [numeroLote, it.fecha_vencimiento, it.cantidad, det.producto_id, oc[0].sucursal_id, det.id]);
      await db.query(
        `INSERT INTO movimiento_inventario (producto_id, sucursal_id, cantidad, motivo_movimiento_id, lote_id, usuario_id, orden_compra_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [det.producto_id, oc[0].sucursal_id, it.cantidad, motivo.rows[0].id, lote.rows[0].id, req.usuarioId, req.params.id]);
      await db.query('UPDATE orden_compra_detalle SET cantidad_recibida = cantidad_recibida + $1 WHERE id = $2', [it.cantidad, det.id]);
    }

    const { rows } = await db.query(
      'SELECT bool_and(cantidad_recibida >= cantidad_solicitada) AS completa FROM orden_compra_detalle WHERE orden_compra_id = $1',
      [req.params.id]);
    await db.query('UPDATE orden_compra SET estado_orden_compra_id = $1 WHERE id = $2',
      [await estadoId(db, rows[0].completa ? 'Recibida' : 'Recibida parcial'), req.params.id]);
  });
  res.json(await getOrden(pool, req.params.id));
});

// PDF para enviar al proveedor (JSON con el archivo en base64). Muestra el estado actual de la orden; una orden en
// borrador, cancelada o con recepción (total o parcial) lleva además un sello para que no se confunda con una emitida.
r.get('/:id/pdf', async (req, res) => {
  const o = await getOrden(pool, req.params.id);
  const conRecepcion = ['Recibida parcial', 'Recibida'].includes(o.estado); // el PDF muestra lo recibido por línea
  const doc = generarDocumentoPdf({
    titulo: 'ORDEN DE COMPRA',
    codigo: o.codigo,
    emisor: {
      nombre: process.env.EMPRESA_NOMBRE || 'FarmaClick',
      lineas: [process.env.EMPRESA_RUT && `RUT ${process.env.EMPRESA_RUT}`, process.env.EMPRESA_DIRECCION].filter(Boolean),
    },
    metadatos: [
      ['Fecha de emisión', fechaDMA(o.fecha)],
      ['Entrega esperada', fechaDMA(o.fecha_esperada)],
      ['Estado', o.estado],
      ['Emitida por', o.usuario],
    ],
    partes: [
      { titulo: 'Proveedor', lineas: [o.proveedor, `RUT ${o.proveedor_rut}`, o.proveedor_contacto] },
      { titulo: 'Entregar en', lineas: [o.sucursal, o.sucursal_direccion, o.sucursal_telefono && `Tel. ${o.sucursal_telefono}`] },
    ],
    columnas: [
      { header: 'SKU', key: 'sku', ancho: conRecepcion ? 0.13 : 0.15 },
      { header: 'Producto', key: 'producto', ancho: conRecepcion ? 0.31 : 0.37 },
      { header: conRecepcion ? 'Pedido' : 'Cantidad', key: 'cantidad', ancho: conRecepcion ? 0.09 : 0.1, alinear: 'right' },
      ...(conRecepcion ? [{ header: 'Recibido', key: 'recibido', ancho: 0.09, alinear: 'right' }] : []),
      { header: 'Costo unit. neto', key: 'costo', ancho: 0.18, alinear: 'right' },
      { header: 'Subtotal neto', key: 'subtotal', ancho: 0.2, alinear: 'right' },
    ],
    filas: o.items.map((i) => ({
      sku: i.sku,
      producto: i.producto,
      cantidad: i.cantidad_solicitada,
      recibido: i.cantidad_recibida,
      costo: clp(i.costo_unitario),
      subtotal: clp(i.cantidad_solicitada * Number(i.costo_unitario)),
    })),
    totales: [['Neto', clp(o.subtotal_neto)], ['IVA 19%', clp(o.iva)], ['Total', clp(o.total)]],
    sello: { Borrador: 'BORRADOR', Cancelada: 'ANULADA', Recibida: 'RECIBIDA', 'Recibida parcial': 'PARCIAL' }[o.estado] ?? null,
  });
  // Se entrega como JSON (base64) y no como application/pdf: los gestores de descarga (IDM y similares) interceptan
  // cualquier respuesta PDF a nivel de red, la vuelven a pedir sin la sesión y el archivo llega vacío. El
  // frontend reconstruye el PDF localmente (api.download / api.view).
  const pdf = await pdfABuffer(doc);
  res.json({ archivo: `${o.codigo}.pdf`, tipo: 'application/pdf', base64: pdf.toString('base64') });
});

export default r;
