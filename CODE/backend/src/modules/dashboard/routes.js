import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../core/db.js';
import { HttpError, notFound } from '../../core/errors.js';
import { rangoFechas } from '../../core/fechas.js';
import { uuid } from '../../core/sql.js';
import { archivoInforme } from './exportar.js';
import { buscarInforme, ejecutarInforme, INFORMES, puedeVer } from './informes.js';
import { resumenDashboard } from './resumen.js';

const r = Router();
const MAX_DIAS_RANGO = 731; // la serie diaria genera una fila por día

const parametros = z.object({
  dias: z.coerce.number().int().min(1).max(365).default(60),
  limite: z.coerce.number().int().min(1).max(1000).default(100),
});

async function filtros(q) {
  const { desde, hasta } = rangoFechas(q);
  if (desde && hasta && (Date.parse(hasta) - Date.parse(desde)) / 86_400_000 > MAX_DIAS_RANGO) {
    throw new HttpError(400, 'El rango no puede superar los 2 años.');
  }
  const sucursalId = q.sucursal_id ? uuid.parse(q.sucursal_id) : null;
  const sucursal = sucursalId ? (await pool.query('SELECT nombre FROM sucursal WHERE id = $1', [sucursalId])).rows[0] : null;
  if (sucursalId && !sucursal) throw notFound('Sucursal');
  return { desde, hasta, sucursal_id: sucursalId, sucursal_nombre: sucursal?.nombre ?? null, ...parametros.parse(q) };
}

const informeVisible = (req) => {
  const i = buscarInforme(req.params.id);
  if (!i || !puedeVer(req.user, i)) throw notFound('Informe');
  return i;
};

// Informes que el usuario puede ver (los de inventario y compras exigen además esos permisos).
r.get('/informes', (req, res) => {
  res.json(INFORMES.filter((i) => puedeVer(req.user, i)).map(({ id, titulo, grupo, descripcion, fechas }) => ({ id, titulo, grupo, descripcion, fechas: Boolean(fechas) })));
});

r.get('/resumen', async (req, res) => res.json(await resumenDashboard(pool, req.user, await filtros(req.query))));

r.get('/informes/:id', async (req, res) => {
  const informe = informeVisible(req);
  res.json(await ejecutarInforme(pool, informe, await filtros(req.query)));
});

// ?formato=csv|pdf|xlsx. Exporta todas las filas (hasta 1000), no solo las que muestra la pantalla.
r.get('/informes/:id/exportar', async (req, res) => {
  const informe = informeVisible(req);
  const formato = z.enum(['csv', 'pdf', 'xlsx']).parse(req.query.formato);
  const f = await filtros({ ...req.query, limite: 1000 });
  res.json(await archivoInforme(await ejecutarInforme(pool, informe, f), formato, f));
});

export default r;
