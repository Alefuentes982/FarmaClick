import { pool } from '../../core/db.js';
import ajustes from './ajustes.js';
import kardex from './kardex.js';
import lotes from './lotes.js';
import stock from './stock.js';

// Motivos que una persona puede registrar a mano; el resto los generan las recepciones, las ventas y los jobs.
const MANUALES = ['Ajuste positivo', 'Ajuste negativo', 'Merma'];

export default {
  nombre: 'inventario',
  modulo: 'inventario', // misma clave que productos: quien gestiona productos gestiona su stock
  rutas: [
    { ruta: '/api/inventario/stock', router: stock },
    { ruta: '/api/inventario/lotes', router: lotes },
    { ruta: '/api/inventario/kardex', router: kardex },
    { ruta: '/api/inventario/ajustes', router: ajustes },
  ],
  catalogos: {
    motivos_movimiento: async () => (await pool.query(
      `SELECT mm.id, mm.nombre, t.nombre AS tipo, t.signo, (mm.nombre = ANY($1::text[])) AS manual
         FROM motivo_movimiento mm JOIN tipo_movimiento t ON t.id = mm.tipo_movimiento_id
        WHERE mm.activo ORDER BY t.signo DESC, mm.nombre`, [MANUALES])).rows,
  },
};
