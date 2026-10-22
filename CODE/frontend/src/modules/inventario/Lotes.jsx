import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../../api.js';
import { soloFecha } from '../../format.js';
import { ErrorAlert, Filtros, PageHeader, Pager, Spinner, useAsync } from '../../components/ui.jsx';
import Pestanas from './Pestanas.jsx';

const LIMIT = 15;
const ESTADOS = [['vigente', 'Vigente', 'success'], ['por_vencer', 'Por vencer', 'warning'], ['vencido', 'Vencido', 'danger'], ['sin_vencimiento', 'Sin vencimiento', 'secondary']];
const etiqueta = Object.fromEntries(ESTADOS.map(([k, n, c]) => [k, { nombre: n, color: c }]));

export default function Lotes() {
  const [params] = useSearchParams(); // llegan desde Stock: ?q=SKU&sucursal_id=...
  const [q, setQ] = useState(params.get('q') ?? '');
  const [busqueda, setBusqueda] = useState(params.get('q') ?? '');
  const [sucursal, setSucursal] = useState(params.get('sucursal_id') ?? '');
  const [estado, setEstado] = useState('');
  const [agotados, setAgotados] = useState(false);
  const [page, setPage] = useState(1);
  const [aviso, setAviso] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);

  const catalogos = useAsync(() => api.get('/catalogos'), []);
  const { data, error, loading, reload } = useAsync(
    () => api.get(`/inventario/lotes${qs({ q: busqueda, sucursal_id: sucursal, estado, con_stock: agotados ? 'false' : '', page, limit: LIMIT })}`),
    [busqueda, sucursal, estado, agotados, page]);

  const ejecutar = async (fn, mensaje) => {
    setActionError(null);
    setAviso(null);
    setBusy(true);
    try {
      setAviso(mensaje(await fn()));
      reload();
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(false);
    }
  };

  const bajaLote = (l) => window.confirm(`¿Dar de baja las ${l.cantidad_actual} unidades vencidas del lote ${l.numero_lote ?? ''} de ${l.producto}?`)
    && ejecutar(() => api.post(`/inventario/lotes/${l.id}/baja-vencido`), (r) => `Se dieron de baja ${r.unidades} unidades.`);

  const bajaMasiva = () => window.confirm('¿Dar de baja todos los lotes vencidos con stock? Quedará registrado en el kardex como "Producto vencido".')
    && ejecutar(() => api.post('/inventario/lotes/bajas-vencidos', { sucursal_id: sucursal || null }),
      (r) => (r.lotes ? `Se dieron de baja ${r.lotes} lote(s), ${r.unidades} unidades.` : 'No hay lotes vencidos con stock.'));

  return (
    <>
      <PageHeader title="Inventario">
        <button className="btn btn-outline-danger" disabled={busy} onClick={bajaMasiva}>
          <i className="bi bi-trash3 me-1" />Dar de baja vencidos
        </button>
      </PageHeader>
      <Pestanas />
      <Filtros>
        <form className="row g-2" onSubmit={(e) => { e.preventDefault(); setPage(1); setBusqueda(q); }}>
          <div className="col-md-4"><input className="form-control" placeholder="SKU, producto o N° de lote" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="col-md-3">
            <select className="form-select" value={sucursal} onChange={(e) => { setPage(1); setSucursal(e.target.value); }}>
              <option value="">Todas las sucursales</option>
              {catalogos.data?.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          <div className="col-md-2">
            <select className="form-select" value={estado} onChange={(e) => { setPage(1); setEstado(e.target.value); }}>
              <option value="">Todos</option>
              {ESTADOS.map(([k, n]) => <option key={k} value={k}>{n}{k === 'por_vencer' ? ' (30 días)' : ''}</option>)}
            </select>
          </div>
          <div className="col-md-2 d-flex align-items-center">
            <div className="form-check">
              <input id="agot" type="checkbox" className="form-check-input" checked={agotados} onChange={(e) => { setPage(1); setAgotados(e.target.checked); }} />
              <label htmlFor="agot" className="form-check-label">Incluir agotados</label>
            </div>
          </div>
          <div className="col-md-1"><button className="btn btn-outline-secondary w-100"><i className="bi bi-search" /></button></div>
        </form>
      </Filtros>

      {aviso && <div className="alert alert-success py-2">{aviso}</div>}
      <ErrorAlert error={error || actionError} onClose={actionError ? () => setActionError(null) : undefined} />
      {loading && !data ? <Spinner /> : (
        <>
          <div className="table-responsive">
            <table className="table table-hover align-middle">
              <thead>
                <tr>
                  <th>Producto</th><th>Sucursal</th><th>N° lote</th><th>Vencimiento</th><th>Estado</th>
                  <th className="text-end">Recibida</th><th className="text-end">Actual</th><th>Origen</th><th />
                </tr>
              </thead>
              <tbody>
                {(data?.data.length ?? 0) === 0 && <tr><td colSpan="9" className="text-center text-muted py-4">Sin lotes con esos filtros</td></tr>}
                {data?.data.map((l) => (
                  <tr key={l.id} className={l.estado === 'vencido' && l.cantidad_actual > 0 ? 'table-danger' : ''}>
                    <td><span className="text-muted me-1">{l.sku}</span>{l.producto}</td>
                    <td>{l.sucursal}</td>
                    <td className="font-monospace">{l.numero_lote ?? '—'}</td>
                    <td>
                      {soloFecha(l.fecha_vencimiento)}
                      {l.dias_para_vencer != null && l.estado !== 'vigente' && (
                        <div className="small text-muted">{l.dias_para_vencer < 0 ? `hace ${-l.dias_para_vencer} días` : `en ${l.dias_para_vencer} días`}</div>
                      )}
                    </td>
                    <td><span className={`badge text-bg-${etiqueta[l.estado].color}`}>{etiqueta[l.estado].nombre}</span></td>
                    <td className="text-end">{l.cantidad_recibida}</td>
                    <td className="text-end fw-semibold">{l.cantidad_actual}</td>
                    <td>{l.orden_compra ?? 'Ajuste'}</td>
                    <td className="text-end">
                      {l.estado === 'vencido' && l.cantidad_actual > 0 && (
                        <button className="btn btn-sm btn-outline-danger" disabled={busy} onClick={() => bajaLote(l)}>Dar de baja</button>
                      )}
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
