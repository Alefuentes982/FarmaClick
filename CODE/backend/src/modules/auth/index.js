import routes from './routes.js';

// Inicio de sesión (público); /auth/me exige sesión por dentro.
export default { nombre: 'auth', publico: true, rutas: [{ ruta: '/api/auth', router: routes }] };
