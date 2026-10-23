import OrdenCompraDetalle from './OrdenCompraDetalle.jsx';
import OrdenCompraForm from './OrdenCompraForm.jsx';
import OrdenesCompra from './OrdenesCompra.jsx';

export default {
  nombre: 'ordenes-compra',
  modulo: 'proveedores',
  nav: [{ to: '/ordenes-compra', label: 'Órdenes de compra', icon: 'bi-clipboard-check', orden: 30 }],
  rutas: [
    { path: '/ordenes-compra', element: <OrdenesCompra /> },
    { path: '/ordenes-compra/nueva', element: <OrdenCompraForm /> },
    { path: '/ordenes-compra/:id', element: <OrdenCompraDetalle /> },
    { path: '/ordenes-compra/:id/editar', element: <OrdenCompraForm /> },
  ],
};
