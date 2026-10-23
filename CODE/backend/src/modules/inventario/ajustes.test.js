import test from 'node:test';
import assert from 'node:assert/strict';
import { ajusteSchema } from './ajustes.js';

const base = {
  sucursal_id: '6f9f1c2e-0b1d-4c3a-9a55-0d6f3c7a1b11',
  producto_id: '3b241101-e2bb-4255-8caf-4136c566a962',
  cantidad: 5,
  observacion: 'Conteo físico',
};
const lote = '8d0f7780-8536-41d8-9c7a-1a2b3c4d5e6f';
const mensajes = (datos) => ajusteSchema.safeParse(datos).error?.issues.map((i) => i.message) ?? [];

test('ajuste positivo acepta lote existente o lote nuevo', () => {
  assert.equal(ajusteSchema.safeParse({ ...base, motivo: 'Ajuste positivo', lote_id: lote }).success, true);
  assert.equal(ajusteSchema.safeParse({ ...base, motivo: 'Ajuste positivo', lote_nuevo: { numero_lote: 'L1', fecha_vencimiento: '2030-01-01' } }).success, true);
});

test('ajuste positivo exige lote y no admite ambos', () => {
  assert.equal(ajusteSchema.safeParse({ ...base, motivo: 'Ajuste positivo' }).success, false);
  assert.equal(ajusteSchema.safeParse({ ...base, motivo: 'Ajuste positivo', lote_id: lote, lote_nuevo: {} }).success, false);
});

test('merma y ajuste negativo exigen lote existente y no pueden crear uno', () => {
  assert.equal(ajusteSchema.safeParse({ ...base, motivo: 'Merma', lote_id: lote }).success, true);
  assert.equal(ajusteSchema.safeParse({ ...base, motivo: 'Merma' }).success, false);
  assert.equal(ajusteSchema.safeParse({ ...base, motivo: 'Ajuste negativo', lote_id: lote, lote_nuevo: {} }).success, false);
});

test('la observación es obligatoria y la cantidad positiva', () => {
  assert.ok(mensajes({ ...base, motivo: 'Merma', lote_id: lote, observacion: ' ' }).length > 0);
  assert.ok(mensajes({ ...base, motivo: 'Merma', lote_id: lote, cantidad: 0 }).length > 0);
  assert.equal(ajusteSchema.safeParse({ ...base, motivo: 'Venta', lote_id: lote }).success, false); // motivo no manual
});
