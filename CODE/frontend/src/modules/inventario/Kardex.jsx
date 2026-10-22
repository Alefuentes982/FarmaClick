import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api, qs } from '../../api.js';
import { fechaHora } from '../../format.js';
import FiltroFechas from '../../components/FiltroFechas.jsx';
import { ErrorAlert, Filtros, PageHeader, Pager, Spinner, useAsync } from '../../components/ui.jsx';
import Pestanas from './Pestanas.jsx';

const LIMIT = 20;

export default function Kardex() {
  const location = useLocation();
  const [aviso, setAviso] = useState(location.state?.aviso ?? null);
  const [q, setQ] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [sucursal, setSucursal] = useState('');
  const [tipo, setTipo] = useState('');
  const [motivo, setMotivo] = useState('');
  const [fechas, setFechas] = useState({ desde: '', hasta: '' });
  const [page, setPage] = useState(1);

  const catalogos = useAsync(() => api.get('/catalogos'), []);
  const rangoInvalido = fechas.desde && fechas.hasta && fechas.desde > fechas.hasta;
  const { data, error, loading } = useAsync(
    () => (rangoInvalido ? Promise.resolve(null)
      : api.get(`/inventario/kardex${qs({ q: busqueda, sucursal_id: sucursal, tipo, motivo_id: motivo, ...fechas, page, limit: LIMIT })}`)),
    [busqueda, sucursal, tipo, motivo, fechas.desde, fechas.hasta, page]);

  return (
    <>
      <PageHeader title="Inventario" />
      <Pestanas />
      {aviso && (
        <div className="alert alert-success d-flex justify-content-between">
          <span>{aviso}</span>
          <button type="button" className="btn-close" aria-label="Cerrar" onClick={() => setAviso(null)} />
        </div>
      )}
      <Filtros>
        <form className="row g-2" onSubmit={(e) => { e.preventDefault(); setPage(1); setBusqueda(q); }}>
          <div className="col-md-3"><input className="form-control" placeholder="SKU, producto o N° de lote" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="col-md-3">
            <select className="form-select" value={sucursal} onChange={(e) => { setPage(1); setSucursal(e.target.value); }}>
              <option value="">Todas las sucursales</option>
              {catalogos.data?.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          <div className="col-md-2">
            <select className="form-select" value={tipo} onChange={(e) => { setPage(1); setTipo(e.target.value); }}>
              <option value="">Entradas y salidas</option><option>Entrada</option><option>Salida</option>
            </select>
          </div>
          <div className="col-md-3">
            <select className="form-select" value={motivo} onChange={(e) => { setPage(1); setMotivo(e.target.value); }}>
              <option value="">Todos los motivos</option>
              {catalogos.data?.motivos_movimiento.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
            </select>
          </div>
          <div className="col-md-1"><button className="btn btn-outline-secondary w-100"><i className="bi bi-search" /></button></div>
        </form>
        <div className="d-flex flex-wrap align-items-center gap-2">
          <span className="small text-muted">Fecha:</span>
          <FiltroFechas desde={fechas.desde} hasta={fechas.hasta} onChange={(f) => { setPage(1); setFechas(f); }} />
        </div>
      </Filtros>
      {rangoInvalido && <div className="alert alert-warning py-2">La fecha "desde" no puede ser posterior a "hasta".</div>}

      <ErrorAlert error={error} />
      {loading && !data ? <Spinner /> : (
        <>
          <div className="table-responsive">
            <table className="table table-sm table-hover align-middle">
              <thead>
                <tr><th>Fecha</th><th>Tipo</th><th>Motivo</th><th>Producto</th><th>Sucursal</th><th>Lote</th><th className="text-end">Cantidad</th><th>Usuario</th><th>Referencia / observación</th></tr>
              </thead>
              <tbody>
                {(data?.data.length ?? 0) === 0 && <tr><td colSpan="9" className="text-center text-muted py-4">Sin movimientos con esos filtros</td></tr>}
                {data?.data.map((m) => (
                  <tr key={m.id}>
                    <td className="text-nowrap">{fechaHora(m.fecha)}</td>
                    <td><span className={`badge text-bg-${m.signo > 0 ? 'success' : 'danger'}`}>{m.tipo}</span></td>
                    <td>{m.motivo}</td>
                    <td><span className="text-muted me-1">{m.sku}</span>{m.producto}</td>
                    <td>{m.sucursal}</td>
                    <td className="font-monospace">{m.numero_lote ?? '—'}</td>
                    <td className={`text-end fw-semibold ${m.signo > 0 ? 'text-success' : 'text-danger'}`}>{m.cantidad_signada > 0 ? `+${m.cantidad_signada}` : m.cantidad_signada}</td>
                    <td>{m.usuario}</td>
                    <td>{[m.referencia, m.observacion].filter(Boolean).join(' · ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} limit={LIMIT} total={data?.total ?? 0} onPage={setPage} />
        </>
      )}
    </>
  );
}
