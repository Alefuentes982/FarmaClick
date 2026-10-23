import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../../api.js';
import { descargarArchivo } from '../../archivos.js';
import { fechaHora, money } from '../../format.js';
import FiltroFechas from '../../components/FiltroFechas.jsx';
import { ErrorAlert, Filtros, PageHeader, Pager, Spinner, useAsync } from '../../components/ui.jsx';

const LIMIT = 15;

export default function Devoluciones() {
  const [q, setQ] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [sucursal, setSucursal] = useState('');
  const [fechas, setFechas] = useState({ desde: '', hasta: '' });
  const [page, setPage] = useState(1);
  const [actionError, setActionError] = useState(null);

  const catalogos = useAsync(() => api.get('/catalogos'), []);
  const rangoInvalido = fechas.desde && fechas.hasta && fechas.desde > fechas.hasta;
  const { data, error, loading } = useAsync(
    () => (rangoInvalido ? Promise.resolve(null)
      : api.get(`/devoluciones${qs({ q: busqueda, sucursal_id: sucursal, ...fechas, page, limit: LIMIT })}`)),
    [busqueda, sucursal, fechas.desde, fechas.hasta, page]);

  return (
    <>
      <PageHeader title="Devoluciones">
        <Link to="/devoluciones/nueva" className="btn btn-primary"><i className="bi bi-plus-lg me-1" />Nueva devolución</Link>
      </PageHeader>
      <Filtros>
        <form className="row g-2" onSubmit={(e) => { e.preventDefault(); setPage(1); setBusqueda(q); }}>
          <div className="col-md-6"><input className="form-control" placeholder="N° de devolución (DEV-000012), de pedido (PED-000123) o cliente" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="col-md-4">
            <select className="form-select" value={sucursal} onChange={(e) => { setPage(1); setSucursal(e.target.value); }}>
              <option value="">Todas las sucursales</option>
              {catalogos.data?.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          <div className="col-md-2"><button className="btn btn-outline-secondary w-100">Buscar</button></div>
        </form>
        <div className="d-flex flex-wrap align-items-center gap-2">
          <span className="small text-muted">Fecha:</span>
          <FiltroFechas desde={fechas.desde} hasta={fechas.hasta} onChange={(f) => { setPage(1); setFechas(f); }} />
        </div>
      </Filtros>
      {rangoInvalido && <div className="alert alert-warning py-2">La fecha "desde" no puede ser posterior a "hasta".</div>}
      <ErrorAlert error={error || actionError} onClose={actionError ? () => setActionError(null) : undefined} />
      {loading && !data ? <Spinner /> : (
        <>
          <div className="table-responsive">
            <table className="table table-hover align-middle">
              <thead><tr><th>N°</th><th>Fecha</th><th>Pedido</th><th>Cliente</th><th>Sucursal</th><th>Motivo</th><th>Atendió</th><th className="text-end">Devuelto</th><th /></tr></thead>
              <tbody>
                {(data?.data.length ?? 0) === 0 && <tr><td colSpan="9" className="text-center text-muted py-4">Sin devoluciones con esos filtros</td></tr>}
                {data?.data.map((d) => (
                  <tr key={d.id}>
                    <td className="font-monospace fw-semibold"><Link to={`/devoluciones/${d.id}`} className="text-decoration-none">{d.codigo}</Link></td>
                    <td className="text-nowrap">{fechaHora(d.fecha)}</td>
                    <td className="font-monospace">{d.pedido_codigo}</td>
                    <td>{d.nombre_cliente}</td>
                    <td>{d.sucursal ?? '—'}</td>
                    <td>{d.motivo}</td>
                    <td>{d.usuario}</td>
                    <td className="text-end fw-semibold">{money(d.total_reembolso)}</td>
                    <td className="text-nowrap text-end">
                      <Link to={`/devoluciones/${d.id}`} className="btn btn-sm btn-outline-primary me-1" title="Ver"><i className="bi bi-eye" /></Link>
                      <button className="btn btn-sm btn-outline-secondary" title="Descargar comprobante"
                        onClick={() => descargarArchivo(`/devoluciones/${d.id}/pdf`, `${d.codigo}.pdf`).catch(setActionError)}><i className="bi bi-file-earmark-pdf" /></button>
                    </td>
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
