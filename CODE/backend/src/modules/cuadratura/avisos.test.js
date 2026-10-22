import test from 'node:test';
import assert from 'node:assert/strict';
import { recordatorioQueCorresponde as r } from './avisos.js';

test('los recordatorios salen 60 y 30 minutos antes de las 23:59, una sola vez cada uno', () => {
  assert.equal(r(120, []), null);
  assert.deepEqual(r(60, []), [60, 'recordatorio_60']);
  assert.deepEqual(r(45, []), [60, 'recordatorio_60']);
  assert.equal(r(45, ['recordatorio_60']), null);
  assert.deepEqual(r(30, ['recordatorio_60']), [30, 'recordatorio_30']);
  assert.deepEqual(r(5, []), [30, 'recordatorio_30']);           // la API partió tarde: solo el de 30
  assert.equal(r(5, ['recordatorio_30']), null);
  assert.equal(r(50, ['recordatorio_30']), null);                // nunca el de 60 después del de 30
  assert.equal(r(-1, []), null);                                 // pasada la hora: corresponde el cierre automático
});
