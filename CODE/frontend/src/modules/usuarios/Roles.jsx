import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { ErrorAlert, PageHeader, Spinner, useAsync } from '../../components/ui.jsx';

export default function Roles() {
  const { data, error, loading, reload } = useAsync(() => api.get('/roles'), []);
  const [matriz, setMatriz] = useState({}); // rol_id -> { modulo_id: boolean }
  const [saveError, setSaveError] = useState(null);
  const [ok, setOk] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) setMatriz(Object.fromEntries(data.roles.map((r) => [r.id, { ...r.permisos }])));
  }, [data]);

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;

  const cambiados = data.roles.filter((r) =>
    data.modulos.some((m) => Boolean(matriz[r.id]?.[m.id]) !== Boolean(r.permisos[m.id])));

  const toggle = (rolId, moduloId) => {
    setOk(false);
    setMatriz((mx) => ({ ...mx, [rolId]: { ...mx[rolId], [moduloId]: !mx[rolId]?.[moduloId] } }));
  };

  const guardar = async () => {
    setSaveError(null);
    setSaving(true);
    try {
      for (const rol of cambiados) {
        await api.put(`/roles/${rol.id}/permisos`, {
          permisos: data.modulos.map((m) => ({ modulo_id: m.id, permitido: Boolean(matriz[rol.id]?.[m.id]) })),
        });
      }
      setOk(true);
      reload();
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="Roles y permisos">
        <Link to="/usuarios" className="btn btn-outline-secondary">Volver a usuarios</Link>
      </PageHeader>
      <p className="text-muted">
        Marque a qué módulos accede cada rol. Los cambios rigen de inmediato, incluso para quienes ya tienen sesión iniciada.
      </p>
      <ErrorAlert error={saveError} onClose={() => setSaveError(null)} />
      {ok && <div className="alert alert-success">Permisos guardados.</div>}
      <div className="table-responsive mb-3">
        <table className="table align-middle">
          <thead>
            <tr><th>Módulo</th>{data.roles.map((r) => <th key={r.id} className="text-center">{r.nombre}</th>)}</tr>
          </thead>
          <tbody>
            {data.modulos.map((m) => (
              <tr key={m.id}>
                <td>{m.nombre}</td>
                {data.roles.map((r) => {
                  const bloqueado = r.nombre === 'Administrador' && m.clave === 'usuarios';
                  return (
                    <td key={r.id} className="text-center">
                      <input type="checkbox" className="form-check-input" disabled={bloqueado}
                        title={bloqueado ? 'El administrador siempre gestiona usuarios y permisos' : undefined}
                        checked={Boolean(matriz[r.id]?.[m.id])} onChange={() => toggle(r.id, m.id)} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn btn-primary" disabled={saving || cambiados.length === 0} onClick={guardar}>
        {saving ? 'Guardando…' : 'Guardar cambios'}
      </button>
    </>
  );
}
