import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../AuthContext.jsx';
import { Slot } from '../../extensiones.jsx';
import { fechaHora, money } from '../../format.js';
import { ErrorAlert, Spinner, useAsync } from '../../components/ui.jsx';
import { esJefeOAdmin } from '../../roles.js';
import AbrirTurno from './AbrirTurno.jsx';
import CerrarTurno from './CerrarTurno.jsx';
import VentaMostrador from './VentaMostrador.jsx';

export default function Pos() {
  const { user } = useAuth();
  const turno = useAsync(() => api.get('/pos/turno'), []);
  const catalogos = useAsync(() => api.get('/catalogos'), []);
  const [cierre, setCierre] = useState(null); // resultado del último cierre
  const [cerrando, setCerrando] = useState(false);
  const [ventas, setVentas] = useState(null);
  const [error, setError] = useState(null);

  const t = turno.data;
  const medios = catalogos.data?.medios_pago_caja ?? [];

  const verVentas = async () => {
    if (ventas) { setVentas(null); return; }
    try { setVentas(await api.get('/pos/turno/ventas')); } catch (e) { setError(e); }
  };

  if (turno.loading && !turno.data && !turno.error) return <Spinner />;

  if (cierre) {
    const cuadra = cierre.diferencia === 0;
    return (
      <div className="card text-center" style={{ maxWidth: 560 }}>
        <div className="card-body py-4">
          <i className={`bi ${cuadra ? 'bi-check-circle text-success' : 'bi-exclamation-triangle text-warning'} display-5`} />
          <h2 className="h4 mt-2">Turno cerrado</h2>
          <table className="table table-sm mx-auto" style={{ maxWidth: 360 }}>
            <tbody>
              <tr><td className="text-start">Esperado en caja</td><td className="text-end">{money(cierre.esperado)}</td></tr>
              <tr><td className="text-start">Contado</td><td className="text-end">{money(cierre.contado)}</td></tr>
              <tr className={cuadra ? 'table-success' : 'table-warning'}>
                <td className="text-start fw-bold">Diferencia</td>
                <td className="text-end fw-bold">{cuadra ? 'Cuadrada' : cierre.diferencia > 0 ? `Sobran ${money(cierre.diferencia)}` : `Faltan ${money(-cierre.diferencia)}`}</td>
              </tr>
            </tbody>
          </table>
          <button className="btn btn-primary" onClick={() => { setCierre(null); turno.reload(); }}>Aceptar</button>
        </div>
      </div>
    );
  }

  if (!t) return <AbrirTurno onAbierto={() => turno.reload()} />;

  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3 p-3 bg-light border rounded">
        <div>
          <strong>Caja {t.caja_numero}</strong> · {t.sucursal}
          <span className="text-muted"> · abierta desde {fechaHora(t.fecha_apertura)} · efectivo inicial {money(t.monto_apertura_efectivo)}</span>
        </div>
        <div className="d-flex align-items-center gap-3">
          <span>
            <strong>{t.resumen.ventas}</strong> ventas · <strong>{money(t.resumen.total)}</strong>
            {t.resumen.devoluciones?.cantidad > 0 && (
              <span className="text-danger"> · {t.resumen.devoluciones.cantidad} devolución(es) -{money(t.resumen.devoluciones.total)}</span>
            )}
          </span>
          <Slot nombre="pos.acciones" />
          <button className="btn btn-outline-secondary btn-sm" onClick={verVentas}><i className="bi bi-list-ul me-1" />Ventas del turno</button>
          {esJefeOAdmin(user) && <Link to="/pos/cajas" className="btn btn-outline-secondary btn-sm" title="Configurar cajas"><i className="bi bi-gear" /></Link>}
          <button className="btn btn-warning btn-sm" onClick={() => setCerrando(true)}>Cerrar turno</button>
        </div>
      </div>

      <AvisoCierreAutomatico turno={t} />
      <ErrorAlert error={turno.error || error} onClose={() => setError(null)} />
      {cerrando && <CerrarTurno turno={t} onCancelar={() => setCerrando(false)} onCerrado={(r) => { setCerrando(false); setVentas(null); setCierre(r); }} />}

      {ventas && (
        <div className="table-responsive mb-4">
          <table className="table table-sm">
            <thead><tr><th>N°</th><th>Hora</th><th>Cliente</th><th>Medios</th><th>Estado</th><th className="text-end">Total</th></tr></thead>
            <tbody>
              {ventas.length === 0 && <tr><td colSpan="6" className="text-center text-muted">Aún no hay ventas en este turno.</td></tr>}
              {ventas.map((v) => (
                <tr key={v.id}><td className="font-monospace">{v.codigo}</td><td>{fechaHora(v.fecha)}</td><td>{v.nombre_cliente}</td><td>{v.medios}</td><td>{v.estado}</td><td className="text-end">{money(v.total)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!cerrando && <VentaMostrador turno={t} medios={medios} onVenta={() => turno.reload()} />}
    </>
  );
}

// Minutos que faltan para las 23:59 en Chile (negativo si ya pasó).
const minutosParaCierre = () => {
  const [h, m] = new Date().toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .split(':').map(Number);
  return 23 * 60 + 59 - (h * 60 + m);
};

// En las sucursales que no son farmacia de turno, la caja se cierra sola a las 23:59: se avisa la última hora.
function AvisoCierreAutomatico({ turno }) {
  const [minutos, setMinutos] = useState(minutosParaCierre);
  useEffect(() => {
    const id = setInterval(() => setMinutos(minutosParaCierre()), 30_000);
    return () => clearInterval(id);
  }, []);
  if (turno.farmacia_de_turno || minutos > 60) return null;
  return (
    <div className={`alert ${minutos <= 15 ? 'alert-danger' : 'alert-warning'} d-flex align-items-center gap-2`}>
      <i className="bi bi-alarm fs-4" />
      <div>
        <strong>Esta caja se cerrará automáticamente a las 23:59{minutos >= 0 ? ` (faltan ${minutos} min)` : ''}.</strong>{' '}
        Ciérrela antes contando el efectivo. Si se cierra sola, el efectivo quedará pendiente de arqueo por el Administrador o el Jefe de local.
      </div>
    </div>
  );
}
