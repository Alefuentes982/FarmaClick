import routes from './routes.js';

export default {
  nombre: 'proveedores',
  modulo: 'proveedores',
  lectura: ['inventario'], // quien gestiona productos puede consultar proveedores
  rutas: [{ ruta: '/api/proveedores', router: routes }],
};
