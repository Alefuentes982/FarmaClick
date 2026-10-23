// Escritura en el kardex. Reglas del esquema que este módulo respeta:
//  - El kardex es inmutable y la cantidad es siempre positiva; el signo lo da tipo_movimiento.
//  - Los triggers mueven lote.cantidad_actual y stock_total_web; el backend no los escribe.
//  - Orden de bloqueo: primero el producto y luego el lote (igual que los triggers y fn_reservar_pedido),
//    para no provocar interbloqueos con otras operaciones.
import { HttpError, notFound } from '../../core/errors.js';

export async function motivoId(db, nombre) {
  const { rows } = await db.query('SELECT id FROM motivo_movimiento WHERE nombre = $1 AND activo', [nombre]);
  if (!rows[0]) throw new HttpError(500, `Falta el motivo de movimiento "${nombre}".`);
  return rows[0].id;
}

export async function bloquearProducto(db, productoId) {
  const { rows } = await db.query(
    'SELECT requiere_lote, requiere_vencimiento FROM producto WHERE id = $1 FOR UPDATE', [productoId]);
  if (!rows[0]) throw notFound('Producto');
  return rows[0];
}

// Bloquea y devuelve el lote con su estado de vencimiento calculado con el día de Chile.
export async function bloquearLote(db, loteId) {
  const { rows } = await db.query(
    `SELECT l.id, l.producto_id, l.sucursal_id, l.numero_lote, l.cantidad_actual, l.fecha_vencimiento,
            (l.fecha_vencimiento IS NOT NULL AND l.fecha_vencimiento < (NOW() AT TIME ZONE 'America/Santiago')::date) AS vencido
       FROM lote l WHERE l.id = $1 FOR UPDATE`, [loteId]);
  if (!rows[0]) throw notFound('Lote');
  return rows[0];
}

export async function insertarMovimiento(db, { productoId, sucursalId, cantidad, motivo, loteId, usuarioId, observacion = null, pedidoId = null }) {
  const { rows } = await db.query(
    `INSERT INTO movimiento_inventario (producto_id, sucursal_id, cantidad, motivo_movimiento_id, lote_id, usuario_id, observacion, pedido_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, fecha`,
    [productoId, sucursalId, cantidad, await motivoId(db, motivo), loteId, usuarioId, observacion, pedidoId]);
  return rows[0];
}

// Día de hoy en Chile (AAAA-MM-DD), el mismo criterio con que la base decide qué lote está vencido.
export async function hoyChile(db) {
  const { rows } = await db.query("SELECT to_char((NOW() AT TIME ZONE 'America/Santiago')::date, 'YYYY-MM-DD') AS d");
  return rows[0].d;
}
