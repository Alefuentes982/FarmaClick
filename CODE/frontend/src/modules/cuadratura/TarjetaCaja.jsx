import { api, qs } from '../../api.js';
import { useAuth } from '../../AuthContext.jsx';
import { money } from '../../format.js';
import Kpi from '../../components/Kpi.jsx';
import { useAsync } from '../../components/ui.jsx';

// Tarjeta de caja en el dashboard (slot dashboard.tarjetas): diferencia neta y turnos pendientes de revisión.
export default function TarjetaCaja({ desde, hasta, sucursalId }) {
  const { can } = useAuth();
  const permitido = can('cuadratura');
  const { data: s } = useAsync(
    () => (permitido ? api.get(`/cuadratura/resumen${qs({ desde, hasta, sucursal_id: sucursalId })}`) : Promise.resolve(null)),
    [permitido, desde, hasta, sucursalId]);
  if (!s) return null;
  const dif = Number(s.diferencia_neta);
  return (
    <Kpi titulo="Caja" to="/cuadratura" clase={dif === 0 ? 'text-success' : 'text-danger'}
      valor={dif === 0 ? 'Cuadra' : `${dif < 0 ? '-' : '+'}${money(Math.abs(dif))}`}
      sub={s.sin_revisar ? `${s.sin_revisar} turno(s) sin revisar` : `${s.cerrados} turno(s) cerrado(s), al día`} />
  );
}
