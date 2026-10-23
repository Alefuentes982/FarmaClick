// Exportación de un informe a CSV o PDF. Como los demás documentos, el archivo viaja como JSON con base64
// (los gestores de descarga como IDM interceptan application/pdf y text/csv y lo dejan vacío).
import { clp, fechaDMA, generarDocumentoPdf, pdfABuffer } from '../../core/documentos.js';
import { agregarHoja, libroAArchivo, nuevoLibro } from '../../core/excel.js';

const entero = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
const hora = () => new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short' });

// Texto de una celda para personas (PDF): pesos con $, miles con punto, fechas día-mes-año.
export function formatoCelda(tipo, v) {
  if (v == null || v === '') return '';
  if (tipo === 'clp') return clp(v);
  if (tipo === 'entero') return entero.format(v);
  if (tipo === 'fecha') return fechaDMA(v);
  return String(v);
}

// Celda de CSV para Excel en español: separador ";" y comillas cuando hace falta. Un texto que empieza con
// = + - @ se prefija con ' para que la hoja de cálculo no lo ejecute como fórmula.
export function celdaCsv(tipo, v) {
  if (v == null) return '';
  let s = tipo === 'fecha' ? fechaDMA(v) : String(v);
  if (tipo === 'texto' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

// Montos y cantidades van sin formato (1234567) para poder sumarlos en la hoja; BOM para que Excel lea los acentos.
export function generarCsv(informe) {
  const lineas = [informe.columnas.map((c) => celdaCsv('texto', c.header)).join(';')];
  informe.filas.forEach((f) => lineas.push(informe.columnas.map((c) => celdaCsv(c.tipo, f[c.key])).join(';')));
  return `﻿${lineas.join('\r\n')}\r\n`;
}

export const periodoTexto = ({ desde, hasta }) => {
  if (desde && hasta) return `${fechaDMA(desde)} al ${fechaDMA(hasta)}`;
  if (desde) return `Desde ${fechaDMA(desde)}`;
  if (hasta) return `Hasta ${fechaDMA(hasta)}`;
  return 'Todo el período';
};

// Anchos de columna del PDF: el texto pesa el doble que una cifra; suman 1.
export function anchosColumnas(columnas) {
  const pesos = columnas.map((c) => (c.tipo === 'texto' ? 2 : 1));
  const total = pesos.reduce((a, b) => a + b, 0);
  return pesos.map((p) => p / total);
}

export async function archivoInforme(informe, formato, f) {
  const base = `${informe.id}${informe.fechas ? `_${f.desde ?? 'inicio'}_${f.hasta ?? 'hoy'}` : ''}`;
  if (formato === 'csv') {
    return { archivo: `${base}.csv`, tipo: 'text/csv', base64: Buffer.from(generarCsv(informe), 'utf8').toString('base64') };
  }
  if (formato === 'xlsx') {
    const libro = nuevoLibro();
    agregarHoja(libro, informe.titulo, {
      titulo: `${informe.titulo} · ${informe.grupo}`,
      contexto: [informe.fechas ? `Período: ${periodoTexto(f)}` : `Al ${fechaDMA(new Date())}`, `Sucursal: ${f.sucursal_nombre ?? 'Todas'}`, `Generado el ${hora()}`],
      columnas: informe.columnas, filas: informe.filas,
    });
    return libroAArchivo(libro, `${base}.xlsx`);
  }
  const anchos = anchosColumnas(informe.columnas);
  const doc = generarDocumentoPdf({
    titulo: informe.titulo.toUpperCase(),
    codigo: informe.fechas ? periodoTexto(f) : `Al ${fechaDMA(new Date())}`,
    emisor: {
      nombre: process.env.EMPRESA_NOMBRE || 'FarmaClick',
      lineas: [process.env.EMPRESA_RUT && `RUT ${process.env.EMPRESA_RUT}`, process.env.EMPRESA_DIRECCION].filter(Boolean),
    },
    metadatos: [['Informe', informe.grupo], ['Sucursal', f.sucursal_nombre ?? 'Todas'], ['Generado', hora()]],
    columnas: informe.columnas.map((c, i) => ({ header: c.header, key: c.key, ancho: anchos[i], alinear: c.tipo === 'texto' || c.tipo === 'fecha' ? 'left' : 'right' })),
    filas: informe.filas.map((r) => Object.fromEntries(informe.columnas.map((c) => [c.key, formatoCelda(c.tipo, r[c.key])]))),
    totales: informe.columnas.filter((c) => c.suma).map((c) => [`Total ${c.header.toLowerCase()}`, formatoCelda(c.tipo, informe.totales[c.key])]),
    nota: informe.filas.length ? null : 'Sin datos para los filtros elegidos.',
  });
  return { archivo: `${base}.pdf`, tipo: 'application/pdf', base64: (await pdfABuffer(doc)).toString('base64') };
}
