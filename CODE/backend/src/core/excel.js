// Libros de Excel (.xlsx) para reportes y exportaciones. Como los PDF, el archivo viaja como JSON con base64
// (los gestores de descarga como IDM interceptan las descargas directas y las dejan vacías).
// Recibe datos ya armados: no conoce tablas ni rutas.
import ExcelJS from 'exceljs';

export const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const AZUL = 'FF0D6EFD';
const GRIS = 'FFF1F3F5';
const FORMATO = { clp: '"$"#,##0', entero: '#,##0', fecha: 'dd-mm-yyyy', texto: '@' };

export function nuevoLibro() {
  const libro = new ExcelJS.Workbook();
  libro.creator = process.env.EMPRESA_NOMBRE || 'FarmaClick';
  libro.created = new Date();
  return libro;
}

// Una fecha AAAA-MM-DD pasa a fecha real de Excel (a medianoche UTC, sin corrimiento de zona horaria).
const comoFecha = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(`${v.slice(0, 10)}T00:00:00Z`) : v);

function valorCelda(tipo, v) {
  if (v == null || v === '') return null;
  if (tipo === 'clp' || tipo === 'entero') return Number(v);
  if (tipo === 'fecha') return comoFecha(v);
  return String(v);
}

/**
 * Agrega una hoja con título, líneas de contexto (filtros, período), una tabla con encabezado y fila de totales.
 * @param {ExcelJS.Workbook} libro
 * @param {string} nombre             nombre de la hoja (máx. 31 caracteres)
 * @param {object} d
 * @param {string} d.titulo           primera fila, en grande
 * @param {string[]} [d.contexto]     líneas bajo el título (período, sucursal, quién generó…)
 * @param {{header:string, key:string, tipo:'texto'|'entero'|'clp'|'fecha', suma?:boolean}[]} d.columnas
 * @param {object[]} d.filas
 */
export function agregarHoja(libro, nombre, d) {
  const hoja = libro.addWorksheet(nombre.slice(0, 31), { views: [{ showGridLines: false }] });
  const n = d.columnas.length;

  hoja.mergeCells(1, 1, 1, Math.max(n, 2));
  const titulo = hoja.getCell(1, 1);
  titulo.value = d.titulo;
  titulo.font = { bold: true, size: 14, color: { argb: AZUL } };
  hoja.getRow(1).height = 24;
  let fila = 2;
  for (const linea of d.contexto ?? []) {
    hoja.mergeCells(fila, 1, fila, Math.max(n, 2));
    hoja.getCell(fila, 1).value = linea;
    hoja.getCell(fila, 1).font = { color: { argb: 'FF6C757D' }, size: 10 };
    fila += 1;
  }
  fila += 1; // línea en blanco

  const filaEncabezado = fila;
  d.columnas.forEach((c, i) => {
    const celda = hoja.getCell(filaEncabezado, i + 1);
    celda.value = c.header;
    celda.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
    celda.alignment = { horizontal: c.tipo === 'texto' ? 'left' : 'right', vertical: 'middle' };
  });
  hoja.getRow(filaEncabezado).height = 20;

  d.filas.forEach((r, j) => {
    const f = filaEncabezado + 1 + j;
    d.columnas.forEach((c, i) => {
      const celda = hoja.getCell(f, i + 1);
      celda.value = valorCelda(c.tipo, r[c.key]);
      celda.numFmt = FORMATO[c.tipo] ?? '@';
      celda.alignment = { horizontal: c.tipo === 'texto' ? 'left' : 'right' };
      if (j % 2 === 1) celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS } };
    });
  });

  // Totales con fórmula SUM: si se filtra o edita la hoja, siguen siendo coherentes.
  const hayTotales = d.columnas.some((c) => c.suma) && d.filas.length > 0;
  if (hayTotales) {
    const f = filaEncabezado + 1 + d.filas.length;
    d.columnas.forEach((c, i) => {
      const celda = hoja.getCell(f, i + 1);
      celda.font = { bold: true };
      celda.border = { top: { style: 'medium', color: { argb: AZUL } } };
      if (i === 0) celda.value = 'Total';
      if (c.suma) {
        const col = hoja.getColumn(i + 1).letter;
        celda.value = { formula: `SUM(${col}${filaEncabezado + 1}:${col}${f - 1})` };
        celda.numFmt = FORMATO[c.tipo];
        celda.alignment = { horizontal: 'right' };
      }
    });
  }

  // Ancho de columna según el contenido (con tope), para que se lea sin ajustar a mano.
  d.columnas.forEach((c, i) => {
    const largos = [c.header.length, ...d.filas.slice(0, 200).map((r) => {
      const v = r[c.key];
      if (v == null) return 0;
      return c.tipo === 'clp' ? String(Math.round(Number(v))).length + 4 : String(v).length;
    })];
    hoja.getColumn(i + 1).width = Math.min(Math.max(...largos) + 3, 48);
  });

  hoja.views = [{ state: 'frozen', ySplit: filaEncabezado, showGridLines: false }];
  if (d.filas.length) hoja.autoFilter = { from: { row: filaEncabezado, column: 1 }, to: { row: filaEncabezado + d.filas.length, column: n } };
  return hoja;
}

// Hoja de pares etiqueta/valor (resumen de un turno, datos de una orden…). `filas`: [[etiqueta, valor, tipo?]].
export function agregarFicha(libro, nombre, { titulo, filas }) {
  const hoja = libro.addWorksheet(nombre.slice(0, 31), { views: [{ showGridLines: false }] });
  hoja.mergeCells(1, 1, 1, 2);
  hoja.getCell(1, 1).value = titulo;
  hoja.getCell(1, 1).font = { bold: true, size: 14, color: { argb: AZUL } };
  hoja.getRow(1).height = 24;
  filas.forEach(([etiqueta, valor, tipo = 'texto', negrita = false], i) => {
    const f = 3 + i;
    const a = hoja.getCell(f, 1);
    const b = hoja.getCell(f, 2);
    a.value = etiqueta;
    a.font = { bold: true, color: { argb: 'FF495057' } };
    a.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS } };
    b.value = valorCelda(tipo, valor);
    b.numFmt = FORMATO[tipo] ?? '@';
    b.alignment = { horizontal: tipo === 'texto' ? 'left' : 'right' };
    if (negrita) b.font = { bold: true };
  });
  hoja.getColumn(1).width = Math.min(Math.max(...filas.map((f) => String(f[0]).length)) + 3, 46);
  hoja.getColumn(2).width = Math.min(Math.max(18, ...filas.map((f) => String(f[1] ?? '').length + 3)), 60);
  return hoja;
}

export async function libroAArchivo(libro, archivo) {
  const buffer = await libro.xlsx.writeBuffer();
  return { archivo, tipo: TIPO_XLSX, base64: Buffer.from(buffer).toString('base64') };
}
