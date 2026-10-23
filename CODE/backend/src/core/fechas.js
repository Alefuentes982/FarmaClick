import { z } from 'zod';

const diaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD).');
const rango = z.object({ desde: diaIso.optional(), hasta: diaIso.optional() })
  .refine((r) => !r.desde || !r.hasta || r.desde <= r.hasta, 'La fecha "desde" no puede ser posterior a "hasta".');

// Filtro por rango de días (inclusive) para listados y reportes: ?desde=AAAA-MM-DD&hasta=AAAA-MM-DD.
// Compartido por órdenes de compra, pedidos, ventas y reportes. Se usa con `condicionRango`.
export function rangoFechas(query) {
  const { desde, hasta } = rango.parse({ desde: query.desde || undefined, hasta: query.hasta || undefined });
  return { desde: desde ?? null, hasta: hasta ?? null };
}

// Condición sobre una columna timestamptz usando los días calendario de Chile; d y h son los números de parámetro.
export const condicionRango = (columna, d, h) =>
  `($${d}::date IS NULL OR ${columna} >= ($${d}::date)::timestamp AT TIME ZONE 'America/Santiago')
   AND ($${h}::date IS NULL OR ${columna} < (($${h}::date + 1)::timestamp AT TIME ZONE 'America/Santiago'))`;
