// Registro de módulos del backend. Cada módulo es una carpeta con un index.js que exporta:
//   nombre     identificador del módulo
//   modulo     clave de permiso (tabla modulo / rol_permiso); obligatoria salvo que sea `publico`
//   lectura    otras claves que también pueden hacer GET (consulta cruzada entre módulos)
//   publico    true = sin sesión (login hoy; tienda en línea más adelante)
//   rutas      [{ ruta: '/api/...', router }]
//   catalogos  { nombre: async () => filas } listas de apoyo que se sirven en GET /api/catalogos
// Sumar un módulo = crear su carpeta y agregarlo aquí.
import auth from './auth/index.js';
import usuarios from './usuarios/index.js';
import proveedores from './proveedores/index.js';
import productos from './productos/index.js';
import ordenesCompra from './ordenes-compra/index.js';
import inventario from './inventario/index.js';
import pedidos from './pedidos/index.js';
import pos from './pos/index.js';
import devoluciones from './devoluciones/index.js';
import cuadratura from './cuadratura/index.js';
import dashboard from './dashboard/index.js';

export default [auth, usuarios, proveedores, productos, ordenesCompra, inventario, pedidos, pos, devoluciones, cuadratura, dashboard];
