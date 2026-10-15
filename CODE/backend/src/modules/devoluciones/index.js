import routes from './routes.js';

// Motivos habituales; se guardan como texto libre en la devolución.
const MOTIVOS = ['Producto defectuoso o dañado', 'Error de despacho', 'Cliente se arrepintió', 'Reacción adversa', 'Otro'];

export default {
  nombre: 'devoluciones',
  modulo: 'devoluciones', // permiso propio: devolver dinero es una operación sensible
  rutas: [{ ruta: '/api/devoluciones', router: routes }],
  catalogos: {
    motivos_devolucion: async () => MOTIVOS.map((nombre) => ({ nombre })),
  },
};
