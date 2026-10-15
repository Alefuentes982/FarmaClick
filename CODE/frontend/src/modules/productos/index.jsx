import ProductoForm from './ProductoForm.jsx';
import Productos from './Productos.jsx';
import ProductosDeProveedor from './ProductosDeProveedor.jsx';

export default {
  nombre: 'productos',
  modulo: 'inventario',
  nav: [{ to: '/productos', label: 'Productos', icon: 'bi-capsule', orden: 10 }],
  rutas: [
    { path: '/productos', element: <Productos /> },
    { path: '/productos/nuevo', element: <ProductoForm /> },
    { path: '/productos/:id', element: <ProductoForm /> },
  ],
  extensiones: { 'proveedor.ficha': ProductosDeProveedor }, // sección en la ficha del proveedor
};
