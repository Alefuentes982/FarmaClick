// Turnos de caja. Reglas que impone la base: un solo turno abierto por caja y por usuario, el turno no se edita
// con UPDATE (se cierra con fn_cerrar_turno) y solo quien lo abrió puede cerrarlo; las excepciones son el cierre
// automático de las 23:59 y el cierre por fuerza mayor (ver cuadratura y la migración 010).
import { HttpError, notFound } from '../../core/errors.js';

export async function turnoAbierto(db, usuarioId) {
  const { rows } = await db.query(
    `SELECT t.id, t.fecha_apertura, t.monto_apertura_efectivo, c.id AS caja_id, c.numero AS caja_numero,
            s.id AS sucursal_id, s.nombre AS sucursal, s.farmacia_de_turno
       FROM turno_caja t JOIN caja c ON c.id = t.caja_id JOIN sucursal s ON s.id = c.sucursal_id
      WHERE t.usuario_id = $1 AND t.fecha_cierre IS NULL`, [usuarioId]);
  return rows[0] ?? null;
}

// Ventas y cobros del turno. Ventas anuladas (canceladas o expiradas) no cuentan.
export async function resumenTurno(db, turnoId) {
  const [ventas, medios, devoluciones] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::int AS ventas, COALESCE(SUM(p.total), 0) AS total
         FROM pedido p JOIN estado_pedido e ON e.id = p.estado_pedido_id
        WHERE p.turno_caja_id = $1 AND e.nombre NOT IN ('Cancelado', 'Expirado')`, [turnoId]),
    db.query(
      `SELECT mp.nombre AS medio_pago, SUM(tp.monto) AS monto
         FROM transaccion_pago tp
         JOIN pedido p ON p.id = tp.pedido_id
         JOIN medio_pago mp ON mp.id = tp.medio_pago_id
         JOIN estado_transaccion et ON et.id = tp.estado_transaccion_id AND et.nombre = 'Aprobado'
        WHERE p.turno_caja_id = $1 GROUP BY mp.nombre ORDER BY mp.nombre`, [turnoId]),
    // Devoluciones hechas desde la caja de este turno; el efectivo devuelto se descuenta del esperado al cerrar.
    db.query(
      `SELECT (SELECT COUNT(*)::int FROM devolucion WHERE turno_caja_id = $1) AS cantidad,
              (SELECT COALESCE(SUM(total_reembolso), 0) FROM devolucion WHERE turno_caja_id = $1) AS total,
              (SELECT COALESCE(SUM(dp.monto), 0) FROM devolucion d
                 JOIN devolucion_pago dp ON dp.devolucion_id = d.id
                 JOIN medio_pago mp ON mp.id = dp.medio_pago_id AND mp.nombre = 'Efectivo'
                WHERE d.turno_caja_id = $1) AS efectivo`, [turnoId]),
  ]);
  return { ventas: ventas.rows[0].ventas, total: ventas.rows[0].total, por_medio: medios.rows, devoluciones: devoluciones.rows[0] };
}

export async function abrirTurno(db, usuario, { caja_id: cajaId, monto_apertura_efectivo: monto }) {
  const { rows } = await db.query('SELECT id, numero, activa, sucursal_id FROM caja WHERE id = $1', [cajaId]);
  const caja = rows[0];
  if (!caja) throw notFound('Caja');
  if (!caja.activa) throw new HttpError(409, 'La caja está desactivada.');
  if (usuario.sucursal_id && usuario.sucursal_id !== caja.sucursal_id) {
    throw new HttpError(403, 'Su usuario pertenece a otra sucursal: no puede abrir esta caja.');
  }
  if (await turnoAbierto(db, usuario.id)) throw new HttpError(409, 'Ya tiene un turno abierto: ciérrelo antes de abrir otro.');
  const ocupada = await db.query(
    `SELECT u.nombre FROM turno_caja t JOIN usuario u ON u.id = t.usuario_id
      WHERE t.caja_id = $1 AND t.fecha_cierre IS NULL`, [cajaId]);
  if (ocupada.rows[0]) throw new HttpError(409, `La caja ${caja.numero} ya tiene un turno abierto (${ocupada.rows[0].nombre}).`);
  const ins = await db.query(
    'INSERT INTO turno_caja (usuario_id, caja_id, monto_apertura_efectivo) VALUES ($1,$2,$3) RETURNING id',
    [usuario.id, cajaId, monto]);
  return ins.rows[0].id;
}

// Cierra el turno con el efectivo contado. fn_cerrar_turno congela el esperado (apertura + efectivo aprobado de las
// ventas del turno) y devuelve contado - esperado: positivo = sobra, negativo = falta.
export async function cerrarTurno(db, usuarioId, turnoId, contado) {
  const { rows } = await db.query('SELECT usuario_id, fecha_cierre FROM turno_caja WHERE id = $1', [turnoId]);
  if (!rows[0]) throw notFound('Turno');
  if (rows[0].usuario_id !== usuarioId) throw new HttpError(403, 'Solo quien abrió el turno puede cerrarlo.');
  if (rows[0].fecha_cierre) throw new HttpError(409, 'El turno ya está cerrado.');
  const dif = await db.query('SELECT fn_cerrar_turno($1, $2) AS diferencia', [turnoId, contado]);
  const t = await db.query(
    'SELECT fecha_cierre, monto_cierre_esperado_efectivo AS esperado, monto_cierre_real_efectivo AS contado FROM turno_caja WHERE id = $1', [turnoId]);
  return { diferencia: Number(dif.rows[0].diferencia), esperado: Number(t.rows[0].esperado), contado: Number(t.rows[0].contado), fecha_cierre: t.rows[0].fecha_cierre };
}
