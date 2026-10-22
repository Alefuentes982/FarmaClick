import Cajas from './Cajas.jsx';
import Pos from './Pos.jsx';

export default {
  nombre: 'pos',
  modulo: 'pos',
  nav: [{ to: '/pos', label: 'Caja', icon: 'bi-cash-stack', orden: 5 }],
  rutas: [
    { path: '/pos', element: <Pos /> },
    { path: '/pos/cajas', element: <Cajas /> },
  ],
};
