import { Router } from 'express';
import { pool, withTx } from '../../core/db.js';
import { rangoFechas } from '../../core/fechas.js';
import { listResponse, paging, uuid } from '../../core/sql.js';
import { excelListado, excelTurno } from './excel.js';
import { informeTurno } from './informe.js';
import { arqueoSchema, cierreForzadoSchema, correccionSchema, ESTADOS_TURNO, observacionSchema, revisionSchema } from './esquemas.js';
import {
  cerrarTurnoForzado, corregirTurno, detalleTurno, esSupervisor, listarTurnos, observarTurno, registrarArqueo, resumenPeriodo, revisarTurno,
} from './servicio.js';

const r = Router();

// Filtros comunes del listado y del resumen (el rango de fechas es por fecha de apertura del turno).
const filtros = (q) => ({
  sucursal_id: q.sucursal_id ? uuid.parse(q.sucursal_id) : null,
  caja_id: q.caja_id ? uuid.parse(q.caja_id) : null,
  usuario_id: q.usuario_id ? uuid.parse(q.usuario_id) : null,
  estado: ESTADOS_TURNO.includes(q.estado) ? q.estado : null,
});

r.get('/turnos', async (req, res) => {
  const { limit, page, offset } = paging(req.query);
  const rows = await listarTurnos(pool, req.user, filtros(req.query), { ...rangoFechas(req.query), limit, offset });
  res.json(listResponse(rows, { page, limit }));
});

// Personas que han abierto turnos (para filtrar por cajero). Solo para quien supervisa la caja.
r.get('/cajeros', async (req, res) => {
  if (!esSupervisor(req.user)) return res.json([]);
  const { rows } = await pool.query(
    'SELECT DISTINCT u.id, u.nombre FROM usuario u JOIN turno_caja t ON t.usuario_id = u.id ORDER BY u.nombre');
  return res.json(rows);
});

r.get('/resumen', async (req, res) => {
  res.json(await resumenPeriodo(pool, req.user, filtros(req.query), rangoFechas(req.query)));
});

r.get('/turnos/:id', async (req, res) => res.json(await detalleTurno(pool, uuid.parse(req.params.id), req.user)));

r.post('/turnos/:id/revision', async (req, res) => {
  const d = revisionSchema.parse(req.body);
  await withTx(req.usuarioId, (db) => revisarTurno(db, uuid.parse(req.params.id), req.user, d));
  res.status(201).json(await detalleTurno(pool, req.params.id, req.user));
});

// Corrección de un monto digitado: solo el Administrador, con motivo, antes de la revisión. Queda registrada.
r.post('/turnos/:id/correcciones', async (req, res) => {
  const d = correccionSchema.parse(req.body);
  const id = uuid.parse(req.params.id);
  await withTx(req.usuarioId, (db) => corregirTurno(db, id, req.user, d));
  res.status(201).json(await detalleTurno(pool, id, req.user));
});

// Observación: quien supervisa la caja o el cajero del turno, en cualquier estado. No se edita ni se borra.
r.post('/turnos/:id/observaciones', async (req, res) => {
  const d = observacionSchema.parse(req.body);
  const id = uuid.parse(req.params.id);
  await withTx(req.usuarioId, (db) => observarTurno(db, id, req.user, d));
  res.status(201).json(await detalleTurno(pool, id, req.user));
});

// Cierre por fuerza mayor del turno de otra persona: Administrador o Jefe de local, con el contado y un motivo.
r.post('/turnos/:id/cierre-forzado', async (req, res) => {
  const d = cierreForzadoSchema.parse(req.body);
  const id = uuid.parse(req.params.id);
  await withTx(req.usuarioId, (db) => cerrarTurnoForzado(db, id, req.user, d));
  res.status(201).json(await detalleTurno(pool, id, req.user));
});

// Arqueo de un turno cerrado automáticamente: Administrador o Jefe de local registran el efectivo contado.
r.post('/turnos/:id/arqueo', async (req, res) => {
  const d = arqueoSchema.parse(req.body);
  const id = uuid.parse(req.params.id);
  await withTx(req.usuarioId, (db) => registrarArqueo(db, id, req.user, d));
  res.status(201).json(await detalleTurno(pool, id, req.user));
});

r.get('/turnos/:id/pdf', async (req, res) => res.json(await informeTurno(pool, uuid.parse(req.params.id), req.user)));

// Excel (.xlsx): el listado con los mismos filtros de la pantalla, o la ficha de un turno.
r.get('/exportar', async (req, res) => res.json(await excelListado(pool, req.user, filtros(req.query), rangoFechas(req.query))));
r.get('/turnos/:id/excel', async (req, res) => res.json(await excelTurno(pool, uuid.parse(req.params.id), req.user)));

export default r;
