import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs } from '../../api.js';
import { fechaHora, hoyIso, money } from '../../format.js';
import { redondearEfectivo, textoAjuste } from '../../redondeo.js';
import { ErrorAlert, Field, Filtros, PageHeader, Seccion, Spinner, useAsync } from '../../components/ui.jsx';

export default function NuevaDevolucion() {
  const navigate = useNavigate();
  const [params] = useSearchParams(); // ?pedido=ID llega desde la ficha del pedido
  const [borrador, setBorrador] = useState(FILTROS_VACIOS); // lo que se está escribiendo
  const [filtros, setFiltros] = useState(FILTROS_VACIOS); // lo que se buscó
  const [pedidoId, setPedidoId] = useState(params.get('pedido') ?? '');
  const [cant, setCant] = useState({}); // detalle_id -> { cantidad, reingresa }
  const [cot, setCot] = useState(null);
  const [reembolsos, setReembolsos] = useState({}); // medio_pago_id -> texto
  const [motivoTipo, setMotivoTipo] = useState('');
  const [motivoDetalle, setMotivoDetalle] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const catalogos = useAsync(() => api.get('/catalogos'), []);
  const pedido = useAsync(() => (pedidoId ? api.get(`/devoluciones/pedido/${pedidoId}`) : Promise.resolve(null)), [pedidoId]);
  const p = pedido.data;

  // Pedidos que todavía se pueden devolver. Sin filtros, los más recientes dentro del plazo.
  const devolvibles = useAsync(
    () => (pedidoId ? Promise.resolve(null) : api.get(`/devoluciones/pedidos-devolvibles${qs(filtros)}`)),
    [pedidoId, JSON.stringify(filtros)]);

  const items = Object.entries(cant)
    .filter(([, v]) => Number(v.cantidad) > 0)
    .map(([detalle_id, v]) => ({ detalle_id, cantidad: Number(v.cantidad), reingresa_stock: Boolean(v.reingresa) }));
  const clave = JSON.stringify(items);

  // El backend calcula el reembolso (descuento prorrateado y redondeo acumulado) y sugiere el reparto por medio.
  useEffect(() => {
    if (!p || items.length === 0) { setCot(null); setReembolsos({}); return undefined; }
    let vigente = true;
    const t = setTimeout(() => {
      api.post('/devoluciones/cotizar', { pedido_id: p.id, items })
        .then((c) => {
          if (!vigente) return;
          setCot(c);
          setReembolsos(Object.fromEntries(c.sugerencia.map((s) => [s.medio_pago_id, String(s.monto)])));
        })
        .catch((e) => vigente && (setCot(null), setError(e)));
    }, 250);
    return () => { vigente = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, p?.id]);

  const total = cot?.total ?? 0;
  // El efectivo se devuelve redondeado al múltiplo de $10 (Ley 20.956), sin pasar de lo disponible en efectivo; lo que no
  // se devuelve por otros medios es el valor a devolver en efectivo. El backend valida con la misma regla.
  const medioEfectivo = p?.medios.find((m) => m.medio_pago === 'Efectivo');
  const efectivoIngresado = Number(reembolsos[medioEfectivo?.medio_pago_id] || 0);
  const otrosMedios = (p?.medios ?? []).filter((m) => m !== medioEfectivo).reduce((s, m) => s + Number(reembolsos[m.medio_pago_id] || 0), 0);
  const hayEfectivo = efectivoIngresado > 0;
  const valorEfectivo = Math.round((total - otrosMedios) * 100) / 100;
  const efectivoEsperado = hayEfectivo ? Math.min(redondearEfectivo(valorEfectivo), medioEfectivo.disponible) : null;
  const redondeo = hayEfectivo && efectivoEsperado > 0 ? Math.round((efectivoEsperado - valorEfectivo) * 100) / 100 : 0;
  const diferencia = hayEfectivo ? 0 : Math.round((total - otrosMedios) * 100) / 100; // sin efectivo, debe calzar exacto
  const efectivoOk = !hayEfectivo || (valorEfectivo > 0 && efectivoEsperado > 0 && efectivoIngresado === efectivoEsperado);
  const calza = diferencia === 0 && efectivoOk;
  const dineroDevuelto = total + redondeo;
  const motivo = [motivoTipo, motivoDetalle.trim()].filter(Boolean).join(' — ');

  const confirmar = async () => {
    setError(null);
    setBusy(true);
    try {
      const d = await api.post('/devoluciones', {
        pedido_id: p.id,
        items,
        motivo,
        reembolsos: Object.entries(reembolsos).filter(([, v]) => Number(v) > 0).map(([medio_pago_id, v]) => ({ medio_pago_id, monto: Number(v) })),
      });
      navigate(`/devoluciones/${d.id}`, { state: { aviso: `Devolución ${d.codigo} registrada: ${money(Number(d.total_reembolso) + Number(d.redondeo))} devueltos.` } });
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  const elegirPedido = (id) => { setPedidoId(id); setCant({}); setCot(null); setError(null); };

  return (
    <>
      <PageHeader title="Nueva devolución">
        <Link to="/devoluciones" className="btn btn-outline-secondary">Volver</Link>
      </PageHeader>
      <ErrorAlert error={error} onClose={() => setError(null)} />

      {!pedidoId && (
        <BuscarPedido borrador={borrador} setBorrador={setBorrador} filtros={filtros} setFiltros={setFiltros}
          catalogos={catalogos.data} resultado={devolvibles} onElegir={elegirPedido} />
      )}

      {pedidoId && pedido.loading && <Spinner />}
      {pedido.error && <ErrorAlert error={pedido.error} />}

      {p && (
        <>
          <div className="d-flex justify-content-between align-items-center mb-3 p-3 bg-light border rounded">
            <div><strong className="font-monospace">{p.codigo}</strong> · {p.nombre_cliente} · {p.sucursal} · {fechaHora(p.fecha)} · total {money(p.total)}</div>
            <button className="btn btn-outline-secondary btn-sm" onClick={() => { setPedidoId(''); setCant({}); setCot(null); }}>Cambiar pedido</button>
          </div>

          {!p.devolvible ? <div className="alert alert-warning">{p.motivo_no_devolvible}</div> : (
            <>
              <div className="table-responsive">
                <table className="table align-middle">
                  <thead>
                    <tr><th>Producto</th><th className="text-end">Vendido</th><th className="text-end">Ya devuelto</th><th style={{ width: 130 }}>A devolver</th><th>Reingresar a inventario</th><th className="text-end">Reembolso</th></tr>
                  </thead>
                  <tbody>
                    {p.lineas.map((l) => {
                      const c = cant[l.detalle_id] ?? { cantidad: '', reingresa: false };
                      const linea = cot?.lineas.find((x) => x.detalle_id === l.detalle_id);
                      return (
                        <tr key={l.detalle_id} className={l.disponible === 0 ? 'text-muted' : ''}>
                          <td><span className="text-muted me-1">{l.sku}</span>{l.nombre_producto}</td>
                          <td className="text-end">{l.cantidad}</td>
                          <td className="text-end">{l.devuelto || '—'}</td>
                          <td>
                            <input type="number" min="0" max={l.disponible} step="1" className="form-control form-control-sm" disabled={l.disponible === 0}
                              placeholder={l.disponible === 0 ? 'Sin saldo' : `hasta ${l.disponible}`} value={c.cantidad}
                              onChange={(e) => setCant((m) => ({ ...m, [l.detalle_id]: { ...c, cantidad: e.target.value } }))} />
                          </td>
                          <td>
                            <div className="form-check">
                              <input id={`r${l.detalle_id}`} type="checkbox" className="form-check-input" disabled={l.disponible === 0} checked={c.reingresa}
                                onChange={(e) => setCant((m) => ({ ...m, [l.detalle_id]: { ...c, reingresa: e.target.checked } }))} />
                              <label htmlFor={`r${l.detalle_id}`} className="form-check-label small">Sí, está en buen estado</label>
                            </div>
                          </td>
                          <td className="text-end">{linea ? money(linea.monto_reembolso) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="form-text mb-3">
                Los medicamentos devueltos normalmente no vuelven a la estantería: marque "reingresar" solo si el producto está sellado y en perfecto estado
                (p. ej. error de despacho). El reembolso considera el descuento que tuvo la compra.
              </div>

              {cot && (
                <div className="row g-4">
                  <div className="col-md-6">
                    <h3 className="h5">Motivo</h3>
                    <Field label="Tipo">
                      <select className="form-select" value={motivoTipo} onChange={(e) => setMotivoTipo(e.target.value)}>
                        <option value="">Seleccione…</option>
                        {catalogos.data?.motivos_devolucion.map((m) => <option key={m.nombre}>{m.nombre}</option>)}
                      </select>
                    </Field>
                    <Field label="Detalle (opcional)">
                      <input className="form-control" maxLength={200} value={motivoDetalle} onChange={(e) => setMotivoDetalle(e.target.value)} />
                    </Field>
                  </div>
                  <div className="col-md-6">
                    <h3 className="h5">Devolución del dinero · {money(total)}</h3>
                    <p className="small text-muted">Se devuelve por los mismos medios con que se pagó, sin pasar de lo pagado con cada uno.</p>
                    {p.medios.map((m) => (
                      <div className="row g-2 align-items-center mb-2" key={m.medio_pago_id}>
                        <div className="col-4">{m.medio_pago}<div className="small text-muted">disponible {money(m.disponible)}</div></div>
                        <div className="col-8">
                          <input type="number" min="0" step="1" max={m.disponible} className="form-control" disabled={m.disponible <= 0}
                            value={reembolsos[m.medio_pago_id] ?? ''} onChange={(e) => setReembolsos((r) => ({ ...r, [m.medio_pago_id]: e.target.value }))} />
                        </div>
                      </div>
                    ))}
                    <div className={calza ? 'text-success' : 'text-danger'}>
                      {calza ? 'Calza con el total'
                        : hayEfectivo ? (efectivoEsperado > 0 ? `El efectivo a devolver es ${money(efectivoEsperado)}` : 'Ese saldo se redondea a $0 en efectivo: devuélvalo por otro medio.')
                          : diferencia > 0 ? `Faltan ${money(diferencia)}` : `Sobran ${money(-diferencia)}`}
                    </div>
                    {hayEfectivo && redondeo !== 0 && efectivoOk && (
                      <div className="form-text">Efectivo redondeado según la Ley 20.956 ({textoAjuste(redondeo, money)}): se entregan {money(dineroDevuelto)} en total.</div>
                    )}
                    {hayEfectivo && <div className="form-text">La parte en efectivo sale de la caja de su turno abierto y se descuenta en el cierre.</div>}
                  </div>
                </div>
              )}

              <div className="d-flex gap-2 mt-4">
                <button className="btn btn-primary" disabled={busy || !cot || !calza || motivo.length < 3}
                  onClick={() => window.confirm(`¿Registrar la devolución por ${money(dineroDevuelto)}? No se puede deshacer.`) && confirmar()}>
                  {busy ? 'Registrando…' : 'Registrar devolución'}
                </button>
                {cot && motivo.length < 3 && <span className="align-self-center text-muted small">Elija el motivo para continuar.</span>}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

const FILTROS_VACIOS = {
  q: '', producto: '', medio_pago_id: '', desde: '', hasta: '', monto_desde: '', monto_hasta: '', sucursal_id: '',
};

// Búsqueda del pedido a devolver: filtros (número o cliente, producto comprado, medio de pago, fechas, monto, sucursal)
// y la lista de pedidos que se pueden devolver. Los filtros se aplican con "Buscar" (o Enter); los atajos de fecha y
// "Limpiar", de inmediato.
function BuscarPedido({ borrador, setBorrador, filtros, setFiltros, catalogos, resultado, onElegir }) {
  const set = (campo) => (e) => setBorrador((b) => ({ ...b, [campo]: e.target.value }));
  const fechaInvalida = Boolean(borrador.desde && borrador.hasta && borrador.desde > borrador.hasta);
  const montoInvalido = Boolean(borrador.monto_desde && borrador.monto_hasta && Number(borrador.monto_desde) > Number(borrador.monto_hasta));
  const invalido = fechaInvalida || montoInvalido;
  const pendiente = JSON.stringify(borrador) !== JSON.stringify(filtros);
  const hayFiltros = Object.values(filtros).some(Boolean) || Object.values(borrador).some(Boolean);
  const aplicar = (f) => { setBorrador(f); setFiltros(f); };
  const buscar = (e) => { e?.preventDefault(); if (!invalido) setFiltros(borrador); };
  const atajo = (dias) => aplicar({ ...borrador, desde: hoyIso(-dias), hasta: hoyIso() });
  const lista = resultado.data?.data ?? [];
  const plazo = resultado.data?.plazo_dias;

  return (
    <>
      <p className="text-muted">
        Elija el pedido a devolver. Aquí aparecen los pedidos entregados dentro del plazo de devolución; use los filtros
        si no recuerda el número.
      </p>
      <Filtros titulo="Buscar el pedido">
        <form onSubmit={buscar}>
          <div className="row g-2">
            <div className="col-md-4">
              <Field label="N° de pedido o cliente">
                <input className="form-control" autoFocus placeholder="PED-000123 o nombre" value={borrador.q} onChange={set('q')} />
              </Field>
            </div>
            <div className="col-md-4">
              <Field label="Producto (SKU o nombre)">
                <input className="form-control" placeholder="Qué compró: paracetamol, MED-001…" value={borrador.producto} onChange={set('producto')} />
              </Field>
            </div>
            <div className="col-md-4">
              <Field label="Medio de pago">
                <select className="form-select" value={borrador.medio_pago_id} onChange={set('medio_pago_id')}>
                  <option value="">Cualquiera</option>
                  {catalogos?.medios_pago?.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                </select>
              </Field>
            </div>
            <div className="col-6 col-md-3">
              <Field label="Comprado desde">
                <input type="date" className={`form-control ${fechaInvalida ? 'is-invalid' : ''}`} value={borrador.desde}
                  max={borrador.hasta || undefined} onChange={set('desde')} />
              </Field>
            </div>
            <div className="col-6 col-md-3">
              <Field label="Hasta">
                <input type="date" className={`form-control ${fechaInvalida ? 'is-invalid' : ''}`} value={borrador.hasta}
                  min={borrador.desde || undefined} onChange={set('hasta')} />
              </Field>
            </div>
            <div className="col-6 col-md-2">
              <Field label="Monto desde">
                <div className="input-group">
                  <span className="input-group-text">$</span>
                  <input type="number" min="0" step="1" className={`form-control ${montoInvalido ? 'is-invalid' : ''}`}
                    value={borrador.monto_desde} onChange={set('monto_desde')} />
                </div>
              </Field>
            </div>
            <div className="col-6 col-md-2">
              <Field label="Monto hasta">
                <div className="input-group">
                  <span className="input-group-text">$</span>
                  <input type="number" min="0" step="1" className={`form-control ${montoInvalido ? 'is-invalid' : ''}`}
                    value={borrador.monto_hasta} onChange={set('monto_hasta')} />
                </div>
              </Field>
            </div>
            <div className="col-md-2">
              <Field label="Sucursal">
                <select className="form-select" value={borrador.sucursal_id} onChange={set('sucursal_id')}>
                  <option value="">Todas</option>
                  {catalogos?.sucursales?.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </Field>
            </div>
          </div>
          <div className="d-flex flex-wrap align-items-center gap-2 mt-2">
            <button className={`btn ${pendiente ? 'btn-primary' : 'btn-outline-primary'}`} disabled={invalido}>
              <i className="bi bi-search me-1" />Buscar
            </button>
            <button type="button" className="btn btn-outline-secondary" disabled={!hayFiltros} onClick={() => aplicar(FILTROS_VACIOS)}>Limpiar</button>
            <span className="vr d-none d-md-inline mx-1" />
            <span className="small text-muted">Compras de:</span>
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => atajo(0)}>Hoy</button>
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => atajo(6)}>Últimos 7 días</button>
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => atajo(29)}>Últimos 30 días</button>
            {fechaInvalida && <span className="text-danger small">"Desde" no puede ser posterior a "Hasta".</span>}
            {montoInvalido && <span className="text-danger small">"Monto desde" no puede ser mayor que "Monto hasta".</span>}
          </div>
        </form>
      </Filtros>

      <ErrorAlert error={resultado.error} />
      <Seccion titulo="Pedidos recientes que se pueden devolver" icono="bi-bag-check" plano>
        {resultado.loading && !resultado.data ? <Spinner /> : (
          <div className="table-responsive">
            <table className="table table-hover align-middle">
              <thead>
                <tr><th>N°</th><th>Fecha</th><th>Cliente</th><th>Productos</th><th>Medio</th><th className="text-end">Cobrado</th><th>Plazo</th><th /></tr>
              </thead>
              <tbody>
                {lista.length === 0 && (
                  <tr><td colSpan="8" className="text-center text-muted py-4">
                    No hay pedidos entregados {plazo ? `en los últimos ${plazo} días ` : ''}que coincidan con la búsqueda.
                  </td></tr>
                )}
                {lista.map((p) => (
                  <tr key={p.id}>
                    <td className="font-monospace fw-semibold text-nowrap">{p.codigo}</td>
                    <td className="text-nowrap">{fechaHora(p.fecha)}</td>
                    <td>
                      {p.nombre_cliente}
                      {p.vendedor && <div className="small text-muted">atendió {p.vendedor}</div>}
                    </td>
                    <td>
                      {p.productos.map((x, i) => (
                        <span key={i}>{i > 0 && ', '}{x.nombre}{x.cantidad > 1 && <span className="text-muted"> ×{x.cantidad}</span>}</span>
                      ))}
                    </td>
                    <td>{p.medios ?? '—'}</td>
                    <td className="text-end fw-semibold text-nowrap">{money(p.cobrado)}</td>
                    <td>
                      {p.dias_restantes == null ? '—' : (
                        <span className={`badge ${p.dias_restantes <= 3 ? 'text-bg-warning' : 'text-bg-secondary'}`}
                          title="Días que quedan para devolver">{p.dias_restantes} día(s)</span>
                      )}
                    </td>
                    <td className="text-end"><button type="button" className="btn btn-sm btn-primary" onClick={() => onElegir(p.id)}>Elegir</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Seccion>
    </>
  );
}
