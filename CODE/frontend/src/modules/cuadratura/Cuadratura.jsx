import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../../api.js';
import { useAuth } from '../../AuthContext.jsx';
import { descargarArchivo } from '../../archivos.js';
import { fechaHora, money } from '../../format.js';
import { textoAjuste } from '../../redondeo.js';
import FiltroFechas from '../../components/FiltroFechas.jsx';
import Kpi from '../../components/Kpi.jsx';
import { ErrorAlert, Filtros, PageHeader, Pager, Seccion, Spinner, useAsync } from '../../components/ui.jsx';

const LIMIT = 15;
const ESTADO_CLASE = { Abierto: 'info', 'Cerrado sin revisar': 'warning', 'Pendiente de arqueo': 'danger', 'Revisado conforme': 'success', 'Revisado con observaciones': 'secondary' };
const TIPO_CIERRE = { automatico: ['automático', 'Cerrado automáticamente a las 23:59'], forzado: ['fuerza mayor', 'Cerrado por el Administrador o el Jefe de local'] };
const ESTADOS = [['', 'Todos los turnos'], ['abierto', 'Abiertos'], ['cerrado', 'Cerrados'], ['sin_revisar', 'Cerrados sin revisar'], ['con_diferencia', 'Con diferencia de caja'], ['corregido', 'Con montos corregidos'], ['pendiente_arqueo', 'Pendientes de arqueo']];

const Dif = ({ v }) => (v == null ? <span className="text-muted">—</span>
  : <span className={v === 0 ? 'text-success' : 'text-danger fw-semibold'}>{v === 0 ? 'Cuadra' : `${v > 0 ? '+' : '-'}${money(Math.abs(v))}`}</span>);

