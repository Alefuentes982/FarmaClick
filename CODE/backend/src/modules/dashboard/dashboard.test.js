import test from 'node:test';
import assert from 'node:assert/strict';
import { anchosColumnas, archivoInforme, celdaCsv, formatoCelda, generarCsv, periodoTexto } from './exportar.js';
import { buscarInforme, ejecutarInforme, INFORMES, puedeVer } from './informes.js';

test('el catálogo tiene ids únicos y columnas bien definidas', () => {
  assert.equal(new Set(INFORMES.map((i) => i.id)).size, INFORMES.length);
  for (const i of INFORMES) {
    assert.ok(i.columnas.length > 0 && typeof i.consulta === 'function', i.id);
    for (const c of i.columnas) assert.ok(['texto', 'entero', 'clp', 'fecha'].includes(c.tipo), `${i.id}.${c.key}`);
  }
});

test('cada consulta recibe los parámetros que usa', () => {
  const f = { desde: '2026-10-01', hasta: '2026-10-31', sucursal_id: null, dias: 60, limite: 10 };
  for (const i of INFORMES) {
    const { text, values } = i.consulta(f);
    const usados = Math.max(...[...text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
    assert.equal(values.length, usados, i.id);
  }
});

test('los informes de inventario y compras exigen su permiso además del dashboard', () => {
  const vendedor = { permisos: ['dashboard', 'pos'] };
  const bodega = { permisos: ['dashboard', 'inventario', 'proveedores'] };
  assert.equal(puedeVer(vendedor, buscarInforme('top-productos')), true);
  assert.equal(puedeVer(vendedor, buscarInforme('stock-bajo-minimo')), false);
  assert.equal(puedeVer(vendedor, buscarInforme('compras-por-proveedor')), false);
  assert.equal(puedeVer(bodega, buscarInforme('lotes-por-vencer')), true);
});

test('ejecutarInforme convierte números, aplica la fila y suma las columnas marcadas', async () => {
  const db = { query: async () => ({ rows: [
    { numero: '12', proveedor: 'A', sucursal: 'S', estado: 'Pendiente', fecha_esperada: '2026-10-01', dias_atraso: 3, total: '1000.00' },
    { numero: '13', proveedor: 'B', sucursal: 'S', estado: 'Pendiente', fecha_esperada: null, dias_atraso: 0, total: '500.00' },
  ] }) };
  const r = await ejecutarInforme(db, buscarInforme('ordenes-pendientes'), {});
  assert.equal(r.filas[0].codigo, 'OC-000012');
  assert.equal(r.filas[0].total, 1000);
  assert.deepEqual(r.totales, { total: 1500 });
});

test('CSV: separador ;, comillas, BOM y sin fórmulas ejecutables', () => {
  assert.equal(celdaCsv('texto', 'a;b'), '"a;b"');
  assert.equal(celdaCsv('texto', 'dice "hola"'), '"dice ""hola"""');
  assert.equal(celdaCsv('texto', '=SUMA(A1)'), "'=SUMA(A1)");
  assert.equal(celdaCsv('clp', -1500), '-1500');
  assert.equal(celdaCsv('fecha', '2026-10-04'), '04-10-2026');
  assert.equal(celdaCsv('texto', null), '');
  const csv = generarCsv({ columnas: [{ key: 'p', header: 'Producto', tipo: 'texto' }, { key: 'n', header: 'Neto', tipo: 'clp' }], filas: [{ p: 'Paracetamol', n: 2500 }] });
  assert.equal(csv, '﻿Producto;Neto\r\nParacetamol;2500\r\n');
});

test('formatos del PDF y anchos de columna', () => {
  assert.equal(formatoCelda('entero', 1234567), '1.234.567');
  assert.match(formatoCelda('clp', 1500), /1\.500/);
  assert.equal(formatoCelda('fecha', '2026-10-04'), '04-10-2026');
  const a = anchosColumnas([{ tipo: 'texto' }, { tipo: 'clp' }, { tipo: 'entero' }]);
  assert.ok(Math.abs(a.reduce((x, y) => x + y, 0) - 1) < 1e-9);
  assert.equal(a[0], 0.5);
  assert.equal(periodoTexto({ desde: '2026-10-01', hasta: '2026-10-31' }), '01-10-2026 al 31-10-2026');
  assert.equal(periodoTexto({}), 'Todo el período');
});

test('el PDF y el CSV se entregan como JSON con base64', async () => {
  const informe = { id: 'x', titulo: 'Prueba', grupo: 'Ventas', fechas: true, totales: { n: 3 },
    columnas: [{ key: 'p', header: 'Producto', tipo: 'texto' }, { key: 'n', header: 'Neto', tipo: 'clp', suma: true }], filas: [{ p: 'A', n: 3 }] };
  const f = { desde: '2026-10-01', hasta: '2026-10-02', sucursal_nombre: null };
  const csv = await archivoInforme(informe, 'csv', f);
  assert.equal(csv.archivo, 'x_2026-10-01_2026-10-02.csv');
  assert.match(Buffer.from(csv.base64, 'base64').toString('utf8'), /Producto;Neto/);
  const pdf = await archivoInforme(informe, 'pdf', f);
  assert.equal(pdf.tipo, 'application/pdf');
  assert.equal(Buffer.from(pdf.base64, 'base64').subarray(0, 4).toString(), '%PDF');
});
