import { useEffect, useRef, useState } from 'react';
import { api, qs } from '../../api.js';
import BotonesDocumento from '../../components/BotonesDocumento.jsx';
import { fechaHora, money } from '../../format.js';
import { textoAjuste } from '../../redondeo.js';
import PanelPago from '../../components/PanelPago.jsx';
import EnviarCorreo from '../../components/EnviarCorreo.jsx';
import { ErrorAlert } from '../../components/ui.jsx';

// Pantalla de venta: buscador por SKU o nombre (admite lector de código: escribe el SKU y Enter), carrito con
// descuentos calculados por la base y cobro dividido. Al confirmar se crea el pedido, se reserva el stock, se paga
// y se entrega en una sola operación.
export default function VentaMostrador({ turno, medios, onVenta }) {
  const buscador = useRef(null);
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState([]);
  const [carrito, setCarrito] = useState([]); // { producto_id, sku, nombre, precio, cantidad, disponible }
  const [cotizacion, setCotizacion] = useState(null);
  const [cliente, setCliente] = useState('');
  const [cobrando, setCobrando] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [hecha, setHecha] = useState(null); // { pedido, vuelto }

  useEffect(() => { buscador.current?.focus(); }, [hecha, cobrando]);

  useEffect(() => {
    if (busqueda.trim().length < 1) { setResultados([]); return undefined; }
    let vigente = true;
    const t = setTimeout(() => {
      api.get(`/pos/productos${qs({ q: busqueda.trim(), limit: 8 })}`)
        .then((r) => vigente && setResultados(r))
        .catch((e) => vigente && (setResultados([]), setError(e)));
    }, 200);
    return () => { vigente = false; clearTimeout(t); };
  }, [busqueda]);

  // Totales y descuentos oficiales: los calcula el backend con la misma regla que luego usa la base.
  useEffect(() => {
    if (carrito.length === 0) { setCotizacion(null); return undefined; }
    let vigente = true;
    const t = setTimeout(() => {
      api.post('/pos/cotizar', { items: carrito.map((l) => ({ producto_id: l.producto_id, cantidad: Number(l.cantidad) || 1 })) })
        .then((c) => vigente && setCotizacion(c))
        .catch((e) => vigente && setError(e));
    }, 200);
    return () => { vigente = false; clearTimeout(t); };
  }, [carrito]);

  const agregar = (p) => {
    if (p.disponible <= 0) return;
    if (!p.permite_venta_online && !window.confirm(`«${p.nombre}» es de venta con receta (${p.condicion_venta}). ¿Confirma que se verificó la receta?`)) return;
    setCarrito((c) => (c.some((l) => l.producto_id === p.id)
      ? c.map((l) => (l.producto_id === p.id ? { ...l, cantidad: Number(l.cantidad) + 1, disponible: p.disponible } : l))
      : [...c, { producto_id: p.id, sku: p.sku, nombre: p.nombre, precio: Number(p.precio), cantidad: 1, disponible: p.disponible }]));
    setBusqueda('');
    setResultados([]);
    setHecha(null);
  };

  // Enter: agrega el producto cuyo SKU coincide exactamente, o el único resultado.
  // Un lector de código escribe el SKU y envía Enter en milisegundos, antes de que termine la búsqueda con retardo:
  // por eso Enter consulta en el momento en vez de usar los resultados que haya en pantalla.
  const alEnter = async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = busqueda.trim();
    if (!q) return;
    try {
      const lista = await api.get(`/pos/productos${qs({ q, limit: 8 })}`);
      const exacto = lista.find((p) => p.sku.toLowerCase() === q.toLowerCase());
      const elegido = exacto ?? (lista.length === 1 ? lista[0] : null);
      if (elegido) agregar(elegido);
      else setResultados(lista);
    } catch (err) {
      setError(err);
    }
  };

  const cambiarCantidad = (id, delta) => setCarrito((c) => c.flatMap((l) => {
    if (l.producto_id !== id) return [l];
    const n = Number(l.cantidad) + delta;
    return n < 1 ? [] : [{ ...l, cantidad: n }];
  }));

  const nuevaVenta = () => { setHecha(null); setCarrito([]); setCliente(''); setCobrando(false); setError(null); setBusqueda(''); };

  const cobrar = async (pagos, { vuelto }) => {
    setError(null);
    setBusy(true);
    try {
      const pedido = await api.post('/pos/ventas', {
        items: carrito.map((l) => ({ producto_id: l.producto_id, cantidad: Number(l.cantidad) })),
        nombre_cliente: cliente || null,
        pagos,
      });
      setHecha({ pedido, vuelto });
      setCarrito([]);
      setCobrando(false);
      onVenta();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (hecha) {
    const p = hecha.pedido;
    return (
      <div className="card border-success text-center mb-4">
        <div className="card-body py-5">
          <i className="bi bi-check-circle text-success display-4" />
          <h2 className="h3 mt-2">Venta {p.codigo} registrada</h2>
          <div className="fs-2 fw-bold">{money(p.total)}</div>
          {Number(p.redondeo) !== 0 && (
            <div className="text-muted">Redondeo del efectivo (Ley 20.956): {textoAjuste(Number(p.redondeo), money)} · Total cobrado <strong>{money(Number(p.total) + Number(p.redondeo))}</strong></div>
          )}
          {hecha.vuelto != null && hecha.vuelto > 0 && <div className="fs-3 text-primary">Vuelto: {money(hecha.vuelto)}</div>}
          <div className="text-muted mb-4">{p.pagos.map((x) => `${x.medio_pago} ${money(x.monto)}`).join(' · ')}</div>
          <div className="d-flex flex-wrap gap-2 justify-content-center">
            <BotonesDocumento path={`/pos/ventas/${p.id}/pdf`} nombre={`${p.codigo}.pdf`} onError={setError} etiquetaVer="Ver comprobante" />
            <button className="btn btn-primary" autoFocus onClick={nuevaVenta}>Nueva venta</button>
          </div>
          <div className="mt-4 mx-auto text-start" style={{ maxWidth: 560 }}>
            <div className="small text-muted mb-1">Enviar el comprobante por correo (opcional)</div>
            <EnviarCorreo ruta={`/pos/ventas/${p.id}/enviar`} />
          </div>
          <ErrorAlert error={error} />
        </div>
      </div>
    );
  }

  const total = cotizacion?.total ?? carrito.reduce((s, l) => s + Number(l.cantidad) * l.precio, 0);
  const lineaCot = (id) => cotizacion?.lineas.find((l) => l.producto_id === id);

  return (
    <div className="row g-4">
      <div className="col-lg-6">
        <div className="position-relative mb-3">
          <input ref={buscador} className="form-control form-control-lg" placeholder="Escanee o escriba SKU / nombre y presione Enter"
            value={busqueda} onChange={(e) => setBusqueda(e.target.value)} onKeyDown={alEnter} disabled={cobrando} />
        </div>
        <div className="list-group">
          {busqueda.trim() && resultados.length === 0 && <div className="list-group-item text-muted">Sin resultados para «{busqueda}».</div>}
          {resultados.map((p) => (
            <button type="button" key={p.id} className="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
              disabled={p.disponible <= 0 || cobrando} onClick={() => agregar(p)}>
              <span>
                <span className="text-muted me-2">{p.sku}</span>{p.nombre}
                {!p.permite_venta_online && <span className="badge text-bg-warning ms-2">Receta</span>}
              </span>
              <span className="text-nowrap">
                {money(p.precio)}
                <span className={`badge ms-2 text-bg-${p.disponible > 0 ? 'success' : 'secondary'}`}>{p.disponible > 0 ? `${p.disponible} disp.` : 'Sin stock'}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="col-lg-6">
        <div className="card">
          <div className="card-body">
            <h3 className="h5">Venta actual</h3>
            {carrito.length === 0 ? <p className="text-muted mb-0">Agregue productos para comenzar.</p> : (
              <table className="table table-sm align-middle">
                <thead><tr><th>Producto</th><th style={{ width: 120 }} className="text-center">Cant.</th><th className="text-end">Subtotal</th></tr></thead>
                <tbody>
                  {carrito.map((l) => {
                    const c = lineaCot(l.producto_id);
                    return (
                      <tr key={l.producto_id}>
                        <td>
                          <div>{l.nombre}</div>
                          <div className="small text-muted">{l.sku} · {money(l.precio)} c/u{c?.regla && <span className="badge text-bg-success ms-2">{c.regla}</span>}</div>
                          {Number(l.cantidad) > l.disponible && <div className="small text-danger">Solo hay {l.disponible} disponibles.</div>}
                        </td>
                        <td className="text-center text-nowrap">
                          <button className="btn btn-outline-secondary btn-sm" disabled={cobrando} onClick={() => cambiarCantidad(l.producto_id, -1)}>−</button>
                          <span className="mx-2">{l.cantidad}</span>
                          <button className="btn btn-outline-secondary btn-sm" disabled={cobrando} onClick={() => cambiarCantidad(l.producto_id, 1)}>+</button>
                        </td>
                        <td className="text-end">
                          {c?.descuento > 0 && <div className="small text-success">-{money(c.descuento)}</div>}
                          {money(c ? c.subtotal : Number(l.cantidad) * l.precio)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {cotizacion?.descuento_total > 0 && <div className="text-end text-success">Descuentos: -{money(cotizacion.descuento_total)}</div>}
            <div className="d-flex justify-content-between align-items-center fs-3 fw-bold my-2"><span>Total</span><span>{money(total)}</span></div>
            <input className="form-control mb-3" placeholder="Cliente (opcional)" maxLength={150} value={cliente} onChange={(e) => setCliente(e.target.value)} disabled={cobrando} />
            <div className="d-flex gap-2">
              <button className="btn btn-success btn-lg flex-grow-1" disabled={!cotizacion || cobrando || medios.length === 0} onClick={() => setCobrando(true)}>
                <i className="bi bi-cash-coin me-2" />Cobrar
              </button>
              <button className="btn btn-outline-secondary" disabled={carrito.length === 0 || cobrando} onClick={nuevaVenta}>Vaciar</button>
            </div>
          </div>
        </div>
        <ErrorAlert error={error} onClose={() => setError(null)} />
      </div>

      {cobrando && cotizacion && (
        <div className="col-12">
          <PanelPago total={cotizacion.total} medios={medios} busy={busy} onConfirmar={cobrar} onCancelar={() => setCobrando(false)}
            ayuda={`Turno de ${turno.sucursal} · Caja ${turno.caja_numero}. Si falta stock o el pago no calza, no se registra nada.`} />
        </div>
      )}
    </div>
  );
}
