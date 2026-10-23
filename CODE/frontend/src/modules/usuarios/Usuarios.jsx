import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../../api.js';
import { ErrorAlert, Filtros, PageHeader, Pager, Spinner, useAsync } from '../../components/ui.jsx';

const LIMIT = 15;

export default function Usuarios() {
  const [q, setQ] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, loading } = useAsync(
    () => api.get(`/usuarios${qs({ q: busqueda, page, limit: LIMIT })}`), [busqueda, page]);

  return (
    <>
      <PageHeader title="Usuarios">
        <Link to="/usuarios/roles" className="btn btn-outline-secondary"><i className="bi bi-shield-lock me-1" />Roles y permisos</Link>
        <Link to="/usuarios/nuevo" className="btn btn-primary"><i className="bi bi-plus-lg me-1" />Nuevo usuario</Link>
      </PageHeader>
      <Filtros>
        <form className="row g-2" onSubmit={(e) => { e.preventDefault(); setPage(1); setBusqueda(q); }}>
          <div className="col-md-9"><input className="form-control" placeholder="Buscar por nombre o correo" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="col-md-3"><button className="btn btn-outline-secondary w-100">Buscar</button></div>
        </form>
      </Filtros>
      <ErrorAlert error={error} />
      {loading ? <Spinner /> : (
        <>
          <div className="table-responsive">
            <table className="table table-hover align-middle">
              <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Sucursal</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {data?.data.length === 0 && <tr><td colSpan="6" className="text-center text-muted py-4">Sin resultados</td></tr>}
                {data?.data.map((u) => (
                  <tr key={u.id} className={u.activo ? '' : 'text-muted'}>
                    <td>{u.nombre}</td><td>{u.correo}</td>
                    <td><span className="badge text-bg-primary">{u.rol}</span></td>
                    <td>{u.sucursal || '—'}</td>
                    <td><span className={`badge text-bg-${u.activo ? 'success' : 'secondary'}`}>{u.activo ? 'Activo' : 'Inactivo'}</span></td>
                    <td className="text-end"><Link to={`/usuarios/${u.id}`} className="btn btn-sm btn-outline-primary"><i className="bi bi-pencil" /></Link></td>
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
