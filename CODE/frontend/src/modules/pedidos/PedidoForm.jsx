import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, qs } from '../../api.js';
import { money } from '../../format.js';
import { ErrorAlert, Field, PageHeader, Spinner, useAsync } from '../../components/ui.jsx';

export default function PedidoForm() {
  const { id } = useParams();
  const editando = Boolean(id);
  const navigate = useNavigate();

  const [cliente, setCliente] = useState({ nombre_cliente: '', telefono: '', direccion_pedido: '', comuna_id: '' });
  const [sucursalId, setSucursalId] = useState('');
  const [lineas, setLineas] = useState([]); // { producto_id, sku, nombre, precio, cantidad, disponible }
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const base = useAsync(() => api.get('/catalogos'), []);
  const pedido = useAsync(() => (editando ? api.get(`/pedidos/${id}`) : Promise.resolve(null)), [id]);

  useEffect(() => {
    const p = pedido.data;
    if (!p) return;
    setCliente({ nombre_cliente: p.nombre_cliente, telefono: p.telefono ?? '', direccion_pedido: p.direccion_pedido ?? '', comuna_id: p.comuna_id ?? '' });
    setSucursalId(p.sucursal_id);
    setLineas(p.lineas.map((l) => ({
      producto_id: l.producto_id, sku: l.sku, nombre: l.nombre_producto, precio: Number(l.precio_unitario), cantidad: String(l.cantidad), disponible: null,
    })));
  }, [pedido.data]);

  // Buscador de productos vendibles por canal a distancia, con su stock en la sucursal elegida.
  useEffect(() => {
    if (!sucursalId || busqueda.trim().length < 2) { setResultados([]); return undefined; }
    let vigente = true;
    const t = setTimeout(() => {
      api.get(`/pedidos/catalogo${qs({ sucursal_id: sucursalId, q: busqueda, limit: 8 })}`)
        .then((r) => vigente && setResultados(r))
        .catch(() => vigente && setResultados([]));
    }, 250);
    return () => { vigente = false; clearTimeout(t); };
  }, [busqueda, sucursalId]);

  const setC = (campo) => (e) => setCliente((c) => ({ ...c, [campo]: e.target.value }));

  const agregar = (p) => {
    setLineas((l) => (l.some((x) => x.producto_id === p.id)
      ? l.map((x) => (x.producto_id === p.id ? { ...x, cantidad: String(Number(x.cantidad) + 1), disponible: p.disponible } : x))
      : [...l, { producto_id: p.id, sku: p.sku, nombre: p.nombre, precio: Number(p.precio), cantidad: '1', disponible: p.disponible }]));
    setBusqueda('');
    setResultados([]);
  };

  const total = lineas.reduce((s, l) => s + Number(l.cantidad || 0) * l.precio, 0);

  const guardar = async (e) => {
    e.preventDefault();
    const reservar = e.nativeEvent.submitter?.dataset.reservar === 'true';
    if (lineas.length === 0) { setError(new Error('Agregue al menos un producto al pedido.')); return; }
    setError(null);
    setSaving(true);
    try {
      const body = {
        sucursal_id: sucursalId,
        nombre_cliente: cliente.nombre_cliente,
        telefono: cliente.telefono || null,
        direccion_pedido: cliente.direccion_pedido || null,
        comuna_id: cliente.comuna_id || null,
        items: lineas.map((l) => ({ producto_id: l.producto_id, cantidad: Number(l.cantidad) })),
        reservar,
      };
      const guardado = editando ? await api.put(`/pedidos/${id}`, body) : await api.post('/pedidos', body);
      navigate(`/pedidos/${guardado.id}`, {
        state: { aviso: `Pedido ${guardado.codigo} guardado${guardado.stock_reservado ? ' con el stock reservado' : ''}.` },
      });
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  };

  if (base.loading || pedido.loading) return <Spinner />;
  if (base.error || pedido.error) return <ErrorAlert error={base.error || pedido.error} />;
  if (editando && pedido.data.estado !== 'Pago pendiente') {
    return (
      <>
        <div className="alert alert-warning">El pedido {pedido.data.codigo} está "{pedido.data.estado}" y ya no se puede editar.</div>
        <Link to={`/pedidos/${id}`} className="btn btn-outline-secondary">Volver al pedido</Link>
      </>
    );
  }

  return (
    <>
      <PageHeader title={editando ? `Editar pedido ${pedido.data.codigo}` : 'Nuevo pedido'} />
      <p className="text-muted">
        Pedido a distancia (canal Online). Queda en "Pago pendiente"; si no se paga en 20 minutos expira y devuelve el stock reservado.
      </p>
      <ErrorAlert error={error} onClose={() => setError(null)} />
      <form onSubmit={guardar} className="fc-formulario">
        <div className="row">
          <div className="col-md-4">
            <Field label="Cliente">
              <input className="form-control" required maxLength={150} value={cliente.nombre_cliente} onChange={setC('nombre_cliente')} />
            </Field>
          </div>
          <div className="col-md-4"><Field label="Teléfono"><input className="form-control" maxLength={30} value={cliente.telefono} onChange={setC('telefono')} /></Field></div>
          <div className="col-md-4">
            <Field label="Sucursal de despacho" hint={editando ? 'No se puede cambiar.' : undefined}>
              <select className="form-select" required disabled={editando} value={sucursalId}
                onChange={(e) => { setSucursalId(e.target.value); setLineas([]); }}>
                <option value="">Seleccione…</option>
                {base.data.sucursales_venta_web.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </Field>
          </div>
          <div className="col-md-8"><Field label="Dirección de entrega"><input className="form-control" maxLength={200} value={cliente.direccion_pedido} onChange={setC('direccion_pedido')} /></Field></div>
          <div className="col-md-4">
            <Field label="Comuna">
              <select className="form-select" value={cliente.comuna_id} onChange={setC('comuna_id')}>
                <option value="">—</option>
                {base.data.comunas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </Field>
          </div>
        </div>

        <h3 className="h5">Productos</h3>
        <div className="position-relative mb-3" style={{ maxWidth: 560 }}>
          <input className="form-control" disabled={!sucursalId} placeholder={sucursalId ? 'Buscar por SKU o nombre (mín. 2 letras)' : 'Elija primero la sucursal'}
            value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          {resultados.length > 0 && (
            <div className="list-group position-absolute w-100 shadow-sm" style={{ zIndex: 5 }}>
              {resultados.map((p) => (
                <button type="button" key={p.id} className="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
                  disabled={p.disponible <= 0} onClick={() => agregar(p)}>
                  <span><span className="text-muted me-2">{p.sku}</span>{p.nombre}</span>
                  <span>
                    {money(p.precio)}
                    <span className={`badge ms-2 text-bg-${p.disponible > 0 ? 'success' : 'secondary'}`}>{p.disponible > 0 ? `${p.disponible} disp.` : 'Sin stock'}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="table-responsive">
          <table className="table align-middle">
            <thead><tr><th>Producto</th><th className="text-end">Precio</th><th style={{ width: 120 }}>Cantidad</th><th className="text-end">Subtotal</th><th /></tr></thead>
            <tbody>
              {lineas.length === 0 && <tr><td colSpan="5" className="text-center text-muted py-3">Busque y agregue productos.</td></tr>}
              {lineas.map((l) => (
                <tr key={l.producto_id}>
                  <td><span className="text-muted me-1">{l.sku}</span>{l.nombre}
                    {l.disponible != null && Number(l.cantidad) > l.disponible && <div className="small text-danger">Solo hay {l.disponible} disponibles.</div>}
                  </td>
                  <td className="text-end">{money(l.precio)}</td>
                  <td><input type="number" min="1" step="1" required className="form-control form-control-sm" value={l.cantidad}
                    onChange={(e) => setLineas((ls) => ls.map((x) => (x.producto_id === l.producto_id ? { ...x, cantidad: e.target.value } : x)))} /></td>
                  <td className="text-end">{money(Number(l.cantidad || 0) * l.precio)}</td>
                  <td className="text-end"><button type="button" className="btn btn-outline-danger btn-sm" onClick={() => setLineas((ls) => ls.filter((x) => x.producto_id !== l.producto_id))}><i className="bi bi-trash" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-end mb-4">
          <div className="fs-5">Total estimado: <strong>{money(total)}</strong></div>
          <div className="form-text">Precios con IVA. Los descuentos por cantidad y los totales definitivos los calcula la base de datos al guardar.</div>
        </div>

        <div className="d-flex flex-wrap gap-2 align-items-center">
          <button className="btn btn-outline-primary" data-reservar="false" disabled={saving}><i className="bi bi-save me-1" />{saving ? 'Guardando…' : 'Guardar'}</button>
          <button className="btn btn-primary" data-reservar="true" disabled={saving}><i className="bi bi-box-seam me-1" />Guardar y reservar stock</button>
          <Link to={editando ? `/pedidos/${id}` : '/pedidos'} className="btn btn-outline-secondary">Cancelar</Link>
        </div>
      </form>
    </>
  );
}
