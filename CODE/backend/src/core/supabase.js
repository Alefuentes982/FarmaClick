import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { HttpError } from './errors.js';
import { localClient } from './localAuth.js';

const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const cache = {};

// AUTH_MODE=local sustituye Supabase Auth por una autenticación de desarrollo (ver localAuth.js).
if (process.env.AUTH_MODE === 'local' && process.env.NODE_ENV === 'production') {
  throw new Error('AUTH_MODE=local no se puede usar con NODE_ENV=production.');
}
const local = process.env.AUTH_MODE === 'local';

function client(nombre, keyEnv) {
  if (local) return localClient;
  if (!cache[nombre]) {
    if (!process.env.SUPABASE_URL || !process.env[keyEnv]) {
      throw new HttpError(500, `Falta configurar SUPABASE_URL y ${keyEnv} en el .env del backend.`);
    }
    cache[nombre] = createClient(process.env.SUPABASE_URL, process.env[keyEnv], opts);
  }
  return cache[nombre];
}

// Cliente con la anon key: iniciar sesión, refrescar y validar tokens.
export const supabaseAnon = () => client('anon', 'SUPABASE_ANON_KEY');
// Cliente con la service role key: crear y modificar cuentas. Nunca debe llegar al frontend.
export const supabaseAdmin = () => client('admin', 'SUPABASE_SERVICE_ROLE_KEY');
