import { z } from 'zod';

export function paging(q) {
  const limit = Math.min(Math.max(parseInt(q.limit) || 20, 1), 500);
  const page = Math.max(parseInt(q.page) || 1, 1);
  return { limit, page, offset: (page - 1) * limit };
}

// Patrón para ILIKE: escapa \ % _ para que lo escrito por el usuario se busque literalmente.
export const likeParam = (q) => (q && String(q).trim() ? `%${String(q).trim().replace(/[\\%_]/g, '\\$&')}%` : null);

// Las claves provienen de un esquema zod (nunca del request crudo), por eso es seguro interpolarlas.
export function buildUpdate(table, data, id) {
  const keys = Object.keys(data);
  if (!keys.length) return null;
  const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  return { text: `UPDATE ${table} SET ${sets} WHERE id = $${keys.length + 1}`, values: [...keys.map((k) => data[k]), id] };
}

export const uuid = z.string().uuid('Identificador inválido.');

export const optionalText = (max) =>
  z.string().trim().max(max).nullish().transform((v) => (v ? v : null));

// Los listados seleccionan COUNT(*) OVER() AS total_filas (no "total": choca con columnas de dinero).
export function listResponse(rows, { page, limit }) {
  const total = rows.length ? Number(rows[0].total_filas) : 0;
  return { data: rows.map(({ total_filas: _n, ...r }) => r), total, page, limit };
}
