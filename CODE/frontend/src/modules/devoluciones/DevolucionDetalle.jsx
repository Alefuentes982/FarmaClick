import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import BotonesDocumento from '../../components/BotonesDocumento.jsx';
import { fechaHora, money } from '../../format.js';
import { textoAjuste } from '../../redondeo.js';
import EnviarCorreo from '../../components/EnviarCorreo.jsx';
import { ErrorAlert, Ficha, PageHeader, Seccion, Spinner, useAsync } from '../../components/ui.jsx';

export default function DevolucionDetalle() {
  const { id } = useParams();
  const location = useLocation();
  const { data: d, error, loading } = useAsync(() => api.get(`/devoluciones/${id}`), [id]);
  const [aviso, setAviso] = useState(location.state?.aviso ?? null);
  const [actionError, setActionError] = useState(null);

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;

  return (
    <>
      <PageHeader title={`Devolución ${d.codigo}`}>
        <BotonesDocumento path={`/devoluciones/${id}/pdf`} nombre={`${d.codigo}.pdf`} onError={setActionError} etiquetaVer="Ver comprobante" />
        <Link to="/devoluciones" className="btn btn-outline-secondary">Volver</Link>
      </PageHeader>
      {aviso && (
        <div className="alert alert-success d-flex justify-content-between">
          <span>{aviso}</span>
          <button type="button" className="btn-close" aria-label="Cerrar" onClick={() => setAviso(null)} />
        </div>
      )}
      <ErrorAlert error={actionError} onClose={() => setActionError(null)} />

      <div className="row g-3">
        <div className="col-lg-7">
          <Seccion titulo="Datos de la devolución" icono="bi-info-circle">
            <Ficha filas={[
              ['Pedido', <Link to={`/pedidos/${d.pedido_id}`}>{d.pedido_codigo}</Link>],
              ['Cliente', d.nombre_cliente],
              ['Sucursal', d.sucursal ?? '—'],
              ['Fecha', `${fechaHora(d.fecha)} · ${d.usuario}`],
              ['Motivo', d.motivo],
            ]} />
          </Seccion>
        </div>
        <div className="col-lg-5">
          <Seccion titulo="Total devuelto" icono="bi-receipt">
            <div className="fc-total-bloque">
              <div className="fc-total-importe">{money(d.total_reembolso)}</div>
              {Number(d.redondeo) !== 0 && (
                <div className="small">Redondeo del efectivo (Ley 20.956): <strong>{textoAjuste(Number(d.redondeo), money)}</strong>
                  <br />Dinero devuelto <strong>{money(Number(d.total_reembolso) + Number(d.redondeo))}</strong></div>
              )}
            </div>
          </Seccion>
        </div>
      </div>

      <Seccion titulo="Productos devueltos" icono="bi-box-seam" plano>
        <div className="table-responsive">
          <table className="table align-middle">
            <thead><tr><th>SKU</th><th>Producto</th><th className="text-end">Cant.</th><th>Stock</th><th className="text-end">Reembolso</th></tr></thead>
            <tbody>
              {d.lineas.map((l) => (
                <tr key={l.id}>
                  <td className="text-nowrap">{l.sku}</td><td>{l.nombre_producto}</td><td className="text-end">{l.cantidad}</td>
                  <td>{l.reingresa_stock ? <span className="badge text-bg-success">Reingresado</span> : <span className="badge text-bg-secondary">No reingresado</span>}</td>
                  <td className="text-end">{money(l.monto_reembolso)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Seccion>

      <Seccion titulo="Dinero devuelto" icono="bi-cash-coin" plano>
        <div className="table-responsive">
          <table className="table table-sm">
            <thead><tr><th>Medio</th><th>Referencia</th><th className="text-end">Monto</th></tr></thead>
            <tbody>
              {d.pagos.map((x) => <tr key={x.id}><td>{x.medio_pago}</td><td>{x.referencia ?? '—'}</td><td className="text-end">{money(x.monto)}</td></tr>)}
            </tbody>
          </table>
        </div>
      </Seccion>

      <Seccion titulo="Enviar comprobante por correo" icono="bi-envelope">
        <EnviarCorreo ruta={`/devoluciones/${id}/enviar`} />
      </Seccion>
    </>
  );
}
