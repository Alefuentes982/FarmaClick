import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { isoDate, money } from '../../format.js';
import BuscadorProducto from '../../components/BuscadorProducto.jsx';
import { ErrorAlert, Field, PageHeader, Spinner, useAsync } from '../../components/ui.jsx';

const lineaVacia = () => ({ producto_id: '', cantidad_solicitada: '1', costo_unitario: '' });

export default function OrdenCompraForm() {
  const { id } = useParams();
  const editando = Boolean(id);
  const navigate = useNavigate();

  const [proveedorId, setProveedorId] = useState('');
  const [sucursalId, setSucursalId] = useState('');
  const [fechaEsperada, setFechaEsperada] = useState('');
  const [items, setItems] = useState([lineaVacia()]);
  const [referenciales, setReferenciales] = useState({}); // producto_id -> costo referencial del proveedor
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const base = useAsync(async () => {
    const [catalogos, provs, prods] = await Promise.all([
      api.get('/catalogos'), api.get('/proveedores?limit=500'), api.get('/productos?activo=true&limit=500'),
    ]);
    return { sucursales: catalogos.sucursales, proveedores: provs.data, productos: prods.data };
  }, []);
  const orden = useAsync(() => (editando ? api.get(`/ordenes-compra/${id}`) : Promise.resolve(null)), [id]);

  useEffect(() => {
    const o = orden.data;
    if (!o) return;
    setProveedorId(o.proveedor_id);
    setSucursalId(o.sucursal_id);
    setFechaEsperada(isoDate(o.fecha_esperada));
    setItems(o.items.map((i) => ({
      producto_id: i.producto_id, cantidad_solicitada: String(i.cantidad_solicitada), costo_unitario: String(i.costo_unitario),
    })));
  }, [orden.data]);

  useEffect(() => {
    if (!proveedorId) { setReferenciales({}); return; }
    api.get(`/productos/proveedor/${proveedorId}`)
      .then((l) => setReferenciales(Object.fromEntries(l.map((p) => [p.producto_id, p.costo_referencial]))))
      .catch(() => setReferenciales({}));
  }, [proveedorId]);

  const setItem = (i, cambios) => setItems((l) => l.map((x, j) => (j === i ? { ...x, ...cambios } : x)));

  // Elegir un producto precarga su costo: el referencial del proveedor (★) o, si no tiene, el costo del producto.
  const elegirProducto = (i, prod) => {
    if (!prod) { setItem(i, { producto_id: '' }); return; }
    const costo = referenciales[prod.id] ?? prod.costo ?? '';
    setItem(i, { producto_id: prod.id, costo_unitario: String(costo) });
  };

  const neto = Math.round(items.reduce((s, x) => s + Number(x.cantidad_solicitada || 0) * Number(x.costo_unitario || 0), 0));
  const iva = Math.round(neto * 0.19);

  // Dos formas de guardar: como borrador (sigue editable) o emitiendo la orden (queda congelada).
  const guardar = async (e) => {
    e.preventDefault();
    const emitir = e.nativeEvent.submitter?.dataset.emitir === 'true';
    const sinProducto = items.findIndex((x) => !x.producto_id);
    if (sinProducto >= 0) { setError(new Error(`Elija el producto de la línea ${sinProducto + 1}.`)); return; }
    if (emitir && !window.confirm('Al emitir la orden ya no podrá modificarse. ¿Desea continuar?')) return;
    setError(null);
    setSaving(true);
    try {
      const body = {
        proveedor_id: proveedorId,
        sucursal_id: sucursalId,
        fecha_esperada: fechaEsperada || null,
        emitir,
        items: items.map((x) => ({
          producto_id: x.producto_id,
          cantidad_solicitada: Number(x.cantidad_solicitada),
          costo_unitario: Number(x.costo_unitario),
        })),
      };
      const guardada = editando ? await api.put(`/ordenes-compra/${id}`, body) : await api.post('/ordenes-compra', body);
      navigate(`/ordenes-compra/${guardada.id}`, {
        state: { aviso: emitir ? `Orden ${guardada.codigo} emitida.` : `Borrador ${guardada.codigo} guardado. Puede seguir editándolo o emitirlo cuando esté lista.` },
      });
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  };

  if (base.loading || orden.loading) return <Spinner />;
  if (base.error || orden.error) return <ErrorAlert error={base.error || orden.error} />;
  if (editando && orden.data.estado !== 'Borrador') {
    return (
      <>
        <div className="alert alert-warning">La orden {orden.data.codigo} está {orden.data.estado.toLowerCase()} y ya no se puede editar.</div>
        <Link to={`/ordenes-compra/${id}`} className="btn btn-outline-secondary">Volver a la orden</Link>
      </>
    );
  }

  // Productos que se pueden elegir en una línea: todos menos los que ya están en otras líneas.
  const disponibles = (actual) => base.data.productos.filter((p) => p.id === actual || !items.some((x) => x.producto_id === p.id));
  // Búsqueda local (la lista ya está cargada): por SKU o nombre, sin distinguir mayúsculas ni tildes.
  const normalizar = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const buscarEn = (actual) => (q) => {
    const t = normalizar(q.trim());
    return Promise.resolve(disponibles(actual).filter((p) => !t || normalizar(p.sku).includes(t) || normalizar(p.nombre).includes(t)));
  };
  // Producto elegido en una línea. Si ya no está activo (borrador antiguo), se muestra con los datos guardados en la orden.
  const productoDeLinea = (productoId) => {
    if (!productoId) return null;
    const p = base.data.productos.find((x) => x.id === productoId);
    if (p) return p;
    const linea = orden.data?.items.find((x) => x.producto_id === productoId);
    return linea ? { id: productoId, sku: linea.sku, nombre: `${linea.producto} (inactivo)` } : { id: productoId, sku: '', nombre: 'Producto no disponible' };
  };
  const marcaReferencial = (p) => (referenciales[p.id] != null ? <span className="text-warning ms-1" title="El proveedor tiene costo referencial">★</span> : null);

  return (
    <>
      <PageHeader title={editando ? `Editar borrador ${orden.data.codigo}` : 'Nueva orden de compra'} />
      <ErrorAlert error={error} onClose={() => setError(null)} />
      <form onSubmit={guardar} className="fc-formulario">
        <div className="row">
          <div className="col-md-4">
            <Field label="Proveedor">
              <select className="form-select" required value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
                <option value="">Seleccione…</option>
                {base.data.proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </Field>
          </div>
          <div className="col-md-4">
            <Field label="Sucursal de recepción">
              <select className="form-select" required value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}>
                <option value="">Seleccione…</option>
                {base.data.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </Field>
          </div>
          <div className="col-md-4">
            <Field label="Fecha esperada de entrega">
              <input type="date" className="form-control" value={fechaEsperada} onChange={(e) => setFechaEsperada(e.target.value)} />
            </Field>
          </div>
        </div>

        <h3 className="h5">Líneas</h3>
        <div className="table-responsive fc-tabla-buscador">
          <table className="table align-middle">
            <thead><tr><th style={{ minWidth: 280 }}>Producto</th><th style={{ width: 130 }}>Cantidad</th><th style={{ width: 160 }}>Costo unitario neto</th><th className="text-end">Subtotal</th><th /></tr></thead>
            <tbody>
              {items.map((x, i) => (
                <tr key={i}>
                  <td>
                    <BuscadorProducto
                      value={productoDeLinea(x.producto_id)}
                      onChange={(p) => elegirProducto(i, p)}
                      buscar={buscarEn(x.producto_id)}
                      listarAlEnfocar max={500} marca={marcaReferencial} required
                      placeholder="Escriba el SKU o el nombre, o despliegue la lista…" />
                  </td>
                  <td><input type="number" min="1" step="1" required className="form-control" value={x.cantidad_solicitada} onChange={(e) => setItem(i, { cantidad_solicitada: e.target.value })} /></td>
                  <td><input type="number" min="0" step="1" required className="form-control" value={x.costo_unitario} onChange={(e) => setItem(i, { costo_unitario: e.target.value })} /></td>
                  <td className="text-end">{money(Number(x.cantidad_solicitada || 0) * Number(x.costo_unitario || 0))}</td>
                  <td className="text-end">
                    <button type="button" className="btn btn-outline-danger btn-sm" disabled={items.length === 1}
                      onClick={() => setItems((l) => l.filter((_, j) => j !== i))}><i className="bi bi-trash" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="btn btn-outline-secondary btn-sm mb-2" onClick={() => setItems((l) => [...l, lineaVacia()])}>
          <i className="bi bi-plus" /> Agregar línea
        </button>
        <div className="form-text mb-3">Escriba el SKU o parte del nombre para filtrar la lista (↑ ↓ y Enter para elegir). ★ = el proveedor tiene costo referencial para ese producto (se precarga al elegirlo).</div>

        <div className="text-end mb-4">
          <div>Neto: <strong>{money(neto)}</strong></div>
          <div>IVA 19 %: <strong>{money(iva)}</strong></div>
          <div className="fs-5">Total: <strong>{money(neto + iva)}</strong></div>
          <div className="form-text">Estimado; los montos definitivos los calcula la base de datos.</div>
        </div>

        <div className="d-flex flex-wrap gap-2 align-items-center">
          <button className="btn btn-outline-primary" data-emitir="false" disabled={saving}>
            <i className="bi bi-save me-1" />{saving ? 'Guardando…' : 'Guardar borrador'}
          </button>
          <button className="btn btn-primary" data-emitir="true" disabled={saving}>
            <i className="bi bi-send me-1" />Guardar y emitir
          </button>
          <Link to={editando ? `/ordenes-compra/${id}` : '/ordenes-compra'} className="btn btn-outline-secondary">Cancelar</Link>
          <span className="text-muted small">El borrador se puede seguir editando; una orden emitida queda fija.</span>
        </div>
      </form>
    </>
  );
}
