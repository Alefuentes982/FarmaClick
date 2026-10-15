import test from 'node:test';
import assert from 'node:assert/strict';
import { filtrosDevolviblesSchema } from './esquemas.js';

test('los filtros vacíos se ignoran y los montos llegan como número', () => {
  const vacios = filtrosDevolviblesSchema.parse({ q: '', producto: '', medio_pago_id: '', sucursal_id: '', monto_desde: '', monto_hasta: '' });
  assert.ok(Object.values(vacios).every((v) => v === undefined));
  const f = filtrosDevolviblesSchema.parse({ q: ' PED-000012 ', monto_desde: '1000', monto_hasta: '5000' });
  assert.equal(f.q, 'PED-000012');
  assert.equal(f.monto_desde, 1000);
  assert.equal(f.monto_hasta, 5000);
});

test('rechaza montos negativos, rangos invertidos e identificadores inválidos', () => {
  assert.equal(filtrosDevolviblesSchema.safeParse({ monto_desde: '-5' }).success, false);
  assert.equal(filtrosDevolviblesSchema.safeParse({ monto_desde: '5000', monto_hasta: '1000' }).success, false);
  assert.equal(filtrosDevolviblesSchema.safeParse({ monto_desde: 'abc' }).success, false);
  assert.equal(filtrosDevolviblesSchema.safeParse({ medio_pago_id: 'no-es-uuid' }).success, false);
});
