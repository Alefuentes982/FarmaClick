import test from 'node:test';
import assert from 'node:assert/strict';
import { aperturaSchema, cierreSchema, ventaSchema } from './esquemas.js';

const id = (n) => `00000000-0000-4000-8000-00000000000${n}`;

test('apertura exige caja y efectivo inicial no negativo', () => {
  assert.equal(aperturaSchema.safeParse({ caja_id: id(1), monto_apertura_efectivo: 20000 }).success, true);
  assert.equal(aperturaSchema.safeParse({ caja_id: id(1), monto_apertura_efectivo: 0 }).success, true);
  assert.equal(aperturaSchema.safeParse({ caja_id: id(1), monto_apertura_efectivo: -1 }).success, false);
  assert.equal(aperturaSchema.safeParse({ monto_apertura_efectivo: 10 }).success, false);
});

test('cierre exige el efectivo contado', () => {
  assert.equal(cierreSchema.safeParse({ monto_contado: 0 }).success, true);
  assert.equal(cierreSchema.safeParse({ monto_contado: -5 }).success, false);
  assert.equal(cierreSchema.safeParse({}).success, false);
});

test('venta exige líneas y pagos; el cliente es opcional', () => {
  const base = { items: [{ producto_id: id(2), cantidad: 1 }], pagos: [{ medio_pago_id: id(3), monto: 1500 }] };
  assert.equal(ventaSchema.parse(base).nombre_cliente, null);
  assert.equal(ventaSchema.safeParse({ ...base, items: [] }).success, false);
  assert.equal(ventaSchema.safeParse({ ...base, pagos: [] }).success, false);
  assert.equal(ventaSchema.safeParse({ ...base, items: [{ producto_id: id(2), cantidad: 1 }, { producto_id: id(2), cantidad: 2 }] }).success, false);
});
