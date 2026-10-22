import test from 'node:test';
import assert from 'node:assert/strict';
import { arqueoSchema, cierreForzadoSchema, correccionSchema, observacionSchema } from './esquemas.js';

test('la corrección exige campo válido, monto no negativo y motivo de al menos 10 caracteres', () => {
  const ok = correccionSchema.parse({ campo: 'apertura', monto: 50000, motivo: '  Error de digitación al abrir  ' });
  assert.equal(ok.motivo, 'Error de digitación al abrir');
  assert.equal(correccionSchema.safeParse({ campo: 'cierre', monto: 0, motivo: 'Contado mal digitado' }).success, true);
  assert.equal(correccionSchema.safeParse({ campo: 'esperado', monto: 1, motivo: 'no se puede corregir el esperado' }).success, false);
  assert.equal(correccionSchema.safeParse({ campo: 'apertura', monto: -1, motivo: 'monto negativo no válido' }).success, false);
  assert.equal(correccionSchema.safeParse({ campo: 'apertura', monto: 1, motivo: 'corto' }).success, false);
  assert.equal(correccionSchema.safeParse({ campo: 'apertura', monto: '50000', motivo: 'monto como texto no' }).success, false);
});

test('la observación no puede ir vacía', () => {
  assert.equal(observacionSchema.safeParse({ texto: '   ' }).success, false);
  assert.equal(observacionSchema.parse({ texto: ' Arqueo verificado ' }).texto, 'Arqueo verificado');
});

test('el cierre por fuerza mayor exige monto y motivo; el arqueo, solo el monto', () => {
  assert.equal(cierreForzadoSchema.safeParse({ monto: 52000, motivo: 'La cajera se retiró enferma' }).success, true);
  assert.equal(cierreForzadoSchema.safeParse({ monto: 52000, motivo: 'enferma' }).success, false);
  assert.equal(cierreForzadoSchema.safeParse({ monto: -1, motivo: 'La cajera se retiró enferma' }).success, false);
  assert.equal(arqueoSchema.safeParse({ monto: 0 }).success, true);
  assert.equal(arqueoSchema.parse({ monto: 1000, observacion: '' }).observacion, null);
});
