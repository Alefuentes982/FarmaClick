import { Router } from 'express';
import { z } from 'zod';
import { pool, withTx } from '../../core/db.js';
import { notFound } from '../../core/errors.js';
import { buildUpdate, likeParam, listResponse, paging, uuid } from '../../core/sql.js';

const r = Router();

// margen_utilidad es un recargo sobre el costo (0.35 = 35 %); precio lo genera la base.
const campos = {
  sku: z.string().trim().min(1).max(50),
  nombre: z.string().trim().min(1).max(200),
  margen_utilidad: z.number().min(0).max(99.99),
  activo: z.boolean(),
  requiere_vencimiento: z.boolean(),
  requiere_lote: z.boolean(),
  categoria_id: uuid,
  condicion_venta_id: uuid,
};
// El costo solo se informa al crear; después lo mantiene el PMP de cada recepción de OC.
const crear = z.object({
  ...campos,
  costo: z.number().min(0).default(0),
  activo: campos.activo.default(true),
  requiere_vencimiento: campos.requiere_vencimiento.default(true),
  requiere_lote: campos.requiere_lote.default(true),
});
const actualizar = z.object(campos).partial();
const proveedoresSchema = z
  .array(z.object({ proveedor_id: uuid, costo_referencial: z.number().min(0), es_principal: z.boolean().default(false) }))
  .refine((l) => l.filter((p) => p.es_principal).length <= 1, 'Solo un proveedor puede ser principal.')
  .refine((l) => new Set(l.map((p) => p.proveedor_id)).size === l.length, 'Proveedor repetido.');

const COLUMNAS = `p.id, p.sku, p.nombre, p.costo, p.margen_utilidad, p.precio, p.activo, p.stock_total_web,
         p.requiere_vencimiento, p.requiere_lote, p.categoria_id, c.nombre AS categoria,
         p.condicion_venta_id, cv.nombre AS condicion_venta`;
const FROM = `FROM producto p
    JOIN categoria c ON c.id = p.categoria_id
    JOIN condicion_venta cv ON cv.id = p.condicion_venta_id`;

async function getProducto(db, id) {
  const { rows } = await db.query(`SELECT ${COLUMNAS} ${FROM} WHERE p.id = $1`, [id]);
  if (!rows[0]) throw notFound('Producto');
  const prov = await db.query(
    `SELECT pp.proveedor_id, pr.nombre AS proveedor, pp.costo_referencial, pp.es_principal
       FROM producto_proveedor pp JOIN proveedor pr ON pr.id = pp.proveedor_id
      WHERE pp.producto_id = $1 ORDER BY pp.es_principal DESC, pr.nombre`, [id]);
  return { ...rows[0], proveedores: prov.rows };
}

r.get('/', async (req, res) => {
  const { limit, page, offset } = paging(req.query);
  const activo = req.query.activo === 'true' ? true : req.query.activo === 'false' ? false : null;
  const categoria = req.query.categoria_id || null;
  const { rows } = await pool.query(
    `SELECT COUNT(*) OVER() AS total_filas, ${COLUMNAS} ${FROM}
      WHERE ($1::text IS NULL OR p.sku ILIKE $1 OR p.nombre ILIKE $1)
        AND ($2::boolean IS NULL OR p.activo = $2)
        AND ($3::uuid IS NULL OR p.categoria_id = $3)
      ORDER BY p.nombre LIMIT $4 OFFSET $5`,
    [likeParam(req.query.q), activo, categoria, limit, offset]);
  res.json(listResponse(rows, { page, limit }));
});

// Productos que ofrece un proveedor, con su costo referencial (ficha del proveedor y órdenes de compra).
r.get('/proveedor/:proveedorId', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT p.id AS producto_id, p.sku, p.nombre, p.activo, pp.costo_referencial, pp.es_principal
       FROM producto_proveedor pp JOIN producto p ON p.id = pp.producto_id
      WHERE pp.proveedor_id = $1 ORDER BY p.nombre`, [req.params.proveedorId]);
  res.json(rows);
});

r.get('/:id', async (req, res) => res.json(await getProducto(pool, req.params.id)));

r.post('/', async (req, res) => {
  const d = crear.parse(req.body);
  const { rows } = await pool.query(
    `INSERT INTO producto (sku, nombre, costo, margen_utilidad, activo, requiere_vencimiento, requiere_lote, categoria_id, condicion_venta_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [d.sku, d.nombre, d.costo, d.margen_utilidad, d.activo, d.requiere_vencimiento, d.requiere_lote, d.categoria_id, d.condicion_venta_id]);
  res.status(201).json(await getProducto(pool, rows[0].id));
});

r.put('/:id', async (req, res) => {
  const upd = buildUpdate('producto', actualizar.parse(req.body), req.params.id);
  if (upd) {
    const { rowCount } = await pool.query(upd.text, upd.values);
    if (!rowCount) throw notFound('Producto');
  }
  res.json(await getProducto(pool, req.params.id));
});

// "Eliminar" = dar de baja (el backend no tiene DELETE sobre producto y el kardex lo referencia).
r.patch('/:id/activo', async (req, res) => {
  const { activo } = z.object({ activo: z.boolean() }).parse(req.body);
  const { rowCount } = await pool.query('UPDATE producto SET activo = $1 WHERE id = $2', [activo, req.params.id]);
  if (!rowCount) throw notFound('Producto');
  res.json(await getProducto(pool, req.params.id));
});

// Reemplaza el conjunto de proveedores del producto.
r.put('/:id/proveedores', async (req, res) => {
  const lista = proveedoresSchema.parse(req.body);
  await withTx(null, async (db) => {
    const { rowCount } = await db.query('SELECT 1 FROM producto WHERE id = $1', [req.params.id]);
    if (!rowCount) throw notFound('Producto');
    await db.query('DELETE FROM producto_proveedor WHERE producto_id = $1', [req.params.id]);
    for (const p of lista) {
      await db.query(
        'INSERT INTO producto_proveedor (producto_id, proveedor_id, costo_referencial, es_principal) VALUES ($1,$2,$3,$4)',
        [req.params.id, p.proveedor_id, p.costo_referencial, p.es_principal]);
    }
  });
  res.json(await getProducto(pool, req.params.id));
});

export default r;
