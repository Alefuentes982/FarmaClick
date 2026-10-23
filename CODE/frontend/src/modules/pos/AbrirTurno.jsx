import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../AuthContext.jsx';
import { fechaHora, money } from '../../format.js';
import { montoEnPalabras } from '../../montoEnPalabras.js';
import { ErrorAlert, Field, Spinner, useAsync } from '../../components/ui.jsx';
import { esJefeOAdmin } from '../../roles.js';

export default function AbrirTurno({ onAbierto }) {
  const { user } = useAuth();
  const [cajaId, setCajaId] = useState('');
  const [monto, setMonto] = useState('0');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const cajas = useAsync(() => api.get('/pos/cajas?activa=true'), []);

  const abrir = async (e) => {
    e.preventDefault();
    // Confirmación con el monto en palabras: un cero de más se nota antes de abrir (después solo lo corrige el Administrador).
    const valor = Number(monto || 0);
    if (!window.confirm(`¿Abrir el turno con ${money(valor)} de efectivo inicial?\n(${montoEnPalabras(valor)})`)) return;
    setError(null);
    setSaving(true);
    try {
      onAbierto(await api.post('/pos/turnos', { caja_id: cajaId, monto_apertura_efectivo: Number(monto || 0) }));
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  };

  if (cajas.loading) return <Spinner />;

  return (
    <div style={{ maxWidth: 560 }}>
      <h1 className="fc-pagina-titulo mb-2">Abrir turno de caja</h1>
      <p className="text-muted">Para vender en el mostrador primero se abre un turno con el efectivo inicial de la caja.</p>
      <ErrorAlert error={cajas.error || error} onClose={() => setError(null)} />
      {cajas.data?.length === 0 ? (
        <div className="alert alert-warning">
          No hay cajas activas para su sucursal.{' '}
          {esJefeOAdmin(user) ? <Link to="/pos/cajas">Configurar cajas</Link> : 'Pida al Administrador o al Jefe de local que cree una caja.'}
        </div>
      ) : (
        <form onSubmit={abrir} className="fc-formulario">
          <Field label="Caja">
            <select className="form-select" required value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
              <option value="">Seleccione…</option>
              {cajas.data?.map((c) => (
                <option key={c.id} value={c.id} disabled={Boolean(c.turno_id)}>
                  Caja {c.numero} — {c.sucursal}{c.turno_id ? ` (en uso por ${c.usuario_turno} desde ${fechaHora(c.fecha_apertura)})` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Efectivo inicial en la caja" hint="El efectivo con que parte el turno (sencillo).">
            <input type="number" min="0" step="1" required className="form-control" value={monto} onChange={(e) => setMonto(e.target.value)} />
            {monto !== '' && <div className="form-text">{money(Number(monto))} · {montoEnPalabras(monto)}</div>}
          </Field>
          <button className="btn btn-primary" disabled={saving || !cajaId}>{saving ? 'Abriendo…' : 'Abrir turno'}</button>
          {esJefeOAdmin(user) && <Link to="/pos/cajas" className="btn btn-link">Configurar cajas</Link>}
        </form>
      )}
    </div>
  );
}
