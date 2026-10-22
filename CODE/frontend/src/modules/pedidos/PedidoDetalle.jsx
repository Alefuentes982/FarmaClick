import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import BotonesDocumento from '../../components/BotonesDocumento.jsx';
import { Slot } from '../../extensiones.jsx';
import { fechaHora, money } from '../../format.js';
import { textoAjuste } from '../../redondeo.js';
import PanelPago from '../../components/PanelPago.jsx';
import EnviarCorreo from '../../components/EnviarCorreo.jsx';
import { ErrorAlert, Ficha, PageHeader, Seccion, Spinner, useAsync } from '../../components/ui.jsx';
import { estadoPedidoClase } from './estados.js';

export default function PedidoDetalle() {
  const { id } = useParams();
  const location = useLocation();
  const { data: p, error, loading, reload } = useAsync(() => api.get(`/pedidos/${id}`), [id]);
  const catalogos = useAsync(() => api.get('/catalogos'), []);
  const [aviso, setAviso] = useState(location.state?.aviso ?? null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cobrando, setCobrando] = useState(false);

  const ejecutar = async (fn, mensaje) => {
    setActionError(null);
    setAviso(null);
    setBusy(true);
    try {
      await fn();
      setAviso(mensaje);
      setCobrando(false);
      reload();
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(false);
    }
  };

  if (loading && !p) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!p) return <Spinner />;

  const medios = catalogos.data?.medios_pago ?? [];
  const siguientes = p.acciones.filter((a) => a.startsWith('estado:')).map((a) => a.slice(7));
  const tiene = (a) => p.acciones.includes(a);

  const confirmarPago = (pagos) => ejecutar(
    () => api.post(`/pedidos/${id}/pagos`, { pagos }),
    `Pago registrado. El pedido ${p.codigo} quedó pagado.`);

  return (
    <>
      <PageHeader title={`Pedido ${p.codigo}`}>
        {tiene('editar') && <Link to={`/pedidos/${id}/editar`} className="btn btn-outline-primary"><i className="bi bi-pencil me-1" />Editar</Link>}
        {tiene('reservar') && (
          <button className="btn btn-outline-primary" disabled={busy}
            onClick={() => ejecutar(() => api.post(`/pedidos/${id}/reservar`), 'Stock reservado.')}>
            <i className="bi bi-box-seam me-1" />Reservar stock
          </button>
        )}
        {tiene('pagar') && !cobrando && (
          <button className="btn btn-success" disabled={busy || medios.length === 0} onClick={() => setCobrando(true)}>
            <i className="bi bi-cash-coin me-1" />Registrar pago
          </button>
        )}
        {siguientes.map((s) => (
          <button key={s} className="btn btn-primary" disabled={busy}
            onClick={() => ejecutar(() => api.post(`/pedidos/${id}/estado`, { estado: s }), `Pedido en estado "${s}".`)}>
            Pasar a «{s}»
          </button>
        ))}
        <BotonesDocumento path={`/pedidos/${id}/pdf`} nombre={`${p.codigo}.pdf`} onError={setActionError} etiquetaVer="Ver comprobante" />
        {tiene('cancelar') && (
          <button className="btn btn-outline-danger" disabled={busy}
            onClick={() => window.confirm('¿Cancelar el pedido? Se devuelve el stock y se anulan los pagos registrados (la devolución del dinero es aparte).')
              && ejecutar(() => api.post(`/pedidos/${id}/cancelar`), `Pedido ${p.codigo} cancelado.`)}>
            Cancelar pedido
          </button>
        )}
        <Link to="/pedidos" className="btn btn-outline-secondary">Volver</Link>
      </PageHeader>

      {aviso && (
        <div className="alert alert-success d-flex justify-content-between">
          <span>{aviso}</span>
          <button type="button" className="btn-close" aria-label="Cerrar" onClick={() => setAviso(null)} />
        </div>
      )}
      <ErrorAlert error={actionError} onClose={() => setActionError(null)} />
      {p.estado === 'Pago pendiente' && (
        <div className="alert alert-warning py-2">
          Pago pendiente{p.stock_reservado ? ' · stock reservado' : ' · sin stock reservado'}. Si no se paga dentro de 20 minutos desde su creación, el pedido expira y devuelve el stock.
        </div>
      )}

      <div className="row g-3">
        <div className="col-lg-7">
          <Seccion titulo="Datos del pedido" icono="bi-info-circle">
            <Ficha filas={[
              ['Estado', <span className={`badge text-bg-${estadoPedidoClase[p.estado] ?? 'light'}`}>{p.estado}</span>],
              ['Cliente', <>{p.nombre_cliente}{p.telefono && <span className="text-muted"> · {p.telefono}</span>}</>],
              ['Entrega', [p.direccion_pedido, p.comuna].filter(Boolean).join(', ') || '—'],
              ['Sucursal', p.sucursal ?? '—'],
              ['Canal', p.canal],
              ['Creado', `${fechaHora(p.fecha)}${p.vendedor ? ` por ${p.vendedor}` : ''}`],
            ]} />
          </Seccion>
        </div>
        <div className="col-lg-5">
          <Seccion titulo="Totales" icono="bi-receipt">
            <div className="fc-total-bloque">
              <div>Subtotal: <strong>{money(p.subtotal_bruto)}</strong></div>
              {p.descuento_total > 0 && <div className="text-success">Descuentos: <strong>-{money(p.descuento_total)}</strong></div>}
              <div className="text-muted small">Neto {money(p.subtotal_neto)} · IVA {money(p.iva)}</div>
              <div className="fc-total-importe">{money(p.total)}</div>
              {Number(p.redondeo) !== 0 && (
                <div className="small">Redondeo del efectivo (Ley 20.956): <strong>{textoAjuste(Number(p.redondeo), money)}</strong>
                  <br />Total cobrado <strong>{money(Number(p.total) + Number(p.redondeo))}</strong></div>
              )}
            </div>
          </Seccion>
        </div>
      </div>

      <Seccion titulo="Productos" icono="bi-box-seam" plano>
        <div className="table-responsive">
          <table className="table align-middle">
            <thead><tr><th>SKU</th><th>Producto</th><th className="text-end">Cant.</th><th className="text-end">Precio unit.</th><th className="text-end">Descuento</th><th className="text-end">Subtotal</th></tr></thead>
            <tbody>
              {p.lineas.map((l) => (
                <tr key={l.id}>
                  <td className="text-nowrap">{l.sku}</td><td>{l.nombre_producto}{l.regla && <span className="badge text-bg-success ms-2">{l.regla}</span>}</td>
                  <td className="text-end">{l.cantidad}</td><td className="text-end">{money(l.precio_unitario)}</td>
                  <td className="text-end">{Number(l.descuento_monto) ? `-${money(l.descuento_monto)}` : '—'}</td>
                  <td className="text-end">{money(l.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Seccion>

      {cobrando && (
        <PanelPago total={Number(p.total)} medios={medios} busy={busy} onConfirmar={confirmarPago} onCancelar={() => setCobrando(false)}
          ayuda="Si el pedido aún no tiene stock reservado, se reserva al confirmar el pago." />
      )}

      <Seccion titulo="Pagos" icono="bi-cash-coin" plano={p.pagos.length > 0}>
        {p.pagos.length === 0 ? <span className="text-muted">Sin pagos registrados.</span> : (
          <div className="table-responsive">
            <table className="table table-sm">
              <thead><tr><th>Fecha</th><th>Medio</th><th>Autorización</th><th>Estado</th><th className="text-end">Monto</th></tr></thead>
              <tbody>
                {p.pagos.map((x) => (
                  <tr key={x.id}>
                    <td>{fechaHora(x.fecha_transaccion)}</td><td>{x.medio_pago}</td><td>{x.codigo_autorizacion ?? '—'}</td>
                    <td><span className={`badge text-bg-${x.estado === 'Aprobado' ? 'success' : 'secondary'}`}>{x.estado}</span></td>
                    <td className="text-end">{money(x.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Seccion>

      {['Pagado', 'En preparación', 'Listo para retiro', 'En despacho', 'Entregado'].includes(p.estado) && (
        <Seccion titulo="Enviar comprobante por correo" icono="bi-envelope">
          <EnviarCorreo ruta={`/pedidos/${id}/enviar`} />
        </Seccion>
      )}

      {/* Otros módulos (p. ej. devoluciones) agregan aquí sus secciones. */}
      <Slot nombre="pedido.detalle" pedido={p} />
    </>
  );
}
