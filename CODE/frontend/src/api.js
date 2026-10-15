import { clearSession, getSession, setSession } from './session.js';

const BASE = import.meta.env.VITE_API_URL ?? '/api';

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const send = (path, { method = 'GET', body } = {}, token) =>
  fetch(BASE + path, {
    method,
    headers: {
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

// Una sola renovación a la vez aunque varias peticiones fallen con 401 simultáneamente.
let renovando = null;
function renovar(refreshToken) {
  renovando ??= send('/auth/refresh', { method: 'POST', body: { refresh_token: refreshToken } })
    .then(async (res) => {
      if (!res.ok) return null;
      const nueva = await res.json();
      setSession(nueva);
      return nueva;
    })
    .catch(() => null)
    .finally(() => { renovando = null; });
  return renovando;
}

async function request(path, opts = {}) {
  const sesion = getSession();
  let res = await send(path, opts, sesion?.access_token);

  if (res.status === 401 && sesion?.refresh_token && !path.startsWith('/auth/')) {
    const nueva = await renovar(sesion.refresh_token);
    if (nueva) res = await send(path, opts, nueva.access_token);
  }
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    clearSession();
    window.dispatchEvent(new Event('auth:logout'));
  }

  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error || `Error ${res.status}`, res.status, data?.details);
  return data;
}

export const qs = (params) => {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v !== '' && v != null && p.set(k, v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  get: (p) => request(p),
  post: (p, body = {}) => request(p, { method: 'POST', body }),
  put: (p, body) => request(p, { method: 'PUT', body }),
  patch: (p, body) => request(p, { method: 'PATCH', body }),
};
