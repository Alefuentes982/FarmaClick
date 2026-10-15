import { pool } from '../../core/db.js';
import roles from './roles.js';
import usuarios from './usuarios.js';

export default {
  nombre: 'usuarios',
  modulo: 'usuarios', // clave en la tabla modulo / rol_permiso
  rutas: [
    { ruta: '/api/usuarios', router: usuarios },
    { ruta: '/api/roles', router: roles },
  ],
  catalogos: {
    sucursales: async () => (await pool.query('SELECT id, nombre FROM sucursal WHERE activa ORDER BY nombre')).rows,
  },
};
