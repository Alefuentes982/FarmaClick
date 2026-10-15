import { pool } from '../../core/db.js';
import routes from './routes.js';

export default {
  nombre: 'productos',
  modulo: 'inventario',
  lectura: ['proveedores'], // las órdenes de compra necesitan consultar productos
  rutas: [{ ruta: '/api/productos', router: routes }],
  catalogos: {
    categorias: async () => (await pool.query(
      'SELECT id, nombre, margen_pesimista, margen_probable, margen_optimista FROM categoria ORDER BY nombre')).rows,
    condiciones_venta: async () => (await pool.query(
      'SELECT id, nombre, permite_venta_online FROM condicion_venta WHERE activa ORDER BY nombre')).rows,
  },
};
