import Ajuste from './Ajuste.jsx';
import Kardex from './Kardex.jsx';
import Lotes from './Lotes.jsx';
import Stock from './Stock.jsx';

export default {
  nombre: 'inventario',
  modulo: 'inventario',
  nav: [{ to: '/inventario', label: 'Inventario', icon: 'bi-boxes', orden: 15 }],
  rutas: [
    { path: '/inventario', element: <Stock /> },
    { path: '/inventario/lotes', element: <Lotes /> },
    { path: '/inventario/kardex', element: <Kardex /> },
    { path: '/inventario/ajuste', element: <Ajuste /> },
  ],
};
