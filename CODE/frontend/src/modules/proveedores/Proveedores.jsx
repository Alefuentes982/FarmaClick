import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../../api.js';
import { ErrorAlert, Filtros, PageHeader, Pager, Spinner, useAsync } from '../../components/ui.jsx';

const LIMIT = 15;

export default function Proveedores() {
  const [q, setQ] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, loading } = useAsync(
    () => api.get(`/proveedores${qs({ q: busqueda, page, limit: LIMIT })}`), [busqueda, page]);

  return (
    <>
      <PageHeader title="Proveedores">
        <Link to="/proveedores/nuevo" className="btn btn-primary"><i className="bi bi-plus-lg me-1" />Nuevo proveedor</Link>
      </PageHeader>
      <Filtros>
        <form className="row g-2" onSubmit={(e) => { e.preventDefault(); setPage(1); setBusqueda(q); }}>
          <div className="col-md-9"><input className="form-control" placeholder="Buscar por nombre o RUT" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="col-md-3"><button className="btn btn-outline-secondary w-100">Buscar</button></div>
        </form>
      </Filtros>
      <ErrorAlert error={error} />
      {loading ? <Spinner /> : (
        <>
          <div className="table-responsive">
            <table className="table table-hover align-middle">
              <thead><tr><th>Nombre</th><th>RUT</th><th>Contacto</th><th /></tr></thead>
              <tbody>
                {data?.data.length === 0 && <tr><td colSpan="4" className="text-center text-muted py-4">Sin resultados</td></tr>}
                {data?.data.map((p) => (
                  <tr key={p.id}>
                    <td>{p.nombre}</td><td>{p.rut}</td><td>{p.contacto || '—'}</td>
                    <td className="text-end"><Link to={`/proveedores/${p.id}`} className="btn btn-sm btn-outline-primary"><i className="bi bi-pencil" /></Link></td>
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
