import { Router } from 'express';
import { z } from 'zod';
import { pool, withTx } from '../../core/db.js';
import { HttpError, notFound } from '../../core/errors.js';
import { supabaseAdmin } from '../../core/supabase.js';
import { crearCuenta, errorSupabase, ROLES_EXCLUIDOS, validarRolAsignable } from '../../core/cuentas.js';
import { buildUpdate, likeParam, listResponse, paging, uuid } from '../../core/sql.js';

const r = Router();

const correo = z.string().trim().toLowerCase().email().max(150);
const password = z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.').max(72);
const campos = {
  nombre: z.string().trim().min(1).max(150),
  correo,
  rol_id: uuid,
  sucursal_id: uuid.nullish().transform((v) => v ?? null),
  activo: z.boolean(),
};
const crear = z.object({ ...campos, password, activo: campos.activo.default(true) });
const actualizar = z.object({ ...campos, password }).partial();

const SELECT = `
  SELECT u.id, u.nombre, u.correo, u.activo, u.rol_id, r.nombre AS rol, u.sucursal_id, s.nombre AS sucursal
    FROM usuario u JOIN rol r ON r.id = u.rol_id LEFT JOIN sucursal s ON s.id = u.sucursal_id`;
const SOLO_PERSONAL = 'r.nombre <> ALL($1::text[])';

async function getUsuario(db, id) {
  const { rows } = await db.query(`${SELECT} WHERE u.id = $2 AND ${SOLO_PERSONAL}`, [ROLES_EXCLUIDOS, id]);
  if (!rows[0]) throw notFound('Usuario');
  return rows[0];
}

r.get('/', async (req, res) => {
  const { limit, page, offset } = paging(req.query);
  const { rows } = await pool.query(
    `SELECT COUNT(*) OVER() AS total_filas, u.id, u.nombre, u.correo, u.activo, u.rol_id, r.nombre AS rol, u.sucursal_id, s.nombre AS sucursal
       FROM usuario u JOIN rol r ON r.id = u.rol_id LEFT JOIN sucursal s ON s.id = u.sucursal_id
      WHERE ${SOLO_PERSONAL} AND ($2::text IS NULL OR u.nombre ILIKE $2 OR u.correo ILIKE $2)
      ORDER BY u.nombre LIMIT $3 OFFSET $4`,
    [ROLES_EXCLUIDOS, likeParam(req.query.q), limit, offset]);
  res.json(listResponse(rows, { page, limit }));
});

r.get('/:id', async (req, res) => res.json(await getUsuario(pool, req.params.id)));

r.post('/', async (req, res) => {
  const d = crear.parse(req.body);
  const id = await crearCuenta(d);
  res.status(201).json(await getUsuario(pool, id));
});

r.put('/:id', async (req, res) => {
  const { password: nueva, ...datos } = actualizar.parse(req.body);
  const propio = req.params.id === req.user.id;
  if (propio && (datos.activo === false || (datos.rol_id && datos.rol_id !== req.user.rol_id))) {
    throw new HttpError(409, 'No puede desactivarse ni cambiar su propio rol.');
  }
  await withTx(req.usuarioId, async (db) => {
    const actual = await getUsuario(db, req.params.id);
    if (datos.rol_id && datos.rol_id !== actual.rol_id) await validarRolAsignable(db, datos.rol_id);
    const upd = buildUpdate('usuario', datos, req.params.id);
    if (upd) await db.query(upd.text, upd.values);
    // La cuenta de Auth se actualiza dentro de la transacción: si falla, la base también se revierte.
    if (datos.correo || nueva) {
      const { error } = await supabaseAdmin().auth.admin.updateUserById(req.params.id, {
        ...(datos.correo && { email: datos.correo, email_confirm: true }),
        ...(nueva && { password: nueva }),
      });
      if (error) throw errorSupabase(error);
    }
  });
  res.json(await getUsuario(pool, req.params.id));
});

export default r;
