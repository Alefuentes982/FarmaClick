import test from 'node:test';
import assert from 'node:assert/strict';
import { cotizacionSchema, devolucionSchema } from './esquemas.js';
import { codigoDevolucion, cotizarDevolucion, distribuirReembolso, montoReembolso } from './servicio.js';

const id = (n) => `00000000-0000-4000-8000-00000000000${n}`;

test('codigoDevolucion da formato DEV-000123', () => {
  assert.equal(codigoDevolucion(12), 'DEV-000012');
});

test('el reembolso en partes suma exactamente el subtotal de la línea', () => {
  const subtotal = 13536; // 10 unidades con descuento
  const partes = [3, 3, 4];
  let devuelto = 0;
  let suma = 0;
  for (const devolver of partes) {
    suma += montoReembolso({ subtotal, cantidad: 10, devuelto, devolver });
    devuelto += devolver;
  }
  assert.equal(suma, subtotal);
  assert.equal(montoReembolso({ subtotal: 1547, cantidad: 1, devuelto: 0, devolver: 1 }), 1547);
  assert.equal(montoReembolso({ subtotal: 100, cantidad: 3, devuelto: 0, devolver: 1 }), 33);
});

test('distribuirReembolso reparte por medio en orden y sin exceder el saldo', () => {
  const medios = [{ medio_pago_id: 'a', disponible: 3000 }, { medio_pago_id: 'b', disponible: 10000 }];
  assert.deepEqual(distribuirReembolso(2000, medios), [{ medio_pago_id: 'a', monto: 2000 }]);
  assert.deepEqual(distribuirReembolso(5000, medios), [{ medio_pago_id: 'a', monto: 3000 }, { medio_pago_id: 'b', monto: 2000 }]);
  assert.deepEqual(distribuirReembolso(0, medios), []);
});

test('cotizarDevolucion calcula por línea y rechaza más de lo disponible', () => {
  const pedido = {
    lineas: [{ detalle_id: id(1), producto_id: id(2), nombre_producto: 'X', cantidad: 10, devuelto: 4, disponible: 6, subtotal: 13536 }],
    medios: [{ medio_pago_id: id(3), disponible: 20000 }],
  };
  const c = cotizarDevolucion(pedido, [{ detalle_id: id(1), cantidad: 2, reingresa_stock: true }]);
  assert.equal(c.total, montoReembolso({ subtotal: 13536, cantidad: 10, devuelto: 4, devolver: 2 }));
  assert.equal(c.lineas[0].reingresa_stock, true);
  assert.deepEqual(c.sugerencia, [{ medio_pago_id: id(3), monto: c.total }]);
  assert.throws(() => cotizarDevolucion(pedido, [{ detalle_id: id(1), cantidad: 7 }]), /solo quedan 6/);
  assert.throws(() => cotizarDevolucion(pedido, [{ detalle_id: id(9), cantidad: 1 }]), /no pertenece/);
});

test('esquemas: el stock no se reingresa por defecto y el motivo es obligatorio', () => {
  const base = { pedido_id: id(1), items: [{ detalle_id: id(2), cantidad: 1 }], motivo: 'Producto dañado', reembolsos: [{ medio_pago_id: id(3), monto: 1500 }] };
  assert.equal(devolucionSchema.parse(base).items[0].reingresa_stock, false);
  assert.equal(devolucionSchema.safeParse({ ...base, motivo: ' ' }).success, false);
  assert.equal(devolucionSchema.safeParse({ ...base, reembolsos: [] }).success, false);
  assert.equal(devolucionSchema.safeParse({ ...base, items: [] }).success, false);
  assert.equal(cotizacionSchema.safeParse({ pedido_id: id(1), items: [{ detalle_id: id(2), cantidad: 0 }] }).success, false);
});

// ---- Devolución con redondeo del efectivo (Ley 20.956) ----
import { distribuirReembolso as distribuir, validarReembolso } from './servicio.js';

const medios = (efectivo, tarjeta) => [
  { medio_pago_id: 'ef', medio_pago: 'Efectivo', disponible: efectivo },
  { medio_pago_id: 'tj', medio_pago: 'Débito', disponible: tarjeta },
];

test('el efectivo se sugiere redondeado y el resto de la devolución va por tarjeta', () => {
  assert.deepEqual(distribuir(1547, medios(3090, 0)), [{ medio_pago_id: 'ef', monto: 1550 }]);
  assert.deepEqual(distribuir(3094, medios(3090, 0)), [{ medio_pago_id: 'ef', monto: 3090 }]);
  assert.deepEqual(distribuir(3094, medios(1000, 3094)), [{ medio_pago_id: 'ef', monto: 1000 }, { medio_pago_id: 'tj', monto: 2094 }]);
});

test('el efectivo devuelto nunca pasa de lo disponible en efectivo', () => {
  assert.deepEqual(distribuir(1547, medios(1540, 0)), [{ medio_pago_id: 'ef', monto: 1540 }]);
});

test('validarReembolso calcula el redondeo y exige el efectivo redondeado', () => {
  const m = medios(3090, 0);
  assert.equal(validarReembolso({ total: 3094, reembolsos: [{ medio_pago_id: 'ef', monto: 3090 }], medios: m }), -4);
  assert.equal(validarReembolso({ total: 1547, reembolsos: [{ medio_pago_id: 'ef', monto: 1550 }], medios: m }), 3);
  assert.throws(() => validarReembolso({ total: 3094, reembolsos: [{ medio_pago_id: 'ef', monto: 3094 }], medios: m }), /efectivo a devolver es \$3\.090/);
});

test('validarReembolso: sin efectivo calza exacto; con tope disponible se respeta', () => {
  assert.equal(validarReembolso({ total: 2094, reembolsos: [{ medio_pago_id: 'tj', monto: 2094 }], medios: medios(0, 2094) }), 0);
  assert.throws(() => validarReembolso({ total: 2094, reembolsos: [{ medio_pago_id: 'tj', monto: 2090 }], medios: medios(0, 2094) }), /suman \$2\.090/);
  assert.equal(validarReembolso({ total: 1547, reembolsos: [{ medio_pago_id: 'ef', monto: 1540 }], medios: medios(1540, 0) }), -7);
});
