import test from 'node:test';
import assert from 'node:assert/strict';
import { formatoNumero } from './documentos.js';

test('formatoNumero rellena con ceros', () => {
  assert.equal(formatoNumero('OC', 1), 'OC-000001');
  assert.equal(formatoNumero('OC', '123'), 'OC-000123');
});
