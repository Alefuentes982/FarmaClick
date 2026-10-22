import ProveedorForm from './ProveedorForm.jsx';
import Proveedores from './Proveedores.jsx';

export default {
  nombre: 'proveedores',
  modulo: 'proveedores',
  nav: [{ to: '/proveedores', label: 'Proveedores', icon: 'bi-truck', orden: 20 }],
  rutas: [
    { path: '/proveedores', element: <Proveedores /> },
    { path: '/proveedores/nuevo', element: <ProveedorForm /> },
    { path: '/proveedores/:id', element: <ProveedorForm /> },
  ],
};
