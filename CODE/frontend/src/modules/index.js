// Registro de módulos del frontend. Cada módulo es una carpeta con un index.jsx que exporta:
//   nombre, modulo (clave de permiso), nav [{ to, label, icon, orden }], rutas [{ path, element }]
//   extensiones { 'slot': Componente } (opcional: contenido que inyecta en pantallas de otros módulos)
// Sumar un módulo = crear su carpeta y agregarlo aquí.
import { registrarExtensiones } from '../extensiones.jsx';
import usuarios from './usuarios/index.jsx';
import proveedores from './proveedores/index.jsx';
import productos from './productos/index.jsx';
import ordenesCompra from './ordenes-compra/index.jsx';
import inventario from './inventario/index.jsx';
import pedidos from './pedidos/index.jsx';
import pos from './pos/index.jsx';
import devoluciones from './devoluciones/index.jsx';
import cuadratura from './cuadratura/index.jsx';
import dashboard from './dashboard/index.jsx';

const modulos = [usuarios, proveedores, productos, ordenesCompra, inventario, pedidos, pos, devoluciones, cuadratura, dashboard];
modulos.forEach((m) => registrarExtensiones(m.nombre, m.extensiones));

export default modulos;
