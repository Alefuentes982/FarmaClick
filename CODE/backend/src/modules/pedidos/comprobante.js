import { clp, fechaDMA, generarDocumentoPdf, pdfABuffer } from '../../core/documentos.js';
import { cuerpoComprobante, enviarCorreo } from '../../core/correo.js';
import { detallePedido, ESTADO } from './servicio.js';

// Comprobante del pedido (no es un documento tributario), como JSON con el PDF en base64: los gestores de descarga
// como IDM interceptan application/pdf. Lo usan el módulo de pedidos y la caja.
export async function comprobantePedido(db, id) {
  const p = await detallePedido(db, id);
  const cliente = [p.nombre_cliente, p.telefono && `Tel. ${p.telefono}`, p.direccion_pedido, p.comuna].filter(Boolean);
  const pagado = p.pagos.filter((x) => x.estado === 'Aprobado');
  const redondeo = Number(p.redondeo ?? 0); // ajuste del efectivo (Ley 20.956)
  const doc = generarDocumentoPdf({
    titulo: 'COMPROBANTE DE PEDIDO',
    codigo: p.codigo,
    emisor: {
      nombre: process.env.EMPRESA_NOMBRE || 'FarmaClick',
      lineas: [process.env.EMPRESA_RUT && `RUT ${process.env.EMPRESA_RUT}`, process.env.EMPRESA_DIRECCION].filter(Boolean),
    },
    metadatos: [['Fecha', fechaDMA(p.fecha)], ['Estado', p.estado], ['Atendió', p.vendedor ?? '—']],
    partes: [
      { titulo: 'Cliente', lineas: cliente },
      { titulo: 'Sucursal', lineas: [p.sucursal, p.sucursal_direccion, p.sucursal_telefono && `Tel. ${p.sucursal_telefono}`] },
    ],
    columnas: [
      { header: 'SKU', key: 'sku', ancho: 0.14 },
      { header: 'Producto', key: 'producto', ancho: 0.34 },
      { header: 'Cant.', key: 'cantidad', ancho: 0.08, alinear: 'right' },
      { header: 'Precio unit.', key: 'precio', ancho: 0.15, alinear: 'right' },
      { header: 'Desc.', key: 'descuento', ancho: 0.12, alinear: 'right' },
      { header: 'Subtotal', key: 'subtotal', ancho: 0.17, alinear: 'right' },
    ],
    filas: p.lineas.map((l) => ({
      sku: l.sku, producto: l.nombre_producto, cantidad: l.cantidad, precio: clp(l.precio_unitario),
      descuento: Number(l.descuento_monto) ? `-${clp(l.descuento_monto)}` : '', subtotal: clp(l.subtotal),
    })),
    totales: [
      ['Subtotal', clp(p.subtotal_bruto)],
      ...(p.descuento_total ? [['Descuentos', `-${clp(p.descuento_total)}`]] : []),
      ['Neto', clp(p.subtotal_neto)], ['IVA 19%', clp(p.iva)], ['Total', clp(p.total)],
      ...(redondeo ? [['Ajuste por redondeo (Ley 20.956)', `${redondeo < 0 ? '-' : '+'}${clp(Math.abs(redondeo))}`], ['Total pagado', clp(Number(p.total) + redondeo)]] : []),
    ],
    nota: pagado.length
      ? `Pagado con: ${pagado.map((x) => `${x.medio_pago} ${clp(x.monto)}`).join(', ')}. Documento no tributario.`
      : 'Documento no tributario.',
    sello: p.estado === ESTADO.PENDIENTE ? 'PENDIENTE' : [ESTADO.CANCELADO, ESTADO.EXPIRADO].includes(p.estado) ? 'ANULADO' : null,
  });
  const pdf = await pdfABuffer(doc);
  return { archivo: `${p.codigo}.pdf`, tipo: 'application/pdf', base64: pdf.toString('base64') };
}

// Envía el comprobante del pedido por correo, con el PDF adjunto.
export async function enviarComprobantePedido(db, id, correo) {
  const p = await detallePedido(db, id);
  const { archivo, base64 } = await comprobantePedido(db, id);
  const { texto, html } = cuerpoComprobante({
    nombre: p.nombre_cliente, documento: 'comprobante de su compra', codigo: p.codigo,
    detalle: `total ${clp(Number(p.total) + Number(p.redondeo ?? 0))}`,
  });
  await enviarCorreo({
    para: correo, asunto: `Comprobante ${p.codigo} · ${process.env.EMPRESA_NOMBRE || 'FarmaClick'}`, texto, html,
    adjuntos: [{ filename: archivo, content: Buffer.from(base64, 'base64'), contentType: 'application/pdf' }],
  });
  return { enviado_a: correo, codigo: p.codigo };
}
