import test from 'node:test';
import assert from 'node:assert/strict';
import { ajusteRedondeo, aCentavos, redondearEfectivo } from './redondeo.js';

const r = (pesos) => redondearEfectivo(aCentavos(pesos)) / 100;

test('Ley 20.956: terminaciones 1 a 4 bajan y 5 a 9 suben al múltiplo de $10', () => {
  assert.deepEqual([3091, 3092, 3093, 3094].map(r), [3090, 3090, 3090, 3090]);
  assert.deepEqual([3095, 3096, 3097, 3098, 3099].map(r), [3100, 3100, 3100, 3100, 3100]);
  assert.deepEqual([3090, 3100, 0].map(r), [3090, 3100, 0]);
});

test('el ajuste es negativo si se cobra de menos y positivo si se cobra de más', () => {
  assert.equal(ajusteRedondeo(1547), 3);
  assert.equal(ajusteRedondeo(3094), -4);
  assert.equal(ajusteRedondeo(3095), 5);
  assert.equal(ajusteRedondeo(3090), 0);
});

test('los cálculos en centavos no arrastran errores de coma flotante', () => {
  assert.equal(aCentavos(0.1 + 0.2), 30);
  assert.equal(r(1234.5), 1230);
  assert.equal(r(1235), 1240);
});
