import Dashboard from './Dashboard.jsx';

export default {
  nombre: 'dashboard',
  modulo: 'dashboard',
  nav: [{ to: '/dashboard', label: 'Dashboard', icon: 'bi-speedometer2', orden: 1 }],
  rutas: [{ path: '/dashboard', element: <Dashboard /> }],
};
