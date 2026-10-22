import { Link } from 'react-router-dom';
import { useAuth } from '../../AuthContext.jsx';

// Acceso a Devoluciones desde la barra del turno de la caja (slot pos.acciones).
export default function AccionCaja() {
  const { can } = useAuth();
  if (!can('devoluciones')) return null;
  return (
    <Link to="/devoluciones/nueva" className="btn btn-outline-danger btn-sm"><i className="bi bi-arrow-return-left me-1" />Devolución</Link>
  );
}
