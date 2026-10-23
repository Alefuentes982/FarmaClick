import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../core/db.js';
import { HttpError } from '../../core/errors.js';
import { likeParam, listResponse, paging, uuid } from '../../core/sql.js';

const r = Router();

// Existencias por producto y sucursal, calculadas desde los lotes (la base los mantiene con triggers).
//   disponible = unidades vendibles (lotes sin vencer); vencido = unidades en lotes vencidos.
r.get('/', async (req, res) => {
  const { limit, page, offset } = paging(req.query);
  const soloBajo = req.query.solo_bajo_minimo === 'true';
  const { rows } = await pool.query(
    `WITH hoy AS (SELECT (NOW() AT TIME ZONE 'America/Santiago')::date AS d),
          pares AS (SELECT producto_id, sucursal_id FROM lote UNION SELECT producto_id, sucursal_id FROM stock_minimo_sucursal),
          agg AS (
            SELECT l.producto_id, l.sucursal_id,
                   COALESCE(SUM(l.cantidad_actual), 0)::int AS total,
                   COALESCE(SUM(l.cantidad_actual) FILTER (WHERE l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= hoy.d), 0)::int AS disponible,
                   COALESCE(SUM(l.cantidad_actual) FILTER (WHERE l.fecha_vencimiento < hoy.d), 0)::int AS vencido,
                   MIN(l.fecha_vencimiento) FILTER (WHERE l.cantidad_actual > 0 AND l.fecha_vencimiento >= hoy.d) AS proximo_vencimiento
              FROM lote l CROSS JOIN hoy GROUP BY l.producto_id, l.sucursal_id),
          base AS (
            SELECT p.id AS producto_id, p.sku, p.nombre AS producto, p.activo, s.id AS sucursal_id, s.nombre AS sucursal,
                   COALESCE(a.total, 0) AS total, COALESCE(a.disponible, 0) AS disponible, COALESCE(a.vencido, 0) AS vencido,
                   a.proximo_vencimiento, COALESCE(m.stock_minimo, 0) AS stock_minimo,
                   (COALESCE(m.stock_minimo, 0) > 0 AND COALESCE(a.disponible, 0) < m.stock_minimo) AS bajo_minimo
              FROM pares pa
              JOIN producto p ON p.id = pa.producto_id
              JOIN sucursal s ON s.id = pa.sucursal_id
              LEFT JOIN agg a ON a.producto_id = pa.producto_id AND a.sucursal_id = pa.sucursal_id
              LEFT JOIN stock_minimo_sucursal m ON m.producto_id = pa.producto_id AND m.sucursal_id = pa.sucursal_id)
     SELECT COUNT(*) OVER() AS total_filas, b.*
       FROM base b
      WHERE ($1::uuid IS NULL OR b.sucursal_id = $1)
        AND ($2::text IS NULL OR b.sku ILIKE $2 OR b.producto ILIKE $2)
        AND (NOT $3::boolean OR b.bajo_minimo)
      ORDER BY b.producto, b.sucursal LIMIT $4 OFFSET $5`,
    [req.query.sucursal_id || null, likeParam(req.query.q), soloBajo, limit, offset]);
  res.json(listResponse(rows, { page, limit }));
});

const minimo = z.object({ producto_id: uuid, sucursal_id: uuid, stock_minimo: z.number().int().min(0) });

// Fija el stock mínimo de un producto en una sucursal (alerta de reposición).
r.put('/minimo', async (req, res) => {
  const d = minimo.parse(req.body);
  const { rowCount } = await pool.query(
    `INSERT INTO stock_minimo_sucursal (producto_id, sucursal_id, stock_minimo) VALUES ($1,$2,$3)
     ON CONFLICT (producto_id, sucursal_id) DO UPDATE SET stock_minimo = EXCLUDED.stock_minimo`,
    [d.producto_id, d.sucursal_id, d.stock_minimo]);
  if (!rowCount) throw new HttpError(500, 'No se pudo guardar el stock mínimo.');
  res.json(d);
});

export default r;
