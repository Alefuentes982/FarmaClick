import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { autenticar, cargarUsuario } from '../../core/auth.js';
import { HttpError } from '../../core/errors.js';
import { supabaseAnon } from '../../core/supabase.js';

const r = Router();

const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Intente nuevamente en unos minutos.' },
});

const credenciales = z.object({ correo: z.string().trim().toLowerCase().email(), password: z.string().min(1) });

const perfil = (u) => ({
  id: u.id, nombre: u.nombre, correo: u.correo, rol: u.rol, sucursal_id: u.sucursal_id, permisos: u.permisos,
});

r.post('/login', limiteLogin, async (req, res) => {
  const { correo, password } = credenciales.parse(req.body);
  const { data, error } = await supabaseAnon().auth.signInWithPassword({ email: correo, password });
  if (error || !data?.session) throw new HttpError(401, 'Correo o contraseña incorrectos.');

  const usuario = await cargarUsuario(data.user.id);
  if (!usuario || !usuario.activo) throw new HttpError(403, 'Su cuenta no está habilitada.');
  if (usuario.permisos.length === 0) throw new HttpError(403, 'Su rol no tiene acceso a ningún módulo.');

  res.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    user: perfil(usuario),
  });
});

r.post('/refresh', async (req, res) => {
  const { refresh_token } = z.object({ refresh_token: z.string().min(1) }).parse(req.body);
  const { data, error } = await supabaseAnon().auth.refreshSession({ refresh_token });
  if (error || !data?.session) throw new HttpError(401, 'Sesión expirada.');
  res.json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
});

r.get('/me', autenticar, (req, res) => res.json(perfil(req.user)));

export default r;
