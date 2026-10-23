import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../../api.js';
import { fechaCorta, money, soloFecha } from '../../format.js';
import { descargarArchivo } from '../../archivos.js';
import FiltroFechas from '../../components/FiltroFechas.jsx';
import { estadoOcClase } from './estados.js';
import { ErrorAlert, Filtros, PageHeader, Pager, Spinner, useAsync } from '../../components/ui.jsx';

const LIMIT = 15;

export default function OrdenesCompra() {
  const [q, setQ] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [estado, setEstado] = useState('');
  const [fechas, setFechas] = useState({ desde: '', hasta: '' });
  const [page, setPage] = useState(1);
  const [pdfError, setPdfError] = useState(null);

  const catalogos = useAsync(() => api.get('/catalogos'), []);
  const rangoInvalido = fechas.desde && fechas.hasta && fechas.desde > fechas.hasta;
  const { data, error, loading } = useAsync(
    () => (rangoInvalido ? Promise.resolve(null)
      : api.get(`/ordenes-compra${qs({ q: busqueda, estado_id: estado, ...fechas, page, limit: LIMIT })}`)),
    [busqueda, estado, fechas.desde, fechas.hasta, page]);

  const cambiarFechas = (f) => { setPage(1); setFechas(f); };

  return (
    <>
      <PageHeader title="Órdenes de compra">
        <Link to="/ordenes-compra/nueva" className="btn btn-primary"><i className="bi bi-plus-lg me-1" />Nueva orden</Link>
      </PageHeader>
      <Filtros>
        <form className="row g-2" onSubmit={(e) => { e.preventDefault(); setPage(1); setBusqueda(q); }}>
          <div className="col-md-6"><input className="form-control" placeholder="Buscar por N° (OC-000123) o proveedor" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="col-md-3">
            <select className="form-select" value={estado} onChange={(e) => { setPage(1); setEstado(e.target.value); }}>
              <option value="">Todos los estados</option>
              {catalogos.data?.estados_orden_compra.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          <div className="col-md-3"><button className="btn btn-outline-secondary w-100">Buscar</button></div>
        </form>
        <div className="d-flex flex-wrap align-items-center gap-2">
          <span className="small text-muted">Fecha de creación:</span>
          <FiltroFechas desde={fechas.desde} hasta={fechas.hasta} onChange={cambiarFechas} />
        </div>
      </Filtros>
      {rangoInvalido && <div className="alert alert-warning py-2">La fecha "desde" no puede ser posterior a "hasta".</div>}
      <ErrorAlert error={error || pdfError} onClose={pdfError ? () => setPdfError(null) : undefined} />
      {loading ? <Spinner /> : (
        <>
          <div className="table-responsive">
            <table className="table table-hover align-middle">
              <thead>
                <tr><th>N°</th><th>Fecha</th><th>Proveedor</th><th>Sucursal</th><th>Esperada</th><th>Estado</th><th className="text-end">Total</th><th /></tr>
              </thead>
              <tbody>
                {(data?.data.length ?? 0) === 0 && <tr><td colSpan="8" className="text-center text-muted py-4">Sin resultados</td></tr>}
                {data?.data.map((o) => (
                  <tr key={o.id}>
                    <td className="font-monospace fw-semibold"><Link to={`/ordenes-compra/${o.id}`} className="text-decoration-none">{o.codigo}</Link></td>
                    <td>{fechaCorta(o.fecha)}</td>
                    <td>{o.proveedor}</td>
                    <td>{o.sucursal}</td>
                    <td>{soloFecha(o.fecha_esperada)}</td>
                    <td><span className={`badge text-bg-${estadoOcClase[o.estado] ?? 'light'}`}>{o.estado}</span></td>
                    <td className="text-end">{money(o.total)}</td>
                    <td className="text-nowrap text-end">
                      <Link to={`/ordenes-compra/${o.id}`} className="btn btn-sm btn-outline-primary me-1" title="Ver"><i className="bi bi-eye" /></Link>
                      <button className="btn btn-sm btn-outline-secondary" title="Descargar PDF"
                        onClick={() => descargarArchivo(`/ordenes-compra/${o.id}/pdf`, `${o.codigo}.pdf`).catch(setPdfError)}>
                        <i className="bi bi-file-earmark-pdf" />
                      </button>
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
