import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import { Spinner } from './components/ui.jsx';
import modulos from './modules/index.js';
import Login from './modules/auth/Login.jsx';
import logo from './assets/farmaclick-logo.svg';

const entradas = modulos
  .flatMap((m) => m.nav.map((n) => ({ ...n, modulo: m.modulo })))
  .sort((a, b) => a.orden - b.orden);

function Layout() {
  const { user, logout, can } = useAuth();
  return (
    <>
      <header className="fc-topbar">
        <div className="container d-flex align-items-center justify-content-between py-2">
          <img src={logo} alt="FarmaClick" className="fc-logo" />
          <div className="d-flex align-items-center gap-3 text-nowrap fc-topbar-usuario">
            <span className="small text-truncate" title={`${user.nombre} · ${user.rol}`}><i className="bi bi-person-circle me-1" />{user.nombre} · {user.rol}</span>
            <button className="btn btn-sm btn-outline-secondary" onClick={logout}>Salir</button>
          </div>
        </div>
      </header>
      <nav className="fc-nav" aria-label="Módulos">
        <div className="container">
          <div className="fc-nav-lista">
            {entradas.filter((e) => can(e.modulo)).map((e) => (
              <NavLink key={e.to} to={e.to} className="nav-link"><i className={`bi ${e.icon} me-1`} />{e.label}</NavLink>
            ))}
          </div>
        </div>
      </nav>
      <main className="container pb-5">
        <Routes>
          <Route path="/" element={<Inicio />} />
          {modulos.flatMap((m) => m.rutas.map((r) => (
            <Route key={r.path} path={r.path} element={<Guard modulo={m.modulo}>{r.element}</Guard>} />
          )))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}

// Redirige al primer módulo al que el usuario tiene acceso.
function Inicio() {
  const { can } = useAuth();
  const primera = entradas.find((e) => can(e.modulo));
  return primera ? <Navigate to={primera.to} replace /> : <div className="alert alert-warning">Su rol no tiene módulos habilitados.</div>;
}

// El permiso real lo exige el backend; esto solo evita mostrar pantallas que fallarían.
function Guard({ modulo, children }) {
  const { can } = useAuth();
  return can(modulo) ? children : <div className="alert alert-warning">No tiene permiso para acceder a este módulo.</div>;
}

export default function App() {
  const { user, cargando } = useAuth();
  const location = useLocation();
  if (cargando) return <Spinner />;
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname }} />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Layout />} />
    </Routes>
  );
}
