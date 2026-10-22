import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUpdate, likeParam, listResponse, paging } from './sql.js';

test('likeParam escapa comodines y devuelve null si no hay texto', () => {
  assert.equal(likeParam('  '), null);
  assert.equal(likeParam('abc'), '%abc%');
  assert.equal(likeParam('50%_'), '%50\\%\\_%');
});

test('paging limita y calcula el desplazamiento', () => {
  assert.deepEqual(paging({}), { limit: 20, page: 1, offset: 0 });
  assert.deepEqual(paging({ limit: '10', page: '3' }), { limit: 10, page: 3, offset: 20 });
  assert.equal(paging({ limit: '9999' }).limit, 500);
});

test('buildUpdate arma el UPDATE con las claves recibidas', () => {
  assert.equal(buildUpdate('proveedor', {}, 'x'), null);
  assert.deepEqual(buildUpdate('proveedor', { nombre: 'A', rut: '1-9' }, 'id1'),
    { text: 'UPDATE proveedor SET nombre = $1, rut = $2 WHERE id = $3', values: ['A', '1-9', 'id1'] });
});

test('listResponse separa el total de las filas', () => {
  assert.deepEqual(listResponse([{ id: 1, total_filas: '7', total: '100.00' }], { page: 1, limit: 20 }),
    { data: [{ id: 1, total: '100.00' }], total: 7, page: 1, limit: 20 });
});
