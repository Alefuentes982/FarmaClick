import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs } from '../../api.js';
import { soloFecha } from '../../format.js';
import BuscadorProducto from '../../components/BuscadorProducto.jsx';
import { ErrorAlert, Field, PageHeader, Spinner, useAsync } from '../../components/ui.jsx';
import Pestanas from './Pestanas.jsx';

const AYUDA = {
  'Ajuste positivo': 'Suma unidades que existen físicamente y no estaban registradas (conteo, inventario inicial).',
  'Ajuste negativo': 'Descuenta unidades que no se encuentran al contar.',
  Merma: 'Descuenta unidades dañadas, perdidas o retiradas por otra causa.',
};

export default function Ajuste() {
  const navigate = useNavigate();
  const [params] = useSearchParams(); // llegan desde Stock: ?producto_id=...&sucursal_id=...
  const [form, setForm] = useState({
    sucursal_id: params.get('sucursal_id') ?? '', producto_id: params.get('producto_id') ?? '',
    motivo: 'Ajuste positivo', cantidad: '', observacion: '',
  });
  const [loteModo, setLoteModo] = useState('nuevo'); // solo ajuste positivo: 'existente' | 'nuevo'
  const [loteId, setLoteId] = useState('');
  const [loteNuevo, setLoteNuevo] = useState({ numero_lote: '', fecha_vencimiento: '' });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const [producto, setProducto] = useState(null);

  const base = useAsync(async () => {
    const catalogos = await api.get('/catalogos');
    return { sucursales: catalogos.sucursales, motivos: catalogos.motivos_movimiento.filter((m) => m.manual) };
  }, []);

  // Desde Stock llega ?producto_id=…: se carga ese producto para dejarlo elegido.
  useEffect(() => {
    const id = params.get('producto_id');
    if (id) api.get(`/productos/${id}`).then(setProducto).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const elegirProducto = (p) => { setProducto(p); setForm((f) => ({ ...f, producto_id: p?.id ?? '' })); };
  const positivo = form.motivo === 'Ajuste positivo';
  const usaLoteExistente = !positivo || loteModo === 'existente';

  // Lotes del producto en la sucursal: los descuentos usan lotes con stock; sumar admite también agotados, nunca vencidos.
  const lotes = useAsync(
    () => (form.producto_id && form.sucursal_id && usaLoteExistente
      ? api.get(`/inventario/lotes${qs({ producto_id: form.producto_id, sucursal_id: form.sucursal_id, con_stock: positivo ? 'false' : '', limit: 500 })}`)
      : Promise.resolve(null)),
    [form.producto_id, form.sucursal_id, usaLoteExistente, positivo]);
  const lotesElegibles = (lotes.data?.data ?? []).filter((l) => !(positivo && l.estado === 'vencido'));

  useEffect(() => { setLoteId(''); }, [form.producto_id, form.sucursal_id, form.motivo, loteModo]);

  const set = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  const guardar = async (e) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const body = {
        sucursal_id: form.sucursal_id, producto_id: form.producto_id, motivo: form.motivo,
        cantidad: Number(form.cantidad), observacion: form.observacion,
        ...(usaLoteExistente
          ? { lote_id: loteId }
          : { lote_nuevo: { numero_lote: loteNuevo.numero_lote || null, fecha_vencimiento: loteNuevo.fecha_vencimiento || null } }),
      };
      const r = await api.post('/inventario/ajustes', body);
      navigate('/inventario/kardex', {
        state: { aviso: `${form.motivo} registrado: ${form.cantidad} unidad(es) de ${producto?.nombre ?? 'producto'}${r.numero_lote ? ` (lote ${r.numero_lote})` : ''}.` },
      });
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  };

  if (base.loading) return <Spinner />;
  if (base.error) return <ErrorAlert error={base.error} />;

  return (
    <>
      <PageHeader title="Inventario" />
      <Pestanas />
      <p className="text-muted">Los ajustes quedan en el kardex con su motivo y su autor; no se pueden editar ni borrar después. Para corregir uno se registra otro en sentido contrario.</p>
      <ErrorAlert error={error} onClose={() => setError(null)} />
      <form onSubmit={guardar} className="fc-formulario" style={{ maxWidth: 760 }}>
        <div className="row">
          <div className="col-md-6">
            <Field label="Sucursal">
              <select className="form-select" required value={form.sucursal_id} onChange={set('sucursal_id')}>
                <option value="">Seleccione…</option>
                {base.data.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </Field>
          </div>
          <div className="col-md-6">
            <Field label="Producto" hint="Busque por SKU o por nombre.">
              <BuscadorProducto value={producto} onChange={elegirProducto} />
            </Field>
          </div>
          <div className="col-md-6">
            <Field label="Tipo de movimiento" hint={AYUDA[form.motivo]}>
              <select className="form-select" value={form.motivo} onChange={set('motivo')}>
                {base.data.motivos.map((m) => <option key={m.id} value={m.nombre}>{m.nombre} ({m.signo > 0 ? 'entrada' : 'salida'})</option>)}
              </select>
            </Field>
          </div>
          <div className="col-md-6">
            <Field label="Cantidad">
              <input type="number" min="1" step="1" required className="form-control" value={form.cantidad} onChange={set('cantidad')} />
            </Field>
          </div>
        </div>

        {positivo && (
          <div className="mb-3 d-flex gap-4">
            <div className="form-check">
              <input id="ln" type="radio" className="form-check-input" checked={loteModo === 'nuevo'} onChange={() => setLoteModo('nuevo')} />
              <label htmlFor="ln" className="form-check-label">Ingresar un lote nuevo</label>
            </div>
            <div className="form-check">
              <input id="le" type="radio" className="form-check-input" checked={loteModo === 'existente'} onChange={() => setLoteModo('existente')} />
              <label htmlFor="le" className="form-check-label">Sumar a un lote existente</label>
            </div>
          </div>
        )}

        {usaLoteExistente ? (
          <Field label="Lote" hint={!form.producto_id || !form.sucursal_id ? 'Elija sucursal y producto para ver sus lotes.' : lotesElegibles.length === 0 && !lotes.loading ? 'No hay lotes disponibles para este producto en la sucursal.' : undefined}>
            <select className="form-select" required value={loteId} onChange={(e) => setLoteId(e.target.value)} disabled={lotesElegibles.length === 0}>
              <option value="">Seleccione…</option>
              {lotesElegibles.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.numero_lote ?? 'sin número'} — vence {soloFecha(l.fecha_vencimiento)} — {l.cantidad_actual} un.{l.estado === 'vencido' ? ' (vencido)' : ''}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <div className="row">
            <div className="col-md-6">
              <Field label="N° de lote" hint={producto && !producto.requiere_lote ? 'Este producto no exige lote; si lo deja vacío se genera uno.' : undefined}>
                <input className="form-control" maxLength={50} required={Boolean(producto?.requiere_lote)} value={loteNuevo.numero_lote}
                  onChange={(e) => setLoteNuevo((l) => ({ ...l, numero_lote: e.target.value }))} />
              </Field>
            </div>
            <div className="col-md-6">
              <Field label="Fecha de vencimiento">
                <input type="date" className="form-control" required={Boolean(producto?.requiere_vencimiento)} value={loteNuevo.fecha_vencimiento}
                  onChange={(e) => setLoteNuevo((l) => ({ ...l, fecha_vencimiento: e.target.value }))} />
              </Field>
            </div>
          </div>
        )}

        <Field label="Motivo / observación" hint="Obligatorio. Ej.: conteo físico del 04-10, envase dañado, inventario inicial.">
          <textarea className="form-control" rows="2" required minLength={3} maxLength={300} value={form.observacion} onChange={set('observacion')} />
        </Field>

        <div className="d-flex gap-2">
          <button className="btn btn-primary" disabled={saving || !form.producto_id}>{saving ? 'Registrando…' : 'Registrar movimiento'}</button>
          <Link to="/inventario" className="btn btn-outline-secondary">Cancelar</Link>
        </div>
      </form>
    </>
  );
}
