import AccionCaja from './AccionCaja.jsx';
import DevolucionDetalle from './DevolucionDetalle.jsx';
import Devoluciones from './Devoluciones.jsx';
import NuevaDevolucion from './NuevaDevolucion.jsx';
import PedidoDevoluciones from './PedidoDevoluciones.jsx';

export default {
  nombre: 'devoluciones',
  modulo: 'devoluciones',
  nav: [{ to: '/devoluciones', label: 'Devoluciones', icon: 'bi-arrow-return-left', orden: 45 }],
  rutas: [
    { path: '/devoluciones', element: <Devoluciones /> },
    { path: '/devoluciones/nueva', element: <NuevaDevolucion /> },
    { path: '/devoluciones/:id', element: <DevolucionDetalle /> },
  ],
  // Secciones que este módulo agrega a pantallas de otros: la ficha del pedido y la barra de la caja.
  extensiones: { 'pedido.detalle': PedidoDevoluciones, 'pos.acciones': AccionCaja },
};
