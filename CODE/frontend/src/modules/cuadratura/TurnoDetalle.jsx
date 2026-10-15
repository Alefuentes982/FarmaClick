import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { descargarArchivo } from '../../archivos.js';
import { useAuth } from '../../AuthContext.jsx';
import { fechaHora, money } from '../../format.js';
import { montoEnPalabras } from '../../montoEnPalabras.js';
import { textoAjuste } from '../../redondeo.js';
import BotonesDocumento from '../../components/BotonesDocumento.jsx';
import { ErrorAlert, Ficha, PageHeader, Seccion, Spinner, useAsync } from '../../components/ui.jsx';

export default function TurnoDetalle() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data: t, error, loading, reload } = useAsync(() => api.get(`/cuadratura/turnos/${id}`), [id]);
  const [actionError, setActionError] = useState(null);
  const [conformeElegido, setConforme] = useState(null); // null = según haya o no diferencia
  const [observacion, setObservacion] = useState('');
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [corrigiendo, setCorrigiendo] = useState(false);

  if (loading && !t) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;

  const e = t.efectivo;
  const dif = e?.diferencia;
  const conforme = conformeElegido ?? dif === 0; // con diferencia, la revisión parte como "con observaciones"
  const puedeVerPdf = !t.abierto || can('supervision_caja');
  const corregido = (campo) => (t.correcciones.some((c) => c.campo === campo)
    ? <span className="badge text-bg-danger ms-2" title="Monto corregido por el Administrador: ver el historial">corregido</span> : null);
  const actualizado = (texto) => { setAviso(texto); setCorrigiendo(false); reload(); };

  const revisar = async (ev) => {
    ev.preventDefault();
    setActionError(null);
    setBusy(true);
    try {
      await api.post(`/cuadratura/turnos/${id}/revision`, { conforme, observacion: observacion || null });
      setAviso('Revisión registrada.');
      reload();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title={`Turno · Caja ${t.caja_numero} · ${t.sucursal}`}>
        {puedeVerPdf && (
          <>
            <BotonesDocumento path={`/cuadratura/turnos/${id}/pdf`} nombre={`Caja${t.caja_numero}.pdf`} onError={setActionError}
              etiquetaVer={`Ver ${t.abierto ? 'reporte X' : 'Cierre Z'}`} />
            <button type="button" className="btn btn-success" onClick={() => descargarArchivo(`/cuadratura/turnos/${id}/excel`).catch(setActionError)}>
              <i className="bi bi-file-earmark-excel me-1" />Excel
            </button>
          </>
        )}
        <Link to="/cuadratura" className="btn btn-outline-secondary">Volver</Link>
      </PageHeader>
      {aviso && <div className="alert alert-success py-2">{aviso}</div>}
      <ErrorAlert error={actionError} onClose={() => setActionError(null)} />

      <div className="row g-3">
        <div className="col-lg-6">
          <Seccion titulo="Datos del turno" icono="bi-info-circle" className="h-100">
            <Ficha filas={[
              ['Cajero', t.cajero],
              ['Apertura', fechaHora(t.fecha_apertura)],
              ['Cierre', t.fecha_cierre ? fechaHora(t.fecha_cierre) : <span className="badge text-bg-info">Turno abierto</span>],
              ['Tipo de cierre', !t.fecha_cierre ? null : t.cierre_tipo === 'automatico'
                ? <span className="badge text-bg-danger">Automático (23:59){t.arqueo_pendiente ? ' · pendiente de arqueo' : ''}</span>
                : t.cierre_tipo === 'forzado' ? <span className="badge text-bg-warning">Fuerza mayor · {t.cerrado_por}</span> : 'Normal'],
              ['Arqueo', t.arqueo_fecha ? `${t.arqueo_por} · ${fechaHora(t.arqueo_fecha)}` : null],
              ['Ventas', `${t.resumen.ventas} por ${money(t.resumen.total_ventas)}`],
              ['Devoluciones', `${t.resumen.devoluciones} por ${money(t.resumen.total_devoluciones)}`],
            ]} />
          </Seccion>
        </div>
        <div className="col-lg-6">
          <Seccion titulo="Cuadre del efectivo" icono="bi-calculator" plano={Boolean(e)} className="h-100"
            acciones={t.puede_corregir && e && (
              <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setCorrigiendo((c) => !c)}>
                <i className="bi bi-pencil-square me-1" />{corrigiendo ? 'Cancelar corrección' : 'Corregir monto'}
              </button>
            )}>
            {e ? (
              <table className="table table-sm mb-0">
                <tbody>
                  <tr><td>Efectivo inicial{corregido('apertura')}</td><td className="text-end">{money(e.apertura)}</td></tr>
                  <tr><td>+ Ventas en efectivo</td><td className="text-end">{money(e.ventas)}</td></tr>
                  <tr><td>- Devoluciones en efectivo</td><td className="text-end">{e.devoluciones ? `-${money(e.devoluciones)}` : money(0)}</td></tr>
                  <tr className="fw-semibold"><td>Efectivo esperado</td><td className="text-end">{money(e.esperado)}</td></tr>
                  {!t.abierto && t.arqueo_pendiente && (
                    <tr className="table-danger"><td colSpan="2" className="fw-semibold">Efectivo contado y diferencia: pendientes de arqueo</td></tr>
                  )}
                  {!t.abierto && !t.arqueo_pendiente && <tr><td>Efectivo contado{corregido('cierre')}</td><td className="text-end">{money(e.contado)}</td></tr>}
                  {!t.abierto && !t.arqueo_pendiente && (
                    <tr className={dif === 0 ? 'table-success' : 'table-warning'}>
                      <td className="fw-bold">Diferencia</td>
                      <td className="text-end fw-bold">{dif === 0 ? 'Cuadrada' : dif > 0 ? `Sobran ${money(dif)}` : `Faltan ${money(-dif)}`}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : <span className="text-muted">El efectivo esperado se muestra al cerrar el turno.</span>}
          </Seccion>
        </div>
      </div>

      {t.puede_arqueo && <RegistrarArqueo turno={t} onHecho={() => actualizado('Arqueo registrado. Ya se puede revisar la cuadratura.')} />}
      {t.puede_cerrar_forzado && <CierreFuerzaMayor turno={t} onHecho={() => actualizado('Turno cerrado por fuerza mayor. Quedó en el historial.')} />}

      {corrigiendo && t.puede_corregir && e && (
        <CorregirMonto turno={t} onHecho={() => actualizado('Corrección registrada. Quedó en el historial del turno.')} />
      )}

      {t.revision ? (
        <Seccion titulo="Revisión de la cuadratura" icono="bi-patch-check">
          <div className={`alert ${t.revision.conforme ? 'alert-success' : 'alert-warning'} mb-0`}>
            <strong>{t.revision.conforme ? 'Revisado conforme' : 'Revisado con observaciones'}</strong> por {t.revision.revisor} el {fechaHora(t.revision.fecha)}.
            {t.revision.observacion && <div className="mt-1">{t.revision.observacion}</div>}
          </div>
        </Seccion>
      ) : t.puede_revisar ? (
        <Seccion titulo="Revisar cuadratura" icono="bi-patch-check">
          <form onSubmit={revisar}>
            <div className="d-flex gap-4 mb-2">
              <div className="form-check"><input id="c1" type="radio" className="form-check-input" checked={conforme} onChange={() => setConforme(true)} /><label htmlFor="c1" className="form-check-label">Conforme</label></div>
              <div className="form-check"><input id="c2" type="radio" className="form-check-input" checked={!conforme} onChange={() => setConforme(false)} /><label htmlFor="c2" className="form-check-label">Con observaciones</label></div>
            </div>
            <textarea className="form-control mb-2" rows="2" maxLength={500} placeholder={dif ? 'Explique el origen de la diferencia (obligatorio)' : 'Observación (opcional)'}
              required={!conforme || Boolean(dif)} value={observacion} onChange={(ev) => setObservacion(ev.target.value)} />
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Registrar revisión'}</button>
            <span className="form-text ms-3">
              La revisión no se puede modificar después{t.puede_corregir ? ' y los montos quedan sellados: si hay que corregir alguno, hágalo antes' : ''}.
            </span>
          </form>
        </Seccion>
      ) : !t.abierto && (
        <Seccion titulo="Revisión de la cuadratura" icono="bi-patch-check">
          <span className="text-muted">
            {t.arqueo_pendiente ? 'Se podrá revisar cuando el Administrador o el Jefe de local registren el arqueo.'
              : `Pendiente de revisión por el Jefe de local o el Administrador${t.es_propio ? ' (un cajero no revisa su propio turno)' : ''}.`}
          </span>
        </Seccion>
      )}

      {t.por_medio && (
        <Seccion titulo="Por medio de pago" icono="bi-credit-card" plano>
          <div className="table-responsive">
            <table className="table table-sm">
              <thead><tr><th>Medio</th><th className="text-end">Ventas</th><th className="text-end">Devoluciones</th><th className="text-end">Neto</th></tr></thead>
              <tbody>
                {t.por_medio.map((m) => (
                  <tr key={m.medio_pago}><td>{m.medio_pago}</td><td className="text-end">{money(m.ventas)}</td>
                    <td className="text-end">{m.devoluciones ? `-${money(m.devoluciones)}` : '—'}</td><td className="text-end">{money(m.ventas - m.devoluciones)}</td></tr>
                ))}
                {Number(t.resumen.redondeo) !== 0 && (
                  <tr className="text-muted"><td colSpan="3">Ajuste por redondeo del efectivo (Ley 20.956)</td><td className="text-end">{textoAjuste(Number(t.resumen.redondeo), money)}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Seccion>
      )}

      <div className="row g-3">
        <div className="col-lg-6">
          <Seccion titulo="Ventas del turno" icono="bi-bag-check" plano className="h-100">
            <div className="table-responsive">
              <table className="table table-sm">
                <thead><tr><th>N°</th><th>Hora</th><th>Cliente</th><th>Estado</th><th className="text-end">Total</th></tr></thead>
                <tbody>
                  {t.ventas.length === 0 && <tr><td colSpan="5" className="text-muted text-center py-3">Sin ventas</td></tr>}
                  {t.ventas.map((v) => (
                    <tr key={v.id}>
                      <td className="font-monospace text-nowrap">{can('pedidos') ? <Link to={`/pedidos/${v.id}`}>{v.codigo}</Link> : v.codigo}</td>
                      <td>{fechaHora(v.fecha)}</td><td>{v.nombre_cliente}</td><td>{v.estado}</td><td className="text-end">{money(v.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Seccion>
        </div>
        <div className="col-lg-6">
          <Seccion titulo="Devoluciones del turno" icono="bi-arrow-return-left" plano className="h-100">
            <div className="table-responsive">
              <table className="table table-sm">
                <thead><tr><th>N°</th><th>Pedido</th><th>Motivo</th><th className="text-end">Devuelto</th></tr></thead>
                <tbody>
                  {t.devoluciones.length === 0 && <tr><td colSpan="4" className="text-muted text-center py-3">Sin devoluciones</td></tr>}
                  {t.devoluciones.map((d) => (
                    <tr key={d.id}>
                      <td className="font-monospace text-nowrap">{can('devoluciones') ? <Link to={`/devoluciones/${d.id}`}>{d.codigo}</Link> : d.codigo}</td>
                      <td className="font-monospace text-nowrap">{d.pedido_codigo}</td><td>{d.motivo}</td><td className="text-end">{money(d.total_reembolso)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Seccion>
        </div>
      </div>

      <Observaciones turno={t} onHecho={() => actualizado('Observación agregada.')} />
      <Historial eventos={t.historial} />
    </>
  );
}

const CAMPOS = { apertura: 'Efectivo de apertura', cierre: 'Efectivo contado al cierre' };

// Corrección de un monto digitado (solo Administrador, antes de la revisión). Pide el monto correcto y el motivo, y
// confirma mostrando el cambio en cifras y en palabras. El valor anterior queda guardado en el historial.
function CorregirMonto({ turno, onHecho }) {
  const campos = Object.keys(CAMPOS).filter((c) => turno.puede_corregir[c]);
  const [campo, setCampo] = useState(campos[0]);
  const [monto, setMonto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const actual = campo === 'apertura' ? turno.efectivo.apertura : turno.efectivo.contado;

  const enviar = async (ev) => {
    ev.preventDefault();
    const nuevo = Number(monto);
    if (!window.confirm(`${CAMPOS[campo]}: ${money(actual)} → ${money(nuevo)}\n(${montoEnPalabras(nuevo)})\n\n`
      + 'La corrección queda registrada con su nombre, la fecha y el motivo, y no se puede borrar. ¿Continuar?')) return;
    setError(null);
    setBusy(true);
    try {
      await api.post(`/cuadratura/turnos/${turno.id}/correcciones`, { campo, monto: nuevo, motivo });
      onHecho();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Seccion titulo="Corregir un monto digitado" icono="bi-pencil-square" className="border-danger">
      <p className="text-muted small mb-2">
        Solo para errores de digitación (por ejemplo, un cero de más). El monto anterior no se pierde: queda en el historial
        junto con quién corrigió, cuándo y por qué. El efectivo esperado y la diferencia se recalculan.
      </p>
      <ErrorAlert error={error} onClose={() => setError(null)} />
      <form onSubmit={enviar} className="row g-2 align-items-start">
        <div className="col-md-4">
          <label className="form-label small mb-1" htmlFor="corr-campo">Monto a corregir</label>
          <select id="corr-campo" className="form-select" value={campo} onChange={(ev) => setCampo(ev.target.value)}>
            {campos.map((c) => <option key={c} value={c}>{CAMPOS[c]}</option>)}
          </select>
          <div className="form-text">Registrado: {money(actual)}</div>
        </div>
        <div className="col-md-3">
          <label className="form-label small mb-1" htmlFor="corr-monto">Monto correcto</label>
          <div className="input-group">
            <span className="input-group-text">$</span>
            <input id="corr-monto" type="number" min="0" step="1" required className="form-control" value={monto} onChange={(ev) => setMonto(ev.target.value)} />
          </div>
          {monto !== '' && <div className="form-text">{montoEnPalabras(monto)}</div>}
        </div>
        <div className="col-md-5">
          <label className="form-label small mb-1" htmlFor="corr-motivo">Motivo</label>
          <textarea id="corr-motivo" className="form-control" rows="2" required minLength={10} maxLength={500}
            placeholder="Ej.: error de digitación al abrir; el fondo real era $50.000 (verificado en arqueo)."
            value={motivo} onChange={(ev) => setMotivo(ev.target.value)} />
        </div>
        <div className="col-12">
          <button className="btn btn-danger" disabled={busy || monto === '' || Number(monto) === actual}>
            {busy ? 'Registrando…' : 'Registrar corrección'}
          </button>
        </div>
      </form>
    </Seccion>
  );
}

// Observaciones del turno: notas con autor y fecha. Se agregan en cualquier estado del turno y no se editan ni borran.
function Observaciones({ turno, onHecho }) {
  const [texto, setTexto] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!turno.puede_observar && turno.observaciones.length === 0) return null;

  const agregar = async (ev) => {
    ev.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post(`/cuadratura/turnos/${turno.id}/observaciones`, { texto });
      setTexto('');
      onHecho();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Seccion titulo="Observaciones" icono="bi-chat-left-text">
      {turno.observaciones.length === 0 && <p className="text-muted mb-2">Sin observaciones.</p>}
      {turno.observaciones.map((o) => (
        <div key={o.id} className="border-start border-3 ps-3 mb-3">
          <div className="small text-muted">{o.usuario} · {o.rol} · {fechaHora(o.fecha)}</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{o.texto}</div>
        </div>
      ))}
      {turno.puede_observar && (
        <form onSubmit={agregar}>
          <ErrorAlert error={error} onClose={() => setError(null)} />
          <textarea className="form-control mb-2" rows="2" required minLength={3} maxLength={1000}
            placeholder="Agregue una observación sobre este turno (queda registrada con su nombre y la fecha; no se puede editar)."
            value={texto} onChange={(ev) => setTexto(ev.target.value)} />
          <button className="btn btn-outline-primary btn-sm" disabled={busy || texto.trim().length < 3}>
            <i className="bi bi-plus-lg me-1" />{busy ? 'Guardando…' : 'Agregar observación'}
          </button>
        </form>
      )}
    </Seccion>
  );
}

const ICONO_EVENTO = {
  apertura: ['bi-unlock', 'text-primary'], cierre: ['bi-lock', 'text-secondary'], arqueo: ['bi-cash-coin', 'text-warning'], correccion: ['bi-pencil-square', 'text-danger'],
  observacion: ['bi-chat-left-text', 'text-info'], revision: ['bi-patch-check', 'text-success'],
};

// Trazabilidad completa del turno, en orden: apertura, cierre, correcciones, observaciones y revisión.
function Historial({ eventos }) {
  return (
    <Seccion titulo="Historial del turno" icono="bi-clock-history">
      <ol className="list-unstyled mb-0">
        {eventos.map((h, i) => {
          const [icono, color] = ICONO_EVENTO[h.tipo] ?? ['bi-dot', ''];
          return (
            <li key={i} className="d-flex gap-3 mb-3">
              <i className={`bi ${icono} ${color} fs-5`} />
              <div>
                <div className="small text-muted">{fechaHora(h.fecha)} · {h.usuario}</div>
                <div>{h.detalle}</div>
                {h.texto && <div className="small fst-italic" style={{ whiteSpace: 'pre-wrap' }}>«{h.texto}»</div>}
              </div>
            </li>
          );
        })}
      </ol>
    </Seccion>
  );
}

// Formulario de monto contado con confirmación en cifras y palabras (cierre por fuerza mayor y arqueo).
function FormularioContado({ titulo, icono, explicacion, etiquetaTexto, textoObligatorio, boton, confirmar, enviar, onHecho }) {
  const [monto, setMonto] = useState('');
  const [texto, setTexto] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (ev) => {
    ev.preventDefault();
    const valor = Number(monto);
    if (!window.confirm(`${confirmar} ${money(valor)}\n(${montoEnPalabras(valor)})\n\nQueda registrado con su nombre y la fecha. ¿Continuar?`)) return;
    setError(null);
    setBusy(true);
    try {
      await enviar(valor, texto.trim());
      onHecho();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Seccion titulo={titulo} icono={icono} className="border-warning">
      <p className="text-muted small mb-2">{explicacion}</p>
      <ErrorAlert error={error} onClose={() => setError(null)} />
      <form onSubmit={submit} className="row g-2 align-items-start">
        <div className="col-md-4">
          <label className="form-label small mb-1" htmlFor={`${icono}-monto`}>Efectivo contado</label>
          <div className="input-group">
            <span className="input-group-text">$</span>
            <input id={`${icono}-monto`} type="number" min="0" step="1" required className="form-control" value={monto} onChange={(ev) => setMonto(ev.target.value)} />
          </div>
          {monto !== '' && <div className="form-text">{montoEnPalabras(monto)}</div>}
        </div>
        <div className="col-md-8">
          <label className="form-label small mb-1" htmlFor={`${icono}-texto`}>{etiquetaTexto}</label>
          <textarea id={`${icono}-texto`} className="form-control" rows="2" maxLength={textoObligatorio ? 500 : 1000}
            required={textoObligatorio} minLength={textoObligatorio ? 10 : undefined} value={texto} onChange={(ev) => setTexto(ev.target.value)} />
        </div>
        <div className="col-12"><button className="btn btn-warning" disabled={busy || monto === ''}>{busy ? 'Registrando…' : boton}</button></div>
      </form>
    </Seccion>
  );
}

// Cierre por fuerza mayor: el Administrador o el Jefe de local cierran el turno de otra persona (enfermedad, ausencia,
// falla del equipo…), con el efectivo contado y el motivo.
function CierreFuerzaMayor({ turno, onHecho }) {
  return (
    <FormularioContado
      titulo="Cerrar este turno por fuerza mayor" icono="bi-shield-lock"
      explicacion={`El turno de ${turno.cajero} sigue abierto. Si no puede cerrarlo, cuente el efectivo de la caja (incluido el inicial) e ingréselo con el motivo. El cierre queda registrado a su nombre.`}
      etiquetaTexto="Motivo (obligatorio)" textoObligatorio boton="Cerrar turno"
      confirmar={`¿Cerrar el turno de ${turno.cajero} declarando`}
      enviar={(monto, motivo) => api.post(`/cuadratura/turnos/${turno.id}/cierre-forzado`, { monto, motivo })}
      onHecho={onHecho} />
  );
}

// Arqueo de un turno cerrado automáticamente a las 23:59: el Administrador o el Jefe de local cuentan la caja.
function RegistrarArqueo({ turno, onHecho }) {
  return (
    <FormularioContado
      titulo="Registrar el arqueo" icono="bi-cash-coin"
      explicacion="El sistema cerró este turno a las 23:59 porque seguía abierto. Cuente el efectivo de la caja e ingréselo: con eso se calcula la diferencia y el turno queda listo para revisar."
      etiquetaTexto="Observación (opcional: quién estuvo presente, hora del conteo…)" boton="Registrar arqueo"
      confirmar="¿Registrar el arqueo con"
      enviar={(monto, observacion) => api.post(`/cuadratura/turnos/${turno.id}/arqueo`, { monto, observacion: observacion || null })}
      onHecho={onHecho} />
  );
}
