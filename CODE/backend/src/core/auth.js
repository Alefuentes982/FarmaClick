import { pool } from './db.js';
import { HttpError } from './errors.js';
import { supabaseAnon } from './supabase.js';

export async function cargarUsuario(id) {
  const { rows } = await pool.query(
    `SELECT u.id, u.nombre, u.correo, u.activo, u.sucursal_id, r.id AS rol_id, r.nombre AS rol
       FROM usuario u JOIN rol r ON r.id = u.rol_id WHERE u.id = $1`, [id]);
  if (!rows[0]) return null;
  const perm = await pool.query(
    `SELECT m.clave FROM rol_permiso rp JOIN modulo m ON m.id = rp.modulo_id
      WHERE rp.rol_id = $1 AND rp.permitido ORDER BY m.clave`, [rows[0].rol_id]);
  return { ...rows[0], permisos: perm.rows.map((p) => p.clave) };
}

// Valida el token contra Supabase Auth. Se cachea 60 s para no hacer un viaje de red por cada request.
const tokens = new Map();
async function idDesdeToken(token) {
  const hit = tokens.get(token);
  if (hit && hit.exp > Date.now()) return hit.id;
  const { data, error } = await supabaseAnon().auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, 'Sesión inválida o expirada.');
  if (tokens.size > 500) tokens.clear();
  tokens.set(token, { id: data.user.id, exp: Date.now() + 60_000 });
  return data.user.id;
}

// Exige un usuario autenticado, activo y registrado en la tabla usuario. Los permisos se leen en cada
// request (no en el token): quitar un permiso o dar de baja a alguien surte efecto de inmediato.
export async function autenticar(req, _res, next) {
  try {
    const token = req.header('authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) throw new HttpError(401, 'Debe iniciar sesión.');
    const usuario = await cargarUsuario(await idDesdeToken(token));
    if (!usuario || !usuario.activo) throw new HttpError(403, 'Su cuenta no está habilitada.');
    req.user = usuario;
    req.usuarioId = usuario.id; // atribución de movimientos y órdenes (app.usuario_id)
    next();
  } catch (err) {
    next(err);
  }
}

// exigeModulo('inventario', ['proveedores']): escribir requiere el módulo; leer admite además los módulos
// de `lectura` (p. ej. el formulario de productos necesita listar proveedores).
export const exigeModulo = (clave, lectura = []) => (req, _res, next) => {
  const lee = req.method === 'GET' || req.method === 'HEAD';
  const permitidos = lee ? [clave, ...lectura] : [clave];
  if (permitidos.some((c) => req.user.permisos.includes(c))) return next();
  next(new HttpError(403, 'No tiene permiso para este módulo.'));
};
