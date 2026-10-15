// Tokens de la sesión en localStorage. Se envuelve en try/catch: puede estar bloqueado por el navegador.
const KEY = 'farmaclick.session';

export function getSession() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}
export function setSession(session) {
  try { localStorage.setItem(KEY, JSON.stringify(session)); } catch { /* sin persistencia */ }
}
export function clearSession() {
  try { localStorage.removeItem(KEY); } catch { /* nada que limpiar */ }
}
