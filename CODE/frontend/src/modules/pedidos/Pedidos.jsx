import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../../api.js';
import { descargarArchivo } from '../../archivos.js';
import { fechaHora, money } from '../../format.js';
import FiltroFechas from '../../components/FiltroFechas.jsx';
import { ErrorAlert, Filtros, PageHeader, Pager, Spinner, useAsync } from '../../components/ui.jsx';
import { estadoPedidoClase } from './estados.js';

const LIMIT = 15;

export default function Pedidos() {
  const [q, setQ] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [estado, setEstado] = useState('');
  const [canal, setCanal] = useState('');
  const [sucursal, setSucursal] = useState('');
  const [fechas, setFechas] = useState({ desde: '', hasta: '' });
  const [page, setPage] = useState(1);
  const [aviso, setAviso] = useState(null);
  const [actionError, setActionError] = useState(null);

  const catalogos = useAsync(() => api.get('/catalogos'), []);
  const rangoInvalido = fechas.desde && fechas.hasta && fechas.desde > fechas.hasta;
  const { data, error, loading, reload } = useAsync(
    () => (rangoInvalido ? Promise.resolve(null)
      : api.get(`/pedidos${qs({ q: busqueda, estado_id: estado, canal_id: canal, sucursal_id: sucursal, ...fechas, page, limit: LIMIT })}`)),
    [busqueda, estado, canal, sucursal, fechas.desde, fechas.hasta, page]);

  const expirar = async () => {
    if (!window.confirm('¿Expirar los pedidos sin pagar con más de 20 minutos? Su stock reservado volverá al inventario.')) return;
    setActionError(null);
    try {
      const { expirados } = await api.post('/pedidos/expirar-pendientes', { minutos: 20 });
      setAviso(expirados ? `${expirados} pedido(s) expirado(s) y su stock liberado.` : 'No hay pedidos sin pagar con más de 20 minutos.');
      reload();
    } catch (e) {
      setActionError(e);
    }
  };

  return (
    <>
      <PageHeader title="Pedidos">
        <button className="btn btn-outline-secondary" onClick={expirar} title="En producción lo hace un job cada 5 minutos">
          <i className="bi bi-hourglass-split me-1" />Expirar pendientes
        </button>
        <Link to="/pedidos/nuevo" className="btn btn-primary"><i className="bi bi-plus-lg me-1" />Nuevo pedido</Link>
      </PageHeader>

      <Filtros>
        <form className="row g-2" onSubmit={(e) => { e.preventDefault(); setPage(1); setBusqueda(q); }}>
          <div className="col-md-3"><input className="form-control" placeholder="N° (PED-000123) o cliente" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="col-md-3">
            <select className="form-select" value={estado} onChange={(e) => { setPage(1); setEstado(e.target.value); }}>
              <option value="">Todos los estados</option>
              {catalogos.data?.estados_pedido.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          <div className="col-md-2">
            <select className="form-select" value={canal} onChange={(e) => { setPage(1); setCanal(e.target.value); }}>
              <option value="">Todos los canales</option>
              {catalogos.data?.canales_venta.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          <div className="col-md-3">
            <select className="form-select" value={sucursal} onChange={(e) => { setPage(1); setSucursal(e.target.value); }}>
              <option value="">Todas las sucursales</option>
              {catalogos.data?.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
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

      {aviso && <div className="alert alert-success py-2">{aviso}</div>}
      <ErrorAlert error={error || actionError} onClose={actionError ? () => setActionError(null) : undefined} />
      {loading && !data ? <Spinner /> : (
        <>
          <div className="table-responsive">
            <table className="table table-hover align-middle">
              <thead>
                <tr><th>N°</th><th>Fecha</th><th>Cliente</th><th>Canal</th><th>Sucursal</th><th>Atendió</th><th>Estado</th><th className="text-end">Total</th><th /></tr>
              </thead>
              <tbody>
                {(data?.data.length ?? 0) === 0 && <tr><td colSpan="9" className="text-center text-muted py-4">Sin pedidos con esos filtros</td></tr>}
                {data?.data.map((p) => (
                  <tr key={p.id}>
                    <td className="font-monospace fw-semibold"><Link to={`/pedidos/${p.id}`} className="text-decoration-none">{p.codigo}</Link></td>
                    <td className="text-nowrap">{fechaHora(p.fecha)}</td>
                    <td>{p.nombre_cliente}</td>
                    <td>{p.canal}</td>
                    <td>{p.sucursal ?? '—'}</td>
                    <td>{p.vendedor ?? '—'}</td>
                    <td><span className={`badge text-bg-${estadoPedidoClase[p.estado] ?? 'light'}`}>{p.estado}</span></td>
                    <td className="text-end">{money(p.total)}</td>
                    <td className="text-nowrap text-end">
                      <Link to={`/pedidos/${p.id}`} className="btn btn-sm btn-outline-primary me-1" title="Ver"><i className="bi bi-eye" /></Link>
                      <button className="btn btn-sm btn-outline-secondary" title="Descargar comprobante"
                        onClick={() => descargarArchivo(`/pedidos/${p.id}/pdf`, `${p.codigo}.pdf`).catch(setActionError)}>
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
