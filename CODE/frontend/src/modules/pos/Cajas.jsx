import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { fechaHora } from '../../format.js';
import { useAuth } from '../../AuthContext.jsx';
import { ErrorAlert, PageHeader, Seccion, Spinner, useAsync } from '../../components/ui.jsx';
import { esAdministrador } from '../../roles.js';

// Configuración de cajas: el Administrador (todas las sucursales) y el Jefe de local (las de su sucursal). Una sucursal
// puede tener varias cajas; cada una admite un turno abierto a la vez. El Administrador define además qué sucursales
// son farmacia de turno (24 horas): en ellas la caja no se cierra automáticamente a las 23:59.
export default function Cajas() {
  const { user } = useAuth();
  const admin = esAdministrador(user);
  const cajas = useAsync(() => api.get('/pos/cajas'), []);
  const catalogos = useAsync(() => api.get('/catalogos'), []);
  const sucursales = useAsync(() => api.get('/pos/sucursales'), []);
  // El Jefe de local con sucursal asignada solo crea cajas en la suya.
  const opciones = (catalogos.data?.sucursales ?? []).filter((x) => admin || !user.sucursal_id || x.id === user.sucursal_id);
  const [sucursal, setSucursal] = useState('');
  const [error, setError] = useState(null);

  const ejecutar = async (fn) => {
    setError(null);
    try { await fn(); cajas.reload(); sucursales.reload(); } catch (e) { setError(e); }
  };

  return (
    <>
      <PageHeader title="Cajas">
        <Link to="/pos" className="btn btn-outline-secondary">Volver a la caja</Link>
      </PageHeader>
      <ErrorAlert error={cajas.error || error} onClose={() => setError(null)} />
      <div className="row g-2 mb-3" style={{ maxWidth: 560 }}>
        <div className="col">
          <select className="form-select" value={sucursal} onChange={(e) => setSucursal(e.target.value)}>
            <option value="">Sucursal de la nueva caja…</option>
            {opciones.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
        <div className="col-auto">
          <button className="btn btn-primary" disabled={!sucursal} onClick={() => ejecutar(() => api.post('/pos/cajas', { sucursal_id: sucursal }))}>
            <i className="bi bi-plus-lg me-1" />Nueva caja
          </button>
        </div>
      </div>
      <Seccion titulo="Horario de las sucursales" icono="bi-moon-stars" plano>
        <div className="table-responsive">
          <table className="table align-middle">
            <thead><tr><th>Sucursal</th><th>Cierre de caja</th><th /></tr></thead>
            <tbody>
              {sucursales.data?.map((x) => (
                <tr key={x.id}>
                  <td>{x.nombre}</td>
                  <td>
                    {x.farmacia_de_turno
                      ? <span className="badge text-bg-primary"><i className="bi bi-moon-stars me-1" />Farmacia de turno · 24 horas, sin cierre automático</span>
                      : <span className="text-muted">Automático a las 23:59 si la caja sigue abierta</span>}
                  </td>
                  <td className="text-end">
                    {admin && (
                      <button className="btn btn-sm btn-outline-secondary"
                        onClick={() => {
                          const msg = x.farmacia_de_turno
                            ? `¿Quitar a ${x.nombre} como farmacia de turno? Sus cajas se cerrarán automáticamente a las 23:59.`
                            : `¿Marcar ${x.nombre} como farmacia de turno (24 horas)? Sus cajas no se cerrarán automáticamente.`;
                          if (window.confirm(msg)) ejecutar(() => api.patch(`/pos/sucursales/${x.id}`, { farmacia_de_turno: !x.farmacia_de_turno }));
                        }}>
                        {x.farmacia_de_turno ? 'Quitar farmacia de turno' : 'Marcar como farmacia de turno'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!admin && <div className="small text-muted px-3 pb-2">Solo el Administrador define las farmacias de turno.</div>}
      </Seccion>

      {cajas.loading && !cajas.data ? <Spinner /> : (
        <table className="table align-middle">
          <thead><tr><th>Sucursal</th><th>Caja</th><th>Estado</th><th>Turno abierto</th><th /></tr></thead>
          <tbody>
            {cajas.data?.length === 0 && <tr><td colSpan="5" className="text-center text-muted py-4">Sin cajas</td></tr>}
            {cajas.data?.map((c) => (
              <tr key={c.id}>
                <td>{c.sucursal}</td><td>Caja {c.numero}</td>
                <td><span className={`badge text-bg-${c.activa ? 'success' : 'secondary'}`}>{c.activa ? 'Activa' : 'Desactivada'}</span></td>
                <td>{c.turno_id ? `${c.usuario_turno} · desde ${fechaHora(c.fecha_apertura)}` : '—'}</td>
                <td className="text-end">
                  <button className="btn btn-sm btn-outline-secondary" disabled={Boolean(c.turno_id)}
                    onClick={() => ejecutar(() => api.patch(`/pos/cajas/${c.id}`, { activa: !c.activa }))}>
                    {c.activa ? 'Desactivar' : 'Activar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
