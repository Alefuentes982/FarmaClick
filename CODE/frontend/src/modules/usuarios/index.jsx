import Roles from './Roles.jsx';
import UsuarioForm from './UsuarioForm.jsx';
import Usuarios from './Usuarios.jsx';

export default {
  nombre: 'usuarios',
  modulo: 'usuarios', // clave de permiso (tabla modulo)
  nav: [{ to: '/usuarios', label: 'Usuarios', icon: 'bi-people', orden: 90 }],
  rutas: [
    { path: '/usuarios', element: <Usuarios /> },
    { path: '/usuarios/nuevo', element: <UsuarioForm /> },
    { path: '/usuarios/roles', element: <Roles /> },
    { path: '/usuarios/:id', element: <UsuarioForm /> },
  ],
};
