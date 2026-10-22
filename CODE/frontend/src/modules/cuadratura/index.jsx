import Cuadratura from './Cuadratura.jsx';
import TarjetaCaja from './TarjetaCaja.jsx';
import TurnoDetalle from './TurnoDetalle.jsx';

export default {
  nombre: 'cuadratura',
  modulo: 'cuadratura',
  nav: [{ to: '/cuadratura', label: 'Cuadratura', icon: 'bi-calculator', orden: 6 }],
  rutas: [
    { path: '/cuadratura', element: <Cuadratura /> },
    { path: '/cuadratura/:id', element: <TurnoDetalle /> },
  ],
  extensiones: { 'dashboard.tarjetas': TarjetaCaja },
};
