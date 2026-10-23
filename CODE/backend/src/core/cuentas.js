import { withTx } from './db.js';
import { HttpError } from './errors.js';
import { supabaseAdmin } from './supabase.js';

// Roles que se asignan a personal; "Sistema" (jobs) y "Cliente" (e-commerce) quedan fuera.
export const ROLES_EXCLUIDOS = ['Sistema', 'Cliente'];

export function errorSupabase(error) {
  if (/already|registered|exists/i.test(error.message)) return new HttpError(409, 'Ya existe una cuenta con ese correo.');
  return new HttpError(400, error.message);
}

export async function validarRolAsignable(db, rolId) {
  const { rows } = await db.query('SELECT nombre FROM rol WHERE id = $1', [rolId]);
  if (!rows[0] || ROLES_EXCLUIDOS.includes(rows[0].nombre)) throw new HttpError(400, 'Rol no asignable.');
}

// Crea la cuenta en Supabase Auth y la fila de `usuario` con el mismo id. Si la base falla, se borra la cuenta.
export async function crearCuenta({ nombre, correo, password, rol_id, sucursal_id = null, activo = true }) {
  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.createUser({ email: correo, password, email_confirm: true });
  if (error) throw errorSupabase(error);
  const id = data.user.id;
  try {
    await withTx(null, async (db) => {
      await validarRolAsignable(db, rol_id);
      await db.query(
        'INSERT INTO usuario (id, nombre, correo, rol_id, sucursal_id, activo) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, nombre, correo, rol_id, sucursal_id, activo]);
    });
  } catch (err) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
    throw err;
  }
  return id;
}
