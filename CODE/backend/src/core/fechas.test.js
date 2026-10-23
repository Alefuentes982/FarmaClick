import test from 'node:test';
import assert from 'node:assert/strict';
import { rangoFechas } from './fechas.js';

test('rangoFechas acepta vacíos y rangos válidos', () => {
  assert.deepEqual(rangoFechas({}), { desde: null, hasta: null });
  assert.deepEqual(rangoFechas({ desde: '2026-10-01', hasta: '2026-10-31' }), { desde: '2026-10-01', hasta: '2026-10-31' });
  assert.deepEqual(rangoFechas({ desde: '2026-10-01', hasta: '' }), { desde: '2026-10-01', hasta: null });
});

test('rangoFechas rechaza formato inválido y rango invertido', () => {
  assert.throws(() => rangoFechas({ desde: 'hoy' }));
  assert.throws(() => rangoFechas({ desde: '2026-12-01', hasta: '2026-01-01' }));
});
