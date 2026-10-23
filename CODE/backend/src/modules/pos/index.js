import { pool } from '../../core/db.js';
import routes from './routes.js';

export default {
  nombre: 'pos',
  modulo: 'pos',
  rutas: [{ ruta: '/api/pos', router: routes }],
  catalogos: {
    // En el mostrador no se cobra por la pasarela web.
    medios_pago_caja: async () => (await pool.query("SELECT id, nombre FROM medio_pago WHERE activo AND nombre <> 'Webpay Plus' ORDER BY nombre")).rows,
  },
};
