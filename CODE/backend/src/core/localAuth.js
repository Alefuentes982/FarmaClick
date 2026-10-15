// Sustituto de Supabase Auth SOLO para desarrollo local (AUTH_MODE=local). Imita la parte de la API de
// supabase-js que usa el backend, de modo que el resto del código no cambia. No usar en producción.
import crypto from 'node:crypto';
import { pool } from './db.js';

const SECRET = process.env.LOCAL_AUTH_SECRET || 'farmaclick-solo-desarrollo-local';
const ACCESS_SEG = 60 * 60;
const REFRESH_SEG = 7 * 24 * 60 * 60;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const firma = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

function firmar(sub, tipo, seg) {
  const cuerpo = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, tipo, exp: Math.floor(Date.now() / 1000) + seg })}`;
  return `${cuerpo}.${firma(cuerpo)}`;
}

function verificar(token, tipo) {
  const [h, p, s] = String(token).split('.');
  if (!h || !p || !s) return null;
  const esperada = Buffer.from(firma(`${h}.${p}`));
  const recibida = Buffer.from(s);
  if (esperada.length !== recibida.length || !crypto.timingSafeEqual(esperada, recibida)) return null;
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  return payload.tipo === tipo && payload.exp > Date.now() / 1000 ? payload : null;
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

function passwordOk(password, guardado) {
  const [salt, hash] = guardado.split(':');
  const calculado = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(calculado, Buffer.from(hash, 'hex'));
}

const sesion = (id) => ({ access_token: firmar(id, 'access', ACCESS_SEG), refresh_token: firmar(id, 'refresh', REFRESH_SEG) });
const fallo = (message) => ({ data: null, error: { message } });

const auth = {
  async signInWithPassword({ email, password }) {
    const { rows } = await pool.query('SELECT usuario_id, password_hash FROM dev_credencial WHERE correo = $1', [email]);
    if (!rows[0] || !passwordOk(password, rows[0].password_hash)) return fallo('Invalid login credentials');
    return { data: { user: { id: rows[0].usuario_id }, session: sesion(rows[0].usuario_id) }, error: null };
  },

  async refreshSession({ refresh_token }) {
    const p = verificar(refresh_token, 'refresh');
    return p ? { data: { user: { id: p.sub }, session: sesion(p.sub) }, error: null } : fallo('Invalid refresh token');
  },

  async getUser(token) {
    const p = verificar(token, 'access');
    return p ? { data: { user: { id: p.sub } }, error: null } : fallo('Invalid token');
  },

  admin: {
    async createUser({ email, password }) {
      const id = crypto.randomUUID();
      try {
        await pool.query('INSERT INTO dev_credencial (usuario_id, correo, password_hash) VALUES ($1,$2,$3)',
          [id, email, hashPassword(password)]);
      } catch (err) {
        if (err.code === '23505') return fallo('User already registered');
        throw err;
      }
      return { data: { user: { id } }, error: null };
    },

    async deleteUser(id) {
      await pool.query('DELETE FROM dev_credencial WHERE usuario_id = $1', [id]);
      return { data: null, error: null };
    },

    async updateUserById(id, { email, password }) {
      try {
        const { rowCount } = await pool.query(
          `UPDATE dev_credencial SET correo = COALESCE($2, correo), password_hash = COALESCE($3, password_hash)
            WHERE usuario_id = $1`, [id, email ?? null, password ? hashPassword(password) : null]);
        if (!rowCount) return fallo('User not found');
      } catch (err) {
        if (err.code === '23505') return fallo('User already registered');
        throw err;
      }
      return { data: null, error: null };
    },
  },
};

export const localClient = { auth };
