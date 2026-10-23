import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { money, percent } from '../../format.js';
import { ErrorAlert, Field, PageHeader, Spinner, useAsync } from '../../components/ui.jsx';

const vacio = {
  sku: '', nombre: '', costo: '0', margenPct: '', activo: true,
  requiere_vencimiento: true, requiere_lote: true, categoria_id: '', condicion_venta_id: '',
};

export default function ProductoForm() {
  const { id } = useParams();
  const editando = Boolean(id);
  const navigate = useNavigate();

  const [form, setForm] = useState(vacio);
  const [proveedores, setProveedores] = useState([]); // [{proveedor_id, costo_referencial, es_principal}]
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const cat = useAsync(async () => {
    const [catalogos, provs] = await Promise.all([api.get('/catalogos'), api.get('/proveedores?limit=500')]);
    return { ...catalogos, proveedores: provs.data };
  }, []);
  const prod = useAsync(() => (editando ? api.get(`/productos/${id}`) : Promise.resolve(null)), [id]);

  useEffect(() => {
    const p = prod.data;
    if (!p) return;
    setForm({
      sku: p.sku, nombre: p.nombre, costo: String(p.costo),
      margenPct: String(Math.round(Number(p.margen_utilidad) * 10000) / 100),
      activo: p.activo, requiere_vencimiento: p.requiere_vencimiento, requiere_lote: p.requiere_lote,
      categoria_id: p.categoria_id, condicion_venta_id: p.condicion_venta_id,
    });
    setProveedores(p.proveedores.map(({ proveedor_id, costo_referencial, es_principal }) => ({
      proveedor_id, costo_referencial: String(costo_referencial), es_principal,
    })));
  }, [prod.data]);

  const set = (campo) => (e) =>
    setForm((f) => ({ ...f, [campo]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const categoria = cat.data?.categorias.find((c) => c.id === form.categoria_id);
  const margen = Number(form.margenPct) / 100;
  const precioEstimado = Math.round(Number(form.costo || 0) * (1 + margen) * 1.19);

  const setProv = (i, cambios) => setProveedores((l) => l.map((p, j) => {
    if (j === i) return { ...p, ...cambios };
    return cambios.es_principal ? { ...p, es_principal: false } : p; // un solo principal
  }));

  const guardar = async (e) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const body = {
        sku: form.sku, nombre: form.nombre, margen_utilidad: margen, activo: form.activo,
        requiere_vencimiento: form.requiere_vencimiento, requiere_lote: form.requiere_lote,
        categoria_id: form.categoria_id, condicion_venta_id: form.condicion_venta_id,
      };
      let guardado;
      if (editando) guardado = await api.put(`/productos/${id}`, body);
      else guardado = await api.post('/productos', { ...body, costo: Number(form.costo || 0) });
      await api.put(`/productos/${guardado.id}/proveedores`, proveedores.map((p) => ({
        proveedor_id: p.proveedor_id, costo_referencial: Number(p.costo_referencial || 0), es_principal: p.es_principal,
      })));
      navigate('/productos');
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  };

  if (cat.loading || prod.loading) return <Spinner />;
  if (cat.error || prod.error) return <ErrorAlert error={cat.error || prod.error} />;

  const disponibles = (actual) => cat.data.proveedores.filter(
    (p) => p.id === actual || !proveedores.some((x) => x.proveedor_id === p.id));

  return (
    <>
      <PageHeader title={editando ? 'Editar producto' : 'Nuevo producto'} />
      <ErrorAlert error={error} onClose={() => setError(null)} />
      <form onSubmit={guardar} className="fc-formulario">
        <div className="row">
          <div className="col-md-4"><Field label="SKU"><input className="form-control" required maxLength={50} value={form.sku} onChange={set('sku')} /></Field></div>
          <div className="col-md-8"><Field label="Nombre"><input className="form-control" required maxLength={200} value={form.nombre} onChange={set('nombre')} /></Field></div>
          <div className="col-md-6">
            <Field label="Categoría">
              <select className="form-select" required value={form.categoria_id} onChange={set('categoria_id')}>
                <option value="">Seleccione…</option>
                {cat.data.categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </Field>
          </div>
          <div className="col-md-6">
            <Field label="Condición de venta">
              <select className="form-select" required value={form.condicion_venta_id} onChange={set('condicion_venta_id')}>
                <option value="">Seleccione…</option>
                {cat.data.condiciones_venta.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}{c.permite_venta_online ? '' : ' (no se vende online)'}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="col-md-4">
            <Field
              label="Costo neto"
              hint={editando ? 'Se recalcula solo (PMP) con cada recepción de orden de compra.' : 'Costo inicial; luego lo actualizan las recepciones.'}
            >
              <input className="form-control" type="number" min="0" step="1" disabled={editando} value={form.costo} onChange={set('costo')} />
            </Field>
          </div>
          <div className="col-md-4">
            <Field
              label="Margen de utilidad (%)"
              hint={categoria && `Categoría: pesimista ${percent(categoria.margen_pesimista)} · probable ${percent(categoria.margen_probable)} · optimista ${percent(categoria.margen_optimista)}`}
            >
              <input className="form-control" type="number" min="0" max="9999" step="0.01" required value={form.margenPct} onChange={set('margenPct')} />
              {categoria && (
                <button type="button" className="btn btn-link btn-sm p-0"
                  onClick={() => setForm((f) => ({ ...f, margenPct: String(Math.round(Number(categoria.margen_probable) * 10000) / 100) }))}>
                  Usar margen probable
                </button>
              )}
            </Field>
          </div>
          <div className="col-md-4">
            <Field label="Precio de venta estimado (IVA incl.)" hint="El precio final lo calcula la base de datos.">
              <input className="form-control" disabled value={money(Number.isFinite(precioEstimado) ? precioEstimado : 0)} />
            </Field>
          </div>
        </div>

        <div className="mb-4 d-flex flex-wrap gap-4">
          <div className="form-check form-switch"><input id="activo" type="checkbox" className="form-check-input" checked={form.activo} onChange={set('activo')} /><label htmlFor="activo" className="form-check-label">Activo</label></div>
          <div className="form-check form-switch"><input id="rv" type="checkbox" className="form-check-input" checked={form.requiere_vencimiento} onChange={set('requiere_vencimiento')} /><label htmlFor="rv" className="form-check-label">Exige fecha de vencimiento</label></div>
          <div className="form-check form-switch"><input id="rl" type="checkbox" className="form-check-input" checked={form.requiere_lote} onChange={set('requiere_lote')} /><label htmlFor="rl" className="form-check-label">Exige número de lote</label></div>
        </div>

        <h3 className="h5">Proveedores</h3>
        {proveedores.length === 0 && <p className="text-muted">Sin proveedores asociados.</p>}
        {proveedores.map((p, i) => (
          <div className="row g-2 align-items-center mb-2" key={i}>
            <div className="col-md-5">
              <select className="form-select" required value={p.proveedor_id} onChange={(e) => setProv(i, { proveedor_id: e.target.value })}>
                <option value="">Proveedor…</option>
                {disponibles(p.proveedor_id).map((pr) => <option key={pr.id} value={pr.id}>{pr.nombre}</option>)}
              </select>
            </div>
            <div className="col-md-3">
              <input className="form-control" type="number" min="0" step="1" required placeholder="Costo referencial"
                value={p.costo_referencial} onChange={(e) => setProv(i, { costo_referencial: e.target.value })} />
            </div>
            <div className="col-md-2">
              <div className="form-check">
                <input id={`pp${i}`} type="checkbox" className="form-check-input" checked={p.es_principal} onChange={(e) => setProv(i, { es_principal: e.target.checked })} />
                <label htmlFor={`pp${i}`} className="form-check-label">Principal</label>
              </div>
            </div>
            <div className="col-md-2 text-end">
              <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => setProveedores((l) => l.filter((_, j) => j !== i))}><i className="bi bi-trash" /></button>
            </div>
          </div>
        ))}
        <button type="button" className="btn btn-outline-secondary btn-sm mb-4"
          onClick={() => setProveedores((l) => [...l, { proveedor_id: '', costo_referencial: '', es_principal: l.length === 0 }])}>
          <i className="bi bi-plus" /> Agregar proveedor
        </button>

        <div className="d-flex gap-2">
          <button className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
          <Link to="/productos" className="btn btn-outline-secondary">Cancelar</Link>
        </div>
      </form>
    </>
  );
}
