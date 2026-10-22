import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { autenticar, exigeModulo } from './core/auth.js';
import { routerCatalogos } from './core/catalogos.js';
import { errorHandler, HttpError } from './core/errors.js';
import { pool } from './core/db.js';
import modulos from './modules/index.js';

export const app = express();
// Saltos de proxy delante de la API, para que el rate limit vea la IP real del cliente: 1 con un solo proxy (hosting o
// Nginx); 2 en Oracle Cloud (balanceador → Nginx → API). Se define con TRUST_PROXY.
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true }));
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));
// Consulta mínima a la base: la usa el flujo de mantención para que Supabase no pause el proyecto por inactividad.
app.get('/api/health/db', async (_req, res, next) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); } catch (err) { next(err); }
});

// Cada módulo exige sesión y su permiso (rol_permiso), salvo los públicos.
for (const m of modulos) {
  if (!m.publico && !m.modulo) throw new Error(`El módulo "${m.nombre}" debe declarar su clave de permiso.`);
  const guardas = m.publico ? [] : [autenticar, exigeModulo(m.modulo, m.lectura)];
  for (const { ruta, router } of m.rutas) app.use(ruta, ...guardas, router);
}
app.use('/api/catalogos', autenticar, routerCatalogos(modulos)); // cualquier usuario con sesión

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Ruta no encontrada.')));
app.use(errorHandler);
