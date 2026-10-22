import PedidoDetalle from './PedidoDetalle.jsx';
import PedidoForm from './PedidoForm.jsx';
import Pedidos from './Pedidos.jsx';

export default {
  nombre: 'pedidos',
  modulo: 'pedidos',
  nav: [{ to: '/pedidos', label: 'Pedidos', icon: 'bi-bag-check', orden: 40 }],
  rutas: [
    { path: '/pedidos', element: <Pedidos /> },
    { path: '/pedidos/nuevo', element: <PedidoForm /> },
    { path: '/pedidos/:id', element: <PedidoDetalle /> },
    { path: '/pedidos/:id/editar', element: <PedidoForm /> },
  ],
};
