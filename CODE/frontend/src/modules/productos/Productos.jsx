import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../../api.js';
import { money, percent } from '../../format.js';
import { ErrorAlert, Filtros, PageHeader, Pager, Spinner, useAsync } from '../../components/ui.jsx';

const LIMIT = 15;

export default function Productos() {
  const [q, setQ] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [activo, setActivo] = useState('');
  const [page, setPage] = useState(1);
  const [actionError, setActionError] = useState(null);

  const { data, error, loading, reload } = useAsync(
    () => api.get(`/productos${qs({ q: busqueda, activo, page, limit: LIMIT })}`),
    [busqueda, activo, page]
  );

  const toggleActivo = async (p) => {
    setActionError(null);
    try {
      await api.patch(`/productos/${p.id}/activo`, { activo: !p.activo });
      reload();
    } catch (e) {
      setActionError(e);
    }
  };

  return (
    <>
      <PageHeader title="Productos">
        <Link to="/productos/nuevo" className="btn btn-primary"><i className="bi bi-plus-lg me-1" />Nuevo producto</Link>
      </PageHeader>

      <Filtros>
        <form
          className="row g-2"
          onSubmit={(e) => { e.preventDefault(); setPage(1); setBusqueda(q); }}
        >
          <div className="col-md-6">
            <input className="form-control" placeholder="Buscar por SKU o nombre" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="col-md-3">
            <select className="form-select" value={activo} onChange={(e) => { setPage(1); setActivo(e.target.value); }}>
              <option value="">Todos</option>
              <option value="true">Activos</option>
              <option value="false">Dados de baja</option>
            </select>
          </div>
          <div className="col-md-3"><button className="btn btn-outline-secondary w-100">Buscar</button></div>
        </form>
      </Filtros>

      <ErrorAlert error={error || actionError} onClose={() => setActionError(null)} />
      {loading ? <Spinner /> : (
        <>
          <div className="table-responsive">
            <table className="table table-hover align-middle">
              <thead>
                <tr>
                  <th>SKU</th><th>Nombre</th><th>Categoría</th><th>Condición de venta</th>
                  <th className="text-end">Costo neto</th><th className="text-end">Margen</th>
                  <th className="text-end">Precio</th><th className="text-end">Stock web</th><th>Estado</th><th />
                </tr>
              </thead>
              <tbody>
                {data?.data.length === 0 && <tr><td colSpan="10" className="text-center text-muted py-4">Sin resultados</td></tr>}
                {data?.data.map((p) => (
                  <tr key={p.id} className={p.activo ? '' : 'text-muted'}>
                    <td className="text-nowrap">{p.sku}</td>
                    <td>{p.nombre}</td>
                    <td>{p.categoria}</td>
                    <td>{p.condicion_venta}</td>
                    <td className="text-end">{money(p.costo)}</td>
                    <td className="text-end">{percent(p.margen_utilidad)}</td>
                    <td className="text-end fw-semibold">{money(p.precio)}</td>
                    <td className="text-end">{p.stock_total_web}</td>
                    <td><span className={`badge text-bg-${p.activo ? 'success' : 'secondary'}`}>{p.activo ? 'Activo' : 'De baja'}</span></td>
                    <td className="text-nowrap text-end">
                      <Link to={`/productos/${p.id}`} className="btn btn-sm btn-outline-primary me-1" title="Editar"><i className="bi bi-pencil" /></Link>
                      <button className="btn btn-sm btn-outline-secondary" onClick={() => toggleActivo(p)} title={p.activo ? 'Dar de baja' : 'Reactivar'}>
                        <i className={`bi ${p.activo ? 'bi-slash-circle' : 'bi-arrow-counterclockwise'}`} />
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
