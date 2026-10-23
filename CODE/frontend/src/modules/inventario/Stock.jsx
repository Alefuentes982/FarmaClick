import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../../api.js';
import { soloFecha } from '../../format.js';
import { ErrorAlert, Filtros, PageHeader, Pager, Spinner, useAsync } from '../../components/ui.jsx';
import Pestanas from './Pestanas.jsx';

const LIMIT = 15;

export default function Stock() {
  const [q, setQ] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [sucursal, setSucursal] = useState('');
  const [soloBajo, setSoloBajo] = useState(false);
  const [page, setPage] = useState(1);
  const [minimos, setMinimos] = useState({}); // "producto:sucursal" -> texto editado
  const [guardado, setGuardado] = useState(null);
  const [actionError, setActionError] = useState(null);

  const catalogos = useAsync(() => api.get('/catalogos'), []);
  const { data, error, loading, reload } = useAsync(
    () => api.get(`/inventario/stock${qs({ q: busqueda, sucursal_id: sucursal, solo_bajo_minimo: soloBajo || '', page, limit: LIMIT })}`),
    [busqueda, sucursal, soloBajo, page]);

  const clave = (f) => `${f.producto_id}:${f.sucursal_id}`;

  const guardarMinimo = async (f) => {
    const texto = minimos[clave(f)];
    if (texto === undefined || Number(texto) === f.stock_minimo) return;
    setActionError(null);
    try {
      await api.put('/inventario/stock/minimo', { producto_id: f.producto_id, sucursal_id: f.sucursal_id, stock_minimo: Number(texto || 0) });
      setGuardado(clave(f));
      setMinimos(({ [clave(f)]: _, ...resto }) => resto);
      reload();
    } catch (e) {
      setActionError(e);
    }
  };

  return (
    <>
      <PageHeader title="Inventario" />
      <Pestanas />
      <Filtros>
        <form className="row g-2" onSubmit={(e) => { e.preventDefault(); setPage(1); setBusqueda(q); }}>
          <div className="col-md-5"><input className="form-control" placeholder="Buscar por SKU o nombre" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="col-md-3">
            <select className="form-select" value={sucursal} onChange={(e) => { setPage(1); setSucursal(e.target.value); }}>
              <option value="">Todas las sucursales</option>
              {catalogos.data?.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          <div className="col-md-2 d-flex align-items-center">
            <div className="form-check">
              <input id="bajo" type="checkbox" className="form-check-input" checked={soloBajo} onChange={(e) => { setPage(1); setSoloBajo(e.target.checked); }} />
              <label htmlFor="bajo" className="form-check-label">Bajo mínimo</label>
            </div>
          </div>
          <div className="col-md-2"><button className="btn btn-outline-secondary w-100">Buscar</button></div>
        </form>
      </Filtros>

      <ErrorAlert error={error || actionError} onClose={actionError ? () => setActionError(null) : undefined} />
      {loading && !data ? <Spinner /> : (
        <>
          <div className="table-responsive">
            <table className="table table-hover align-middle">
              <thead>
                <tr>
                  <th>SKU</th><th>Producto</th><th>Sucursal</th>
                  <th className="text-end">Disponible</th><th className="text-end">Vencido</th>
                  <th>Próx. vencimiento</th><th style={{ width: 130 }}>Stock mínimo</th><th />
                </tr>
              </thead>
              <tbody>
                {(data?.data.length ?? 0) === 0 && <tr><td colSpan="8" className="text-center text-muted py-4">Sin existencias registradas. Cargue stock con "Registrar ajuste" o recibiendo una orden de compra.</td></tr>}
                {data?.data.map((f) => (
                  <tr key={clave(f)} className={f.bajo_minimo ? 'table-warning' : ''}>
                    <td>{f.sku}</td>
                    <td>{f.producto}{!f.activo && <span className="badge text-bg-secondary ms-2">De baja</span>}</td>
                    <td>{f.sucursal}</td>
                    <td className="text-end fw-semibold">
                      {f.disponible}
                      {f.bajo_minimo && <span className="badge text-bg-warning ms-2">Bajo mínimo</span>}
                    </td>
                    <td className="text-end">{f.vencido > 0 ? <span className="badge text-bg-danger">{f.vencido}</span> : '—'}</td>
                    <td>{soloFecha(f.proximo_vencimiento)}</td>
                    <td>
                      <input type="number" min="0" step="1" className="form-control form-control-sm"
                        value={minimos[clave(f)] ?? f.stock_minimo}
                        onChange={(e) => { setGuardado(null); setMinimos((m) => ({ ...m, [clave(f)]: e.target.value })); }}
                        onBlur={() => guardarMinimo(f)}
                        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
                      {guardado === clave(f) && <div className="form-text text-success">Guardado</div>}
                    </td>
                    <td className="text-nowrap text-end">
                      <Link className="btn btn-sm btn-outline-secondary me-1" title="Ver lotes"
                        to={`/inventario/lotes${qs({ q: f.sku, sucursal_id: f.sucursal_id })}`}><i className="bi bi-calendar-x" /></Link>
                      <Link className="btn btn-sm btn-outline-primary" title="Registrar ajuste"
                        to={`/inventario/ajuste${qs({ producto_id: f.producto_id, sucursal_id: f.sucursal_id })}`}><i className="bi bi-sliders" /></Link>
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
