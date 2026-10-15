import { clp, fechaDMA, generarDocumentoPdf, pdfABuffer } from '../../core/documentos.js';
import { HttpError } from '../../core/errors.js';
import { detalleTurno, esSupervisor } from './servicio.js';

const hora = (v) => new Date(v).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short' });

// Cierre Z de un turno cerrado, o reporte X (parcial) de uno abierto, como JSON con el PDF en base64
// (los gestores de descarga como IDM interceptan application/pdf).
export async function informeTurno(db, id, user) {
  const t = await detalleTurno(db, id, user);
  if (t.abierto && !esSupervisor(user)) throw new HttpError(403, 'El reporte de un turno abierto solo lo ve quien supervisa la caja (administrador o jefe de local).');
  const e = t.efectivo;
  const dif = e.diferencia;
  const corregido = (campo) => (t.correcciones.some((c) => c.campo === campo) ? ' (corregido)' : '');
  // Trazabilidad en el documento: correcciones de montos y observaciones, con quién y cuándo.
  const tipoCierre = t.cierre_tipo === 'automatico'
    ? `Cierre automático a las 23:59 (el turno seguía abierto).${t.arqueo_fecha ? ` Arqueo registrado por ${t.arqueo_por} el ${hora(t.arqueo_fecha)}.` : ' Arqueo pendiente.'}`
    : t.cierre_tipo === 'forzado' ? `Cerrado por fuerza mayor por ${t.cerrado_por}. Motivo: ${t.cierre_motivo}` : null;
  const registro = [
    ...(tipoCierre ? [tipoCierre] : []),
    ...t.correcciones.map((c) => `Corrección (${hora(c.fecha)}, ${c.usuario}): ${c.campo === 'apertura' ? 'efectivo inicial' : 'efectivo contado'} `
      + `de ${clp(c.valor_anterior)} a ${clp(c.valor_nuevo)}. Motivo: ${c.motivo}`),   // la fuente del PDF no tiene la flecha
    ...t.observaciones.map((o) => `Observación (${hora(o.fecha)}, ${o.usuario}): ${o.texto}`),
  ];
  const doc = generarDocumentoPdf({
    titulo: t.abierto ? 'REPORTE DE CAJA (X)' : 'CIERRE DE CAJA (Z)',
    codigo: `CAJA ${t.caja_numero} · ${fechaDMA(t.fecha_apertura)}`,
    emisor: {
      nombre: process.env.EMPRESA_NOMBRE || 'FarmaClick',
      lineas: [process.env.EMPRESA_RUT && `RUT ${process.env.EMPRESA_RUT}`, process.env.EMPRESA_DIRECCION].filter(Boolean),
    },
    metadatos: [['Apertura', hora(t.fecha_apertura)], ['Cierre', t.fecha_cierre ? hora(t.fecha_cierre) : 'Turno abierto'], ['Cajero', t.cajero]],
    partes: [
      { titulo: 'Sucursal y caja', lineas: [t.sucursal, `Caja ${t.caja_numero}`, t.sucursal_direccion] },
      {
        titulo: 'Resumen del turno',
        lineas: [`${t.resumen.ventas} venta(s): ${clp(t.resumen.total_ventas)}`, `${t.resumen.devoluciones} devolución(es): ${clp(t.resumen.total_devoluciones)}`,
          `Venta neta: ${clp(t.resumen.total_ventas - t.resumen.total_devoluciones)}`,
          ...(t.resumen.redondeo ? [`Redondeo del efectivo (Ley 20.956): ${t.resumen.redondeo < 0 ? '-' : '+'}${clp(Math.abs(t.resumen.redondeo))}`] : [])],
      },
    ],
    columnas: [
      { header: 'Medio de pago', key: 'medio', ancho: 0.34 },
      { header: 'Ventas', key: 'ventas', ancho: 0.22, alinear: 'right' },
      { header: 'Devoluciones', key: 'devoluciones', ancho: 0.22, alinear: 'right' },
      { header: 'Neto', key: 'neto', ancho: 0.22, alinear: 'right' },
    ],
    filas: t.por_medio.map((m) => ({
      medio: m.medio_pago, ventas: clp(m.ventas), devoluciones: m.devoluciones ? `-${clp(m.devoluciones)}` : '', neto: clp(m.ventas - m.devoluciones),
    })),
    totales: [
      [`Efectivo inicial${corregido('apertura')}`, clp(e.apertura)],
      ['+ Ventas en efectivo', clp(e.ventas)],
      ['- Devoluciones en efectivo', `-${clp(e.devoluciones)}`],
      ['Efectivo esperado', clp(e.esperado)],
      ...(t.abierto ? [] : t.arqueo_pendiente ? [['Efectivo contado', 'Pendiente de arqueo'], ['Diferencia', 'Pendiente de arqueo']]
        : [[`Efectivo contado${corregido('cierre')}`, clp(e.contado)], ['Diferencia', dif === 0 ? 'Cuadrada' : `${dif > 0 ? 'Sobran' : 'Faltan'} ${clp(Math.abs(dif))}`]]),
    ],
    nota: [
      t.revision
        ? `${t.revision.conforme ? 'Revisado conforme' : 'Revisado con observaciones'} por ${t.revision.revisor} el ${hora(t.revision.fecha).replace(/\.$/, '')}.${t.revision.observacion ? ` ${t.revision.observacion}` : ''}`
        : t.abierto ? 'Reporte parcial: el turno sigue abierto.' : t.arqueo_pendiente ? 'Pendiente de arqueo y de revisión.' : 'Pendiente de revisión.',
      ...registro,
    ].join('\n'),
    sello: t.abierto ? 'TURNO ABIERTO' : null,
  });
  const pdf = await pdfABuffer(doc);
  return { archivo: `Caja${t.caja_numero}-${t.fecha_apertura.toISOString().slice(0, 10)}.pdf`, tipo: 'application/pdf', base64: pdf.toString('base64') };
}
