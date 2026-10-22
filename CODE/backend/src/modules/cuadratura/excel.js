// Exportación a Excel de la cuadratura de caja: el listado de turnos con sus filtros y la ficha de un turno.
import { fechaDMA } from '../../core/documentos.js';
import { agregarFicha, agregarHoja, libroAArchivo, nuevoLibro } from '../../core/excel.js';
import { detalleTurno, listarTurnos, resumenPeriodo } from './servicio.js';

const hora = (v) => (v ? new Date(v).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short' }) : '');
const num = (v) => Number(v ?? 0);
const periodo = ({ desde, hasta }) => (desde && hasta ? `${fechaDMA(desde)} al ${fechaDMA(hasta)}` : desde ? `Desde ${fechaDMA(desde)}` : hasta ? `Hasta ${fechaDMA(hasta)}` : 'Todo el período');
const MAX_FILAS = 5000;
const EVENTO = { apertura: 'Apertura', cierre: 'Cierre', arqueo: 'Arqueo', correccion: 'Corrección', observacion: 'Observación', revision: 'Revisión' };

// Listado de turnos (con los mismos filtros de la pantalla) y los indicadores del período.
export async function excelListado(db, user, filtros, rango) {
  const [turnos, resumen] = await Promise.all([
    listarTurnos(db, user, filtros, { ...rango, limit: MAX_FILAS, offset: 0 }),
    resumenPeriodo(db, user, filtros, rango),
  ]);
  const libro = nuevoLibro();
  const contexto = [`Período (apertura del turno): ${periodo(rango)}`, `Generado el ${hora(new Date())} por ${user.nombre}`];

  agregarFicha(libro, 'Resumen', {
    titulo: 'Cuadratura de caja · resumen del período',
    filas: [
      ['Período (apertura del turno)', periodo(rango)],
      ['Turnos', resumen.turnos, 'entero'],
      ['Turnos abiertos', resumen.abiertos, 'entero'],
      ['Turnos cerrados sin revisar', resumen.sin_revisar, 'entero'],
      ['Turnos pendientes de arqueo (cierre automático)', resumen.pendientes_arqueo, 'entero'],
      ['Turnos con diferencia de caja', resumen.con_diferencia, 'entero'],
      ['Ventas', resumen.ventas, 'entero'],
      ['Total vendido', num(resumen.total_ventas), 'clp'],
      ['Devoluciones', resumen.devoluciones, 'entero'],
      ['Total devuelto', num(resumen.total_devoluciones), 'clp'],
      ['Ventas netas', num(resumen.ventas_netas), 'clp', true],
      ['Ajuste por redondeo del efectivo (Ley 20.956)', num(resumen.redondeo), 'clp'],
      ['Faltantes de caja', num(resumen.faltantes), 'clp'],
      ['Sobrantes de caja', num(resumen.sobrantes), 'clp'],
      ['Diferencia neta', num(resumen.diferencia_neta), 'clp', true],
    ],
  });

  agregarHoja(libro, 'Turnos', {
    titulo: 'Turnos de caja',
    contexto,
    columnas: [
      { header: 'Apertura', key: 'apertura', tipo: 'texto' },
      { header: 'Cierre', key: 'cierre', tipo: 'texto' },
      { header: 'Sucursal', key: 'sucursal', tipo: 'texto' },
      { header: 'Caja', key: 'caja', tipo: 'entero' },
      { header: 'Cajero', key: 'cajero', tipo: 'texto' },
      { header: 'Estado', key: 'estado', tipo: 'texto' },
      { header: 'Efectivo inicial', key: 'inicial', tipo: 'clp' },
      { header: 'Ventas (N°)', key: 'ventas', tipo: 'entero', suma: true },
      { header: 'Total ventas', key: 'total_ventas', tipo: 'clp', suma: true },
      { header: 'Devoluciones (N°)', key: 'devoluciones', tipo: 'entero', suma: true },
      { header: 'Total devuelto', key: 'total_devoluciones', tipo: 'clp', suma: true },
      { header: 'Efectivo esperado', key: 'esperado', tipo: 'clp' },
      { header: 'Efectivo contado', key: 'contado', tipo: 'clp' },
      { header: 'Diferencia', key: 'diferencia', tipo: 'clp', suma: true },
      { header: 'Tipo de cierre', key: 'tipo_cierre', tipo: 'texto' },
      { header: 'Corregido', key: 'corregido', tipo: 'texto' },
      { header: 'Observaciones', key: 'observaciones', tipo: 'entero', suma: true },
    ],
    filas: turnos.map((t) => ({
      apertura: hora(t.fecha_apertura), cierre: hora(t.fecha_cierre), sucursal: t.sucursal, caja: t.caja_numero, cajero: t.cajero,
      estado: t.estado, inicial: num(t.monto_apertura_efectivo), ventas: t.ventas, total_ventas: num(t.total_ventas),
      devoluciones: t.devoluciones, total_devoluciones: num(t.total_devoluciones),
      esperado: t.esperado == null ? null : num(t.esperado), contado: t.contado == null ? null : num(t.contado),
      diferencia: t.diferencia, corregido: t.corregido ? 'Sí' : '', observaciones: t.observaciones,
      tipo_cierre: { automatico: 'Automático', forzado: 'Fuerza mayor', normal: 'Normal' }[t.cierre_tipo] ?? '',
    })),
  });

  agregarHoja(libro, 'Por medio de pago', {
    titulo: 'Cobrado y devuelto por medio de pago',
    contexto,
    columnas: [
      { header: 'Medio de pago', key: 'medio', tipo: 'texto' },
      { header: 'Ventas', key: 'ventas', tipo: 'clp', suma: true },
      { header: 'Devoluciones', key: 'devoluciones', tipo: 'clp', suma: true },
      { header: 'Neto', key: 'neto', tipo: 'clp', suma: true },
    ],
    filas: resumen.por_medio.map((m) => ({ medio: m.medio_pago, ventas: num(m.ventas), devoluciones: num(m.devoluciones), neto: num(m.ventas) - num(m.devoluciones) })),
  });

  agregarHoja(libro, 'Por cajero', {
    titulo: 'Resultado por cajero',
    contexto,
    columnas: [
      { header: 'Cajero', key: 'cajero', tipo: 'texto' },
      { header: 'Turnos', key: 'turnos', tipo: 'entero', suma: true },
      { header: 'Total ventas', key: 'total_ventas', tipo: 'clp', suma: true },
      { header: 'Turnos con diferencia', key: 'con_diferencia', tipo: 'entero', suma: true },
      { header: 'Faltantes', key: 'faltantes', tipo: 'clp', suma: true },
      { header: 'Sobrantes', key: 'sobrantes', tipo: 'clp', suma: true },
      { header: 'Diferencia neta', key: 'diferencia_neta', tipo: 'clp', suma: true },
    ],
    filas: resumen.por_cajero.map((c) => ({ ...c, total_ventas: num(c.total_ventas), faltantes: num(c.faltantes), sobrantes: num(c.sobrantes), diferencia_neta: num(c.diferencia_neta) })),
  });

  const sufijo = rango.desde || rango.hasta ? `_${rango.desde ?? 'inicio'}_${rango.hasta ?? 'hoy'}` : '';
  return libroAArchivo(libro, `cuadratura${sufijo}.xlsx`);
}

// Ficha de un turno: cuadre del efectivo, revisión, medios de pago, ventas y devoluciones.
export async function excelTurno(db, id, user) {
  const t = await detalleTurno(db, id, user);
  const e = t.efectivo;
  const libro = nuevoLibro();
  const titulo = `Turno · Caja ${t.caja_numero} · ${t.sucursal}`;

  agregarFicha(libro, 'Turno', {
    titulo: `${titulo} · ${t.abierto ? 'REPORTE X (turno abierto)' : 'CIERRE Z'}`,
    filas: [
      ['Cajero', t.cajero],
      ['Apertura', hora(t.fecha_apertura)],
      ['Cierre', t.fecha_cierre ? hora(t.fecha_cierre) : 'Turno abierto'],
      ['Tipo de cierre', !t.fecha_cierre ? '—' : t.cierre_tipo === 'automatico' ? 'Automático (23:59)' : t.cierre_tipo === 'forzado' ? `Fuerza mayor · ${t.cerrado_por}` : 'Normal'],
      ...(t.cierre_motivo ? [['Motivo del cierre', t.cierre_motivo]] : []),
      ['Ventas', t.resumen.ventas, 'entero'],
      ['Total vendido', num(t.resumen.total_ventas), 'clp'],
      ['Devoluciones', t.resumen.devoluciones, 'entero'],
      ['Total devuelto', num(t.resumen.total_devoluciones), 'clp'],
      ['Ajuste por redondeo del efectivo (Ley 20.956)', num(t.resumen.redondeo), 'clp'],
      ...(e ? [
        ['Efectivo inicial', num(e.apertura), 'clp'],
        ['+ Ventas en efectivo', num(e.ventas), 'clp'],
        ['- Devoluciones en efectivo', num(e.devoluciones), 'clp'],
        ['Efectivo esperado', num(e.esperado), 'clp', true],
        ...(t.abierto ? [] : t.arqueo_pendiente ? [['Efectivo contado', 'Pendiente de arqueo'], ['Diferencia', 'Pendiente de arqueo']]
          : [['Efectivo contado', num(e.contado), 'clp'], ['Diferencia', num(e.diferencia), 'clp', true]]),
      ] : []),
      ['Revisión', t.revision ? `${t.revision.conforme ? 'Conforme' : 'Con observaciones'} · ${t.revision.revisor} · ${hora(t.revision.fecha)}` : (t.abierto ? 'Turno abierto' : 'Pendiente de revisión')],
      ...(t.revision?.observacion ? [['Observación de la revisión', t.revision.observacion]] : []),
      ['Correcciones de montos', t.correcciones.length, 'entero'],
      ['Observaciones', t.observaciones.length, 'entero'],
    ],
  });

  // Trazabilidad completa del turno: apertura, cierre, correcciones (con montos anterior y nuevo), observaciones y revisión.
  agregarHoja(libro, 'Historial', {
    titulo: `Historial del turno · ${titulo}`,
    contexto: [`Generado el ${hora(new Date())} por ${user.nombre}`],
    columnas: [
      { header: 'Fecha y hora', key: 'fecha', tipo: 'texto' },
      { header: 'Evento', key: 'evento', tipo: 'texto' },
      { header: 'Usuario', key: 'usuario', tipo: 'texto' },
      { header: 'Detalle', key: 'detalle', tipo: 'texto' },
      { header: 'Motivo / texto', key: 'texto', tipo: 'texto' },
    ],
    filas: t.historial.map((h) => ({ fecha: hora(h.fecha), evento: EVENTO[h.tipo] ?? h.tipo, usuario: h.usuario, detalle: h.detalle, texto: h.texto ?? '' })),
  });

  if (t.por_medio) {
    agregarHoja(libro, 'Por medio de pago', {
      titulo, contexto: [`Generado el ${hora(new Date())} por ${user.nombre}`],
      columnas: [
        { header: 'Medio de pago', key: 'medio', tipo: 'texto' },
        { header: 'Ventas', key: 'ventas', tipo: 'clp', suma: true },
        { header: 'Devoluciones', key: 'devoluciones', tipo: 'clp', suma: true },
        { header: 'Neto', key: 'neto', tipo: 'clp', suma: true },
      ],
      filas: t.por_medio.map((m) => ({ medio: m.medio_pago, ventas: m.ventas, devoluciones: m.devoluciones, neto: m.ventas - m.devoluciones })),
    });
  }
  agregarHoja(libro, 'Ventas', {
    titulo: `Ventas del turno · ${titulo}`,
    columnas: [
      { header: 'N°', key: 'codigo', tipo: 'texto' },
      { header: 'Fecha y hora', key: 'fecha', tipo: 'texto' },
      { header: 'Cliente', key: 'cliente', tipo: 'texto' },
      { header: 'Estado', key: 'estado', tipo: 'texto' },
      { header: 'Total', key: 'total', tipo: 'clp', suma: true },
      { header: 'Redondeo', key: 'redondeo', tipo: 'clp', suma: true },
    ],
    filas: t.ventas.map((v) => ({ codigo: v.codigo, fecha: hora(v.fecha), cliente: v.nombre_cliente, estado: v.estado, total: num(v.total), redondeo: num(v.redondeo) })),
  });
  agregarHoja(libro, 'Devoluciones', {
    titulo: `Devoluciones del turno · ${titulo}`,
    columnas: [
      { header: 'N°', key: 'codigo', tipo: 'texto' },
      { header: 'Fecha y hora', key: 'fecha', tipo: 'texto' },
      { header: 'Pedido', key: 'pedido', tipo: 'texto' },
      { header: 'Motivo', key: 'motivo', tipo: 'texto' },
      { header: 'Valor devuelto', key: 'total', tipo: 'clp', suma: true },
      { header: 'Redondeo', key: 'redondeo', tipo: 'clp', suma: true },
    ],
    filas: t.devoluciones.map((d) => ({ codigo: d.codigo, fecha: hora(d.fecha), pedido: d.pedido_codigo, motivo: d.motivo, total: num(d.total_reembolso), redondeo: num(d.redondeo) })),
  });

  return libroAArchivo(libro, `Caja${t.caja_numero}-${new Date(t.fecha_apertura).toISOString().slice(0, 10)}.xlsx`);
}
