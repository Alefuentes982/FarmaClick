import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../AuthContext.jsx';
import { fechaHora, money } from '../../format.js';
import { useAsync } from '../../components/ui.jsx';

// Sección "Devoluciones" de la ficha del pedido (slot pedido.detalle): historial y acceso para devolver.
export default function PedidoDevoluciones({ pedido }) {
  const { can } = useAuth();
  const permitido = can('devoluciones');
  const { data } = useAsync(() => (permitido ? api.get(`/devoluciones?pedido_id=${pedido.id}&limit=100`) : Promise.resolve(null)), [pedido.id, permitido]);
  if (!permitido) return null;
  const devoluciones = data?.data ?? [];
  if (devoluciones.length === 0 && pedido.estado !== 'Entregado') return null;

  return (
    <div className="mt-4">
      <div className="d-flex justify-content-between align-items-center">
        <h3 className="h5 mb-0">Devoluciones</h3>
        {pedido.estado === 'Entregado' && (
          <Link to={`/devoluciones/nueva?pedido=${pedido.id}`} className="btn btn-outline-danger btn-sm"><i className="bi bi-arrow-return-left me-1" />Devolver productos</Link>
        )}
      </div>
      {devoluciones.length === 0 ? <p className="text-muted mt-2">Este pedido no tiene devoluciones.</p> : (
        <table className="table table-sm mt-2">
          <thead><tr><th>N°</th><th>Fecha</th><th>Motivo</th><th>Atendió</th><th className="text-end">Devuelto</th></tr></thead>
          <tbody>
            {devoluciones.map((d) => (
              <tr key={d.id}>
                <td className="font-monospace"><Link to={`/devoluciones/${d.id}`}>{d.codigo}</Link></td>
                <td>{fechaHora(d.fecha)}</td><td>{d.motivo}</td><td>{d.usuario}</td><td className="text-end">{money(d.total_reembolso)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
