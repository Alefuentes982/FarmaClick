import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { clearSession, getSession, setSession } from './session.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [cargando, setCargando] = useState(Boolean(getSession()));

  useEffect(() => {
    if (!getSession()) return;
    api.get('/auth/me')
      .then(setUser)
      .catch(() => clearSession())
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => {
    const alCerrar = () => setUser(null);
    window.addEventListener('auth:logout', alCerrar);
    return () => window.removeEventListener('auth:logout', alCerrar);
  }, []);

  const login = useCallback(async (correo, password) => {
    const { user: u, ...tokens } = await api.post('/auth/login', { correo, password });
    setSession(tokens);
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, cargando, login, logout, can: (clave) => Boolean(user?.permisos.includes(clave)) }),
    [user, cargando, login, logout]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
