import test from 'node:test';
import assert from 'node:assert/strict';
import { revisionSchema } from './esquemas.js';
import { esSupervisor, turnosFiltrados } from './servicio.js';

const supervisor = { id: 'a', permisos: ['cuadratura', 'supervision_caja'] };
const administradorSinSupervision = { id: 'c', permisos: ['cuadratura', 'usuarios'] };
const cajero = { id: 'b', permisos: ['cuadratura', 'pos'] };

test('esSupervisor depende del permiso de supervisión de caja, no del de usuarios', () => {
  assert.equal(esSupervisor(supervisor), true);
  assert.equal(esSupervisor(cajero), false);
  assert.equal(esSupervisor(administradorSinSupervision), false);
});

test('un cajero solo consulta sus propios turnos aunque pida otros', () => {
  const { cte, params } = turnosFiltrados(cajero, { usuario_id: 'otro' }, null, null);
  assert.ok(cte.includes('t.usuario_id = $1'));
  assert.equal(params[0], 'b');
});

test('un administrador puede filtrar por cajero, sucursal y estado', () => {
  const { cte, params } = turnosFiltrados(supervisor, { usuario_id: 'u1', sucursal_id: 's1', estado: 'sin_revisar' }, '2026-10-01', null);
  assert.deepEqual(params.slice(0, 2), ['u1', 's1']);
  assert.ok(cte.includes('r.id IS NULL'));
  assert.ok(turnosFiltrados(supervisor, {}, null, null).cte.includes('fecha_apertura'));
});

test('la revisión con observaciones exige explicación', () => {
  assert.equal(revisionSchema.safeParse({ conforme: true }).success, true);
  assert.equal(revisionSchema.safeParse({ conforme: false }).success, false);
  assert.equal(revisionSchema.safeParse({ conforme: false, observacion: 'faltó sencillo' }).success, true);
});
