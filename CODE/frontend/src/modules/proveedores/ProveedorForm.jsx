import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { Slot } from '../../extensiones.jsx';
import { ErrorAlert, Field, PageHeader, Spinner, useAsync } from '../../components/ui.jsx';

export default function ProveedorForm() {
  const { id } = useParams();
  const editando = Boolean(id);
  const navigate = useNavigate();
  const [form, setForm] = useState({ nombre: '', rut: '', contacto: '' });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const prov = useAsync(() => (editando ? api.get(`/proveedores/${id}`) : Promise.resolve(null)), [id]);

  useEffect(() => {
    if (prov.data) setForm({ nombre: prov.data.nombre, rut: prov.data.rut, contacto: prov.data.contacto ?? '' });
  }, [prov.data]);

  const set = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  const guardar = async (e) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (editando) await api.put(`/proveedores/${id}`, form);
      else await api.post('/proveedores', form);
      navigate('/proveedores');
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  };

  if (prov.loading) return <Spinner />;
  if (prov.error) return <ErrorAlert error={prov.error} />;

  return (
    <>
      <PageHeader title={editando ? 'Editar proveedor' : 'Nuevo proveedor'} />
      <ErrorAlert error={error} onClose={() => setError(null)} />
      <form onSubmit={guardar} className="fc-formulario mb-4" style={{ maxWidth: 640 }}>
        <Field label="Nombre"><input className="form-control" required maxLength={150} value={form.nombre} onChange={set('nombre')} /></Field>
        <Field label="RUT" hint="Se valida el dígito verificador. Ej: 76.086.428-5">
          <input className="form-control" required maxLength={12} value={form.rut} onChange={set('rut')} />
        </Field>
        <Field label="Contacto"><input className="form-control" maxLength={150} value={form.contacto} onChange={set('contacto')} /></Field>
        <div className="d-flex gap-2">
          <button className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
          <Link to="/proveedores" className="btn btn-outline-secondary">Cancelar</Link>
        </div>
      </form>

      {/* Otros módulos (p. ej. productos) agregan aquí sus secciones de la ficha. */}
      {editando && <Slot nombre="proveedor.ficha" proveedorId={id} />}
    </>
  );
}
