import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../AuthContext.jsx';
import { ErrorAlert } from '../../components/ui.jsx';
import logo from '../../assets/farmaclick-logo.svg';

export default function Login() {
  const { user, login } = useAuth();
  const location = useLocation();
  const [correo, setCorreo] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  if (user) return <Navigate to={location.state?.from ?? '/'} replace />;

  const enviar = async (e) => {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await login(correo, password);
    } catch (err) {
      setError(err);
      setEnviando(false);
    }
  };

  return (
    <div className="min-vh-100 d-flex align-items-center bg-light">
      <div className="container" style={{ maxWidth: 420 }}>
        <div className="text-center mb-4">
          <h1 className="m-0"><img src={logo} alt="FarmaClick" className="fc-logo-login" /></h1>
          <p className="text-muted mb-0">Ingrese con su cuenta</p>
        </div>
        <form className="card card-body shadow-sm" onSubmit={enviar}>
          <ErrorAlert error={error} />
          <div className="mb-3">
            <label className="form-label" htmlFor="correo">Correo</label>
            <input id="correo" type="email" className="form-control" autoComplete="username" required autoFocus
              value={correo} onChange={(e) => setCorreo(e.target.value)} />
          </div>
          <div className="mb-3">
            <label className="form-label" htmlFor="password">Contraseña</label>
            <input id="password" type="password" className="form-control" autoComplete="current-password" required
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button className="btn btn-primary" disabled={enviando}>{enviando ? 'Ingresando…' : 'Ingresar'}</button>
        </form>
      </div>
    </div>
  );
}
