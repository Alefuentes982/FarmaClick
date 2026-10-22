import test from 'node:test';
import assert from 'node:assert/strict';
import { estadoSchema, pagosSchema, pedidoSchema } from './esquemas.js';
import { accionesDisponibles, codigoPedido, ESTADO } from './servicio.js';

const id = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const base = { sucursal_id: id(1), nombre_cliente: 'Ana Pérez', items: [{ producto_id: id(2), cantidad: 2 }] };

test('codigoPedido da formato PED-000123', () => {
  assert.equal(codigoPedido(7), 'PED-000007');
});

test('acciones por estado', () => {
  assert.deepEqual(accionesDisponibles({ estado: ESTADO.PENDIENTE, reservado: false }), ['editar', 'reservar', 'pagar', 'cancelar']);
  assert.deepEqual(accionesDisponibles({ estado: ESTADO.PENDIENTE, reservado: true }), ['editar', 'pagar', 'cancelar']);
  assert.deepEqual(accionesDisponibles({ estado: ESTADO.PAGADO, reservado: true }), ['cancelar', 'estado:En preparación']);
  assert.deepEqual(accionesDisponibles({ estado: ESTADO.PREPARACION, reservado: true }), ['cancelar', 'estado:Listo para retiro', 'estado:En despacho']);
  assert.deepEqual(accionesDisponibles({ estado: ESTADO.DESPACHO, reservado: true }), ['estado:Entregado']);
  assert.deepEqual(accionesDisponibles({ estado: ESTADO.ENTREGADO, reservado: true }), []);
  assert.deepEqual(accionesDisponibles({ estado: ESTADO.CANCELADO, reservado: false }), []);
  assert.deepEqual(accionesDisponibles({ estado: ESTADO.EXPIRADO, reservado: false }), []);
});

test('pedidoSchema valida cliente y líneas', () => {
  const ok = pedidoSchema.parse(base);
  assert.equal(ok.reservar, false);
  assert.equal(ok.telefono, null);
  assert.equal(pedidoSchema.safeParse({ ...base, nombre_cliente: ' ' }).success, false);
  assert.equal(pedidoSchema.safeParse({ ...base, items: [] }).success, false);
  assert.equal(pedidoSchema.safeParse({ ...base, items: [{ producto_id: id(2), cantidad: 0 }] }).success, false);
  assert.equal(pedidoSchema.safeParse({ ...base, items: [{ producto_id: id(2), cantidad: 1 }, { producto_id: id(2), cantidad: 1 }] }).success, false);
});

test('pagosSchema exige al menos un pago con monto positivo', () => {
  assert.equal(pagosSchema.safeParse({ pagos: [] }).success, false);
  assert.equal(pagosSchema.safeParse({ pagos: [{ medio_pago_id: id(3), monto: 0 }] }).success, false);
  assert.equal(pagosSchema.safeParse({ pagos: [{ medio_pago_id: id(3), monto: 1500 }, { medio_pago_id: id(4), monto: 500 }] }).success, true);
  assert.equal(estadoSchema.safeParse({ estado: '' }).success, false);
});

// ---- Cobro con redondeo del efectivo (Ley 20.956) ----
import { validarCobro } from './servicio.js';

const EF = 'ef';
const TJ = 'tj';
const cobro = (total, pagos) => validarCobro({ total, pagos, efectivoId: EF });

test('cobro solo en efectivo: se cobra el total redondeado y el ajuste queda registrado', () => {
  assert.equal(cobro(3094, [{ medio_pago_id: EF, monto: 3090 }]), -4);
  assert.equal(cobro(1547, [{ medio_pago_id: EF, monto: 1550 }]), 3);
  assert.equal(cobro(3090, [{ medio_pago_id: EF, monto: 3090 }]), 0);
});

test('el efectivo informado debe ser exactamente el redondeado', () => {
  assert.throws(() => cobro(3094, [{ medio_pago_id: EF, monto: 3094 }]), /efectivo a cobrar es \$3\.090/);
  assert.throws(() => cobro(3094, [{ medio_pago_id: EF, monto: 3100 }]), /efectivo a cobrar es \$3\.090/);
});

test('con tarjeta no hay redondeo y debe calzar exacto', () => {
  assert.equal(cobro(3094, [{ medio_pago_id: TJ, monto: 3094 }]), 0);
  assert.throws(() => cobro(3094, [{ medio_pago_id: TJ, monto: 3090 }]), /suman \$3\.090 y el pedido es de \$3\.094/);
});

test('pago mixto: el redondeo se aplica solo a lo que se paga en efectivo', () => {
  // 3.094 = 1.000 con tarjeta + 2.094 en efectivo -> 2.090
  assert.equal(cobro(3094, [{ medio_pago_id: TJ, monto: 1000 }, { medio_pago_id: EF, monto: 2090 }]), -4);
  assert.equal(cobro(3095, [{ medio_pago_id: TJ, monto: 1000 }, { medio_pago_id: EF, monto: 2100 }]), 5);
  assert.throws(() => cobro(3094, [{ medio_pago_id: TJ, monto: 1000 }, { medio_pago_id: EF, monto: 2094 }]), /efectivo a cobrar es \$2\.090/);
});

test('un saldo en efectivo que se redondea a cero, o ya cubierto por otros medios, se rechaza', () => {
  assert.throws(() => cobro(3094, [{ medio_pago_id: TJ, monto: 3091 }, { medio_pago_id: EF, monto: 3 }]), /se redondea a \$0/);
  assert.throws(() => cobro(3094, [{ medio_pago_id: TJ, monto: 3094 }, { medio_pago_id: EF, monto: 10 }]), /ya cubren/);
});

test('varias líneas en efectivo se redondean juntas', () => {
  assert.equal(cobro(3094, [{ medio_pago_id: EF, monto: 1000 }, { medio_pago_id: EF, monto: 2090 }]), -4);
});
