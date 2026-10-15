import { clp, fechaDMA, generarDocumentoPdf, pdfABuffer } from '../../core/documentos.js';
import { cuerpoComprobante, enviarCorreo } from '../../core/correo.js';
import { detalleDevolucion } from './servicio.js';

// Comprobante de devolución (no es una nota de crédito tributaria), como JSON con el PDF en base64
// (los gestores de descarga como IDM interceptan application/pdf).
export async function comprobanteDevolucion(db, id) {
  const d = await detalleDevolucion(db, id);
  const redondeo = Number(d.redondeo ?? 0); // ajuste del efectivo devuelto (Ley 20.956)
  const doc = generarDocumentoPdf({
    titulo: 'COMPROBANTE DE DEVOLUCIÓN',
    codigo: d.codigo,
    emisor: {
      nombre: process.env.EMPRESA_NOMBRE || 'FarmaClick',
      lineas: [process.env.EMPRESA_RUT && `RUT ${process.env.EMPRESA_RUT}`, process.env.EMPRESA_DIRECCION].filter(Boolean),
    },
    metadatos: [['Fecha', fechaDMA(d.fecha)], ['Pedido original', d.pedido_codigo], ['Atendió', d.usuario]],
    partes: [
      { titulo: 'Cliente', lineas: [d.nombre_cliente] },
      { titulo: 'Sucursal', lineas: [d.sucursal, d.sucursal_direccion] },
    ],
    columnas: [
      { header: 'SKU', key: 'sku', ancho: 0.16 },
      { header: 'Producto', key: 'producto', ancho: 0.46 },
      { header: 'Cant.', key: 'cantidad', ancho: 0.1, alinear: 'right' },
      { header: 'Reembolso', key: 'monto', ancho: 0.28, alinear: 'right' },
    ],
    filas: d.lineas.map((l) => ({ sku: l.sku, producto: l.nombre_producto, cantidad: l.cantidad, monto: clp(l.monto_reembolso) })),
    totales: [
      ['Total devuelto', clp(d.total_reembolso)],
      ...(redondeo ? [['Ajuste por redondeo (Ley 20.956)', `${redondeo < 0 ? '-' : '+'}${clp(Math.abs(redondeo))}`], ['Dinero devuelto', clp(Number(d.total_reembolso) + redondeo)]] : []),
    ],
    nota: `Motivo: ${d.motivo}. Dinero devuelto por: ${d.pagos.map((x) => `${x.medio_pago} ${clp(x.monto)}`).join(', ')}. Documento no tributario.`,
  });
  const pdf = await pdfABuffer(doc);
  return { archivo: `${d.codigo}.pdf`, tipo: 'application/pdf', base64: pdf.toString('base64') };
}

// Envía el comprobante de devolución por correo, con el PDF adjunto.
export async function enviarComprobanteDevolucion(db, id, correo) {
  const d = await detalleDevolucion(db, id);
  const { archivo, base64 } = await comprobanteDevolucion(db, id);
  const { texto, html } = cuerpoComprobante({
    nombre: d.nombre_cliente, documento: 'comprobante de devolución', codigo: d.codigo,
    detalle: `pedido ${d.pedido_codigo}, ${clp(Number(d.total_reembolso) + Number(d.redondeo ?? 0))} devueltos`,
  });
  await enviarCorreo({
    para: correo, asunto: `Comprobante de devolución ${d.codigo} · ${process.env.EMPRESA_NOMBRE || 'FarmaClick'}`, texto, html,
    adjuntos: [{ filename: archivo, content: Buffer.from(base64, 'base64'), contentType: 'application/pdf' }],
  });
  return { enviado_a: correo, codigo: d.codigo };
}
