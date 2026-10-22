import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../AuthContext.jsx';
import { ErrorAlert, Field, PageHeader, Spinner, useAsync } from '../../components/ui.jsx';

export default function UsuarioForm() {
  const { id } = useParams();
  const editando = Boolean(id);
  const navigate = useNavigate();
  const { user } = useAuth();
  const propio = editando && id === user.id;

  const [form, setForm] = useState({ nombre: '', correo: '', password: '', rol_id: '', sucursal_id: '', activo: true });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const base = useAsync(async () => {
    const [roles, catalogos] = await Promise.all([api.get('/roles'), api.get('/catalogos')]);
    return { roles: roles.roles, sucursales: catalogos.sucursales };
  }, []);
  const usuario = useAsync(() => (editando ? api.get(`/usuarios/${id}`) : Promise.resolve(null)), [id]);

  useEffect(() => {
    const u = usuario.data;
    if (u) setForm({ nombre: u.nombre, correo: u.correo, password: '', rol_id: u.rol_id, sucursal_id: u.sucursal_id ?? '', activo: u.activo });
  }, [usuario.data]);

  const set = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const guardar = async (e) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const { password, ...resto } = form;
      const body = { ...resto, sucursal_id: form.sucursal_id || null, ...(password && { password }) };
      if (editando) await api.put(`/usuarios/${id}`, body);
      else await api.post('/usuarios', body);
      navigate('/usuarios');
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  };

  if (base.loading || usuario.loading) return <Spinner />;
  if (base.error || usuario.error) return <ErrorAlert error={base.error || usuario.error} />;

  return (
    <>
      <PageHeader title={editando ? 'Editar usuario' : 'Nuevo usuario'} />
      <ErrorAlert error={error} onClose={() => setError(null)} />
      <form onSubmit={guardar} className="fc-formulario" style={{ maxWidth: 640 }}>
        <Field label="Nombre"><input className="form-control" required maxLength={150} value={form.nombre} onChange={set('nombre')} /></Field>
        <Field label="Correo (es el usuario de acceso)"><input type="email" className="form-control" required maxLength={150} value={form.correo} onChange={set('correo')} /></Field>
        <Field label={editando ? 'Nueva contraseña' : 'Contraseña'} hint={editando ? 'Déjela vacía para no cambiarla. Mínimo 8 caracteres.' : 'Mínimo 8 caracteres.'}>
          <input type="password" className="form-control" autoComplete="new-password" minLength={8} required={!editando}
            value={form.password} onChange={set('password')} />
        </Field>
        <div className="row">
          <div className="col-md-6">
            <Field label="Rol" hint={propio ? 'No puede cambiar su propio rol.' : undefined}>
              <select className="form-select" required disabled={propio} value={form.rol_id} onChange={set('rol_id')}>
                <option value="">Seleccione…</option>
                {base.data.roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
              </select>
            </Field>
          </div>
          <div className="col-md-6">
            <Field label="Sucursal">
              <select className="form-select" value={form.sucursal_id} onChange={set('sucursal_id')}>
                <option value="">Sin sucursal</option>
                {base.data.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </Field>
          </div>
        </div>
        <div className="form-check form-switch mb-4">
          <input id="activo" type="checkbox" className="form-check-input" disabled={propio} checked={form.activo} onChange={set('activo')} />
          <label htmlFor="activo" className="form-check-label">Activo (puede iniciar sesión)</label>
        </div>
        <div className="d-flex gap-2">
          <button className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
          <Link to="/usuarios" className="btn btn-outline-secondary">Cancelar</Link>
        </div>
      </form>
    </>
  );
}
