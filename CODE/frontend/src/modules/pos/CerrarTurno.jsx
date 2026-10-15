import { useState } from 'react';
import { api } from '../../api.js';
import { money } from '../../format.js';
import { montoEnPalabras } from '../../montoEnPalabras.js';
import { ErrorAlert } from '../../components/ui.jsx';

// Billetes y monedas de curso legal en Chile, para ayudar a contar el efectivo de la caja.
const DENOMINACIONES = [20000, 10000, 5000, 2000, 1000, 500, 100, 50, 10];

// Cierre ciego: la cajera cuenta el efectivo y lo informa sin ver cuánto debería haber. Recién al cerrar se muestra
// el esperado y la diferencia.
export default function CerrarTurno({ turno, onCerrado, onCancelar }) {
  const [contado, setContado] = useState('');
  const [conteo, setConteo] = useState({}); // denominación -> cantidad
  const [contando, setContando] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const totalConteo = DENOMINACIONES.reduce((s, d) => s + d * Number(conteo[d] || 0), 0);

  const cerrar = async () => {
    // Cierre ciego: no se muestra el esperado, pero sí el monto en palabras para detectar un error de digitación.
    const valor = Number(contado);
    if (!window.confirm(`¿Cerrar el turno declarando ${money(valor)} contados?\n(${montoEnPalabras(valor)})\n\nDespués no podrá registrar más ventas en él.`)) return;
    setError(null);
    setBusy(true);
    try {
      onCerrado(await api.post(`/pos/turnos/${turno.id}/cerrar`, { monto_contado: Number(contado) }));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <div className="card border-warning mb-4">
      <div className="card-body">
        <h3 className="h5">Cerrar turno · Caja {turno.caja_numero}</h3>
        <p className="text-muted mb-2">
          Cuente todo el efectivo de la caja (incluido el efectivo inicial de {money(turno.monto_apertura_efectivo)}) e ingrese el total.
        </p>
        <ErrorAlert error={error} onClose={() => setError(null)} />
        <div className="row g-2 align-items-center mb-2">
          <div className="col-md-4">
            <input type="number" min="0" step="1" className="form-control" placeholder="Efectivo contado" autoFocus value={contado} onChange={(e) => setContado(e.target.value)} />
            {contado !== '' && <div className="form-text">{money(Number(contado))} · {montoEnPalabras(contado)}</div>}
          </div>
          <div className="col-auto d-flex gap-2">
            <button className="btn btn-warning" disabled={busy || contado === ''} onClick={cerrar}>{busy ? 'Cerrando…' : 'Cerrar turno'}</button>
            <button className="btn btn-outline-secondary" disabled={busy} onClick={onCancelar}>Cancelar</button>
            <button className="btn btn-link" onClick={() => setContando((c) => !c)}>{contando ? 'Ocultar conteo' : 'Contar por denominación'}</button>
          </div>
        </div>
        {contando && (
          <div className="border rounded p-3" style={{ maxWidth: 480 }}>
            <table className="table table-sm mb-2 align-middle">
              <tbody>
                {DENOMINACIONES.map((d) => (
                  <tr key={d}>
                    <td>{money(d)}</td>
                    <td style={{ width: 110 }}><input type="number" min="0" step="1" className="form-control form-control-sm" value={conteo[d] ?? ''} onChange={(e) => setConteo((c) => ({ ...c, [d]: e.target.value }))} /></td>
                    <td className="text-end">{money(d * Number(conteo[d] || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="d-flex justify-content-between align-items-center">
              <strong>Total contado: {money(totalConteo)}</strong>
              <button className="btn btn-outline-primary btn-sm" onClick={() => setContado(String(totalConteo))}>Usar este total</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