export default function Cuadratura() {
  const { can } = useAuth();
  const supervisor = can('supervision_caja');
  const [estado, setEstado] = useState('');
  const [sucursal, setSucursal] = useState('');
  const [cajero, setCajero] = useState('');
  const [fechas, setFechas] = useState({ desde: '', hasta: '' });
  const [page, setPage] = useState(1);
  const [detalle, setDetalle] = useState(false);
  const [actionError, setActionError] = useState(null);

  const catalogos = useAsync(() => api.get('/catalogos'), []);
  const cajeros = useAsync(() => (supervisor ? api.get('/cuadratura/cajeros') : Promise.resolve(null)), [supervisor]);
  const rangoInvalido = fechas.desde && fechas.hasta && fechas.desde > fechas.hasta;
  const filtros = { sucursal_id: sucursal, usuario_id: cajero, ...fechas };
  const resumen = useAsync(() => (rangoInvalido ? Promise.resolve(null) : api.get(`/cuadratura/resumen${qs(filtros)}`)), [sucursal, cajero, fechas.desde, fechas.hasta]);
  const lista = useAsync(
    () => (rangoInvalido ? Promise.resolve(null) : api.get(`/cuadratura/turnos${qs({ ...filtros, estado, page, limit: LIMIT })}`)),
    [estado, sucursal, cajero, fechas.desde, fechas.hasta, page]);
  const s = resumen.data;
  const cambiar = (fn) => (v) => { setPage(1); fn(v); };

  const exportar = () => descargarArchivo(`/cuadratura/exportar${qs({ ...filtros, estado })}`).catch(setActionError);
  const dn = Number(s?.diferencia_neta ?? 0);

  return (
    <>
      <PageHeader title="Cuadratura de caja">
        <button type="button" className="btn btn-success" disabled={Boolean(rangoInvalido)} onClick={exportar}>
          <i className="bi bi-file-earmark-excel me-1" />Exportar a Excel
        </button>
      </PageHeader>
      {!supervisor && <p className="text-muted">Aquí ve el historial de sus turnos. El efectivo esperado de un turno abierto no se muestra: se informa al cerrarlo.</p>}

      <Filtros>
        <div className="row g-2">
          <div className="col-md-4">
            <select className="form-select" aria-label="Estado del turno" value={estado} onChange={(e) => cambiar(setEstado)(e.target.value)}>
              {ESTADOS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </select>
          </div>
          <div className="col-md-4">
            <select className="form-select" aria-label="Sucursal" value={sucursal} onChange={(e) => cambiar(setSucursal)(e.target.value)}>
              <option value="">Todas las sucursales</option>
              {catalogos.data?.sucursales.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </select>
          </div>
          {supervisor && (
            <div className="col-md-4">
              <select className="form-select" aria-label="Cajero" value={cajero} onChange={(e) => cambiar(setCajero)(e.target.value)}>
                <option value="">Todos los cajeros</option>
                {cajeros.data?.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="d-flex flex-wrap align-items-center gap-2">
          <span className="small text-muted">Apertura del turno:</span>
          <FiltroFechas desde={fechas.desde} hasta={fechas.hasta} onChange={(f) => { setPage(1); setFechas(f); }} />
        </div>
      </Filtros>
      {rangoInvalido && <div className="alert alert-warning py-2">La fecha "desde" no puede ser posterior a "hasta".</div>}
      <ErrorAlert error={resumen.error || lista.error || actionError} onClose={actionError ? () => setActionError(null) : undefined} />

      {s && (
        <>
          <div className="row g-2 mb-3">
            <Kpi col="col-6 col-lg-2" titulo="Turnos" valor={s.turnos} sub={`${s.abiertos} abierto(s)`} />
            <Kpi col="col-6 col-lg-2" titulo="Ventas netas" valor={money(s.ventas_netas)} sub={`${s.ventas} ventas · ${s.devoluciones} devol.`} />
            <Kpi col="col-6 col-lg-2" titulo="Diferencia neta" valor={dn === 0 ? 'Cuadra' : `${dn < 0 ? '-' : '+'}${money(Math.abs(dn))}`}
              clase={dn === 0 ? 'text-success' : 'text-danger'} sub={`${s.con_diferencia} turno(s) con diferencia`} />
            <Kpi col="col-6 col-lg-2" titulo="Faltantes" valor={money(s.faltantes)} clase={Number(s.faltantes) > 0 ? 'text-danger' : ''} />
            <Kpi col="col-6 col-lg-2" titulo="Sobrantes" valor={money(s.sobrantes)} clase={Number(s.sobrantes) > 0 ? 'text-warning' : ''} />
            <Kpi col="col-6 col-lg-2" titulo="Sin revisar" valor={s.sin_revisar} onClick={s.sin_revisar ? () => cambiar(setEstado)('sin_revisar') : undefined}
              sub={s.pendientes_arqueo ? `${s.pendientes_arqueo} pendiente(s) de arqueo` : s.sin_revisar ? 'ver pendientes' : 'al día'}
              clase={s.pendientes_arqueo ? 'text-danger' : ''} />
          </div>

          <Seccion titulo="Desglose del período" icono="bi-bar-chart-line" plano={detalle}
            acciones={<button className="btn btn-sm btn-outline-secondary" onClick={() => setDetalle((d) => !d)}>{detalle ? 'Ocultar' : 'Ver'} detalle</button>}>
            {!detalle ? <span className="text-muted small">Cobrado y devuelto por medio de pago, y resultado por cajero.</span> : (
              <div className="row g-0">
                <div className="col-lg-6 border-end">
                  <div className="table-responsive">
                    <table className="table table-sm">
                      <thead><tr><th>Medio de pago</th><th className="text-end">Ventas</th><th className="text-end">Devoluciones</th><th className="text-end">Neto</th></tr></thead>
                      <tbody>
                        {s.por_medio.length === 0 && <tr><td colSpan="4" className="text-muted text-center py-3">Sin movimientos</td></tr>}
                        {s.por_medio.map((m) => (
                          <tr key={m.medio_pago}><td>{m.medio_pago}</td><td className="text-end">{money(m.ventas)}</td>
                            <td className="text-end">{Number(m.devoluciones) ? `-${money(m.devoluciones)}` : '—'}</td><td className="text-end">{money(Number(m.ventas) - Number(m.devoluciones))}</td></tr>
                        ))}
                        {Number(s.redondeo) !== 0 && (
                          <tr className="text-muted"><td colSpan="3">Ajuste por redondeo del efectivo (Ley 20.956)</td><td className="text-end">{textoAjuste(Number(s.redondeo), money)}</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="col-lg-6">
                  <div className="table-responsive">
                    <table className="table table-sm">
                      <thead><tr><th>Cajero</th><th className="text-end">Turnos</th><th className="text-end">Ventas</th><th className="text-end">Faltantes</th><th className="text-end">Sobrantes</th></tr></thead>
                      <tbody>
                        {s.por_cajero.map((c) => (
                          <tr key={c.cajero}><td>{c.cajero}</td><td className="text-end">{c.turnos}</td><td className="text-end">{money(c.total_ventas)}</td>
                            <td className={`text-end ${Number(c.faltantes) ? 'text-danger' : ''}`}>{Number(c.faltantes) ? money(c.faltantes) : '—'}</td>
                            <td className="text-end">{Number(c.sobrantes) ? money(c.sobrantes) : '—'}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </Seccion>
        </>
      )}

      <Seccion titulo="Turnos" icono="bi-clock-history" plano>
        {lista.loading && !lista.data ? <div className="p-3"><Spinner /></div> : (
          <div className="table-responsive">
            <table className="table table-hover align-middle">
              <thead>
                <tr><th>Apertura</th><th>Caja</th><th>Cajero</th><th>Estado</th><th className="text-end">Ventas</th><th className="text-end">Devol.</th>
                  <th className="text-end">Esperado</th><th className="text-end">Contado</th><th className="text-end">Diferencia</th><th /></tr>
              </thead>
              <tbody>
                {(lista.data?.data.length ?? 0) === 0 && <tr><td colSpan="10" className="text-center text-muted py-4">Sin turnos con esos filtros</td></tr>}
                {lista.data?.data.map((t) => (
                  <tr key={t.id}>
                    <td className="text-nowrap"><Link to={`/cuadratura/${t.id}`} className="text-decoration-none fw-semibold">{fechaHora(t.fecha_apertura)}</Link></td>
                    <td>{t.sucursal} · Caja {t.caja_numero}</td>
                    <td>{t.cajero}</td>
                    <td>
                      <span className={`badge text-bg-${ESTADO_CLASE[t.estado]}`}>{t.estado}</span>
                      {TIPO_CIERRE[t.cierre_tipo] && (
                        <span className="badge text-bg-light border ms-1" title={TIPO_CIERRE[t.cierre_tipo][1]}>{TIPO_CIERRE[t.cierre_tipo][0]}</span>
                      )}
                      {t.corregido && <span className="badge text-bg-danger ms-1" title="Tiene montos corregidos por el Administrador">corregido</span>}
                      {t.observaciones > 0 && <span className="badge text-bg-light border ms-1" title="Observaciones"><i className="bi bi-chat-left-text me-1" />{t.observaciones}</span>}
                    </td>
                    <td className="text-end">{money(t.total_ventas)}<div className="small text-muted">{t.ventas} venta(s)</div></td>
                    <td className="text-end">{t.devoluciones ? `-${money(t.total_devoluciones)}` : '—'}</td>
                    <td className="text-end">{t.esperado == null ? '—' : money(t.esperado)}</td>
                    <td className="text-end">{t.contado != null ? money(t.contado) : t.fecha_cierre ? <span className="text-danger small">pendiente</span> : '—'}</td>
                    <td className="text-end"><Dif v={t.diferencia} /></td>
                    <td className="text-nowrap text-end">
                      <Link to={`/cuadratura/${t.id}`} className="btn btn-sm btn-outline-primary me-1" title="Ver"><i className="bi bi-eye" /></Link>
                      {(t.fecha_cierre || supervisor) && (
                        <>
                          <button className="btn btn-sm btn-outline-secondary me-1" title={t.fecha_cierre ? 'Descargar Cierre Z (PDF)' : 'Descargar reporte X (PDF)'}
                            onClick={() => descargarArchivo(`/cuadratura/turnos/${t.id}/pdf`).catch(setActionError)}><i className="bi bi-file-earmark-pdf" /></button>
                          <button className="btn btn-sm btn-outline-success" title="Descargar la ficha del turno en Excel"
                            onClick={() => descargarArchivo(`/cuadratura/turnos/${t.id}/excel`).catch(setActionError)}><i className="bi bi-file-earmark-excel" /></button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Seccion>
      <Pager page={page} limit={LIMIT} total={lista.data?.total ?? 0} onPage={setPage} />
    </>
  );
}
