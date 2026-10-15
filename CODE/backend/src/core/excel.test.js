import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { agregarFicha, agregarHoja, libroAArchivo, nuevoLibro, TIPO_XLSX } from './excel.js';

const columnas = [
  { header: 'Producto', key: 'p', tipo: 'texto' },
  { header: 'Unidades', key: 'u', tipo: 'entero', suma: true },
  { header: 'Venta', key: 'v', tipo: 'clp', suma: true },
  { header: 'Fecha', key: 'f', tipo: 'fecha' },
];

async function releer(libro) {
  const { base64, tipo, archivo } = await libroAArchivo(libro, 'prueba.xlsx');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(base64, 'base64'));
  return { wb, tipo, archivo };
}

test('la hoja trae título, contexto, encabezado, filas con formato y totales con fórmula', async () => {
  const libro = nuevoLibro();
  agregarHoja(libro, 'Ventas', {
    titulo: 'Ventas del período', contexto: ['Período: hoy'], columnas,
    filas: [{ p: 'Paracetamol', u: '3', v: 2088, f: '2026-10-04' }, { p: 'Ibuprofeno', u: 2, v: 1800.4, f: null }],
  });
  const { wb, tipo, archivo } = await releer(libro);
  assert.equal(tipo, TIPO_XLSX);
  assert.equal(archivo, 'prueba.xlsx');
  const h = wb.getWorksheet('Ventas');
  assert.equal(h.getCell(1, 1).value, 'Ventas del período');
  assert.equal(h.getCell(2, 1).value, 'Período: hoy');
  assert.equal(h.getCell(4, 1).value, 'Producto'); // fila de encabezado: título, contexto y una línea en blanco
  assert.equal(h.getCell(5, 2).value, 3); // el texto numérico se guarda como número
  assert.equal(h.getCell(5, 3).numFmt, '"$"#,##0');
  assert.ok(h.getCell(5, 4).value instanceof Date && h.getCell(5, 4).numFmt === 'dd-mm-yyyy', 'la fecha es una fecha real de Excel');
  assert.equal(h.getCell(6, 4).value, null);
  const total = h.getRow(7);
  assert.equal(total.getCell(1).value, 'Total');
  assert.equal(total.getCell(2).value.formula, 'SUM(B5:B6)');
  assert.equal(total.getCell(3).value.formula, 'SUM(C5:C6)');
});

test('sin filas no hay fila de totales ni filtro; el nombre de la hoja se limita a 31 caracteres', async () => {
  const libro = nuevoLibro();
  agregarHoja(libro, 'Un nombre de hoja demasiado largo para Excel', { titulo: 'Vacía', columnas, filas: [] });
  const { wb } = await releer(libro);
  const h = wb.worksheets[0];
  assert.equal(h.name.length, 31);
  assert.equal(h.rowCount, 3); // título, línea en blanco y encabezado
});

test('la ficha escribe pares etiqueta/valor con su tipo', async () => {
  const libro = nuevoLibro();
  agregarFicha(libro, 'Turno', { titulo: 'Turno · Caja 1', filas: [['Cajero', 'Vera'], ['Esperado', 11390, 'clp', true], ['Ventas', 4, 'entero']] });
  const { wb } = await releer(libro);
  const h = wb.getWorksheet('Turno');
  assert.equal(h.getCell(3, 1).value, 'Cajero');
  assert.equal(h.getCell(4, 2).value, 11390);
  assert.equal(h.getCell(4, 2).numFmt, '"$"#,##0');
  assert.equal(h.getCell(5, 2).numFmt, '#,##0');
});
