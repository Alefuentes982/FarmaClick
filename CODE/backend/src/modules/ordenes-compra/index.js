import { pool } from '../../core/db.js';
import routes from './routes.js';

export default {
  nombre: 'ordenes-compra',
  modulo: 'proveedores',
  rutas: [{ ruta: '/api/ordenes-compra', router: routes }],
  catalogos: {
    estados_orden_compra: async () => (await pool.query('SELECT id, nombre FROM estado_orden_compra ORDER BY nombre')).rows,
  },
};
