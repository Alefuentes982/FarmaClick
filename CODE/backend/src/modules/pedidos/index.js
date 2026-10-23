import { pool } from '../../core/db.js';
import routes from './routes.js';

export default {
  nombre: 'pedidos',
  modulo: 'pedidos',
  rutas: [{ ruta: '/api/pedidos', router: routes }],
  catalogos: {
    estados_pedido: async () => (await pool.query('SELECT id, nombre FROM estado_pedido ORDER BY nombre')).rows,
    canales_venta: async () => (await pool.query('SELECT id, nombre, requiere_turno FROM canal_venta ORDER BY nombre')).rows,
    medios_pago: async () => (await pool.query('SELECT id, nombre FROM medio_pago WHERE activo ORDER BY nombre')).rows,
    // Pedidos a distancia solo se despachan desde sucursales que habilitan venta web.
    sucursales_venta_web: async () => (await pool.query(
      'SELECT id, nombre FROM sucursal WHERE activa AND habilita_venta_web ORDER BY nombre')).rows,
    comunas: async () => (await pool.query('SELECT id, nombre FROM comuna ORDER BY nombre')).rows,
  },
};
