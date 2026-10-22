import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizarRut } from './rut.js';

test('normaliza RUT válido', () => {
  assert.equal(normalizarRut('12.345.678-5'), '12345678-5');
  assert.equal(normalizarRut('123456785'), '12345678-5');
  assert.equal(normalizarRut('76.086.428-5'), '76086428-5');
});

test('rechaza dígito verificador incorrecto o formato inválido', () => {
  assert.equal(normalizarRut('12.345.678-9'), null);
  assert.equal(normalizarRut('abc'), null);
});
