// Núcleo de venta: lo usan el módulo de pedidos (backoffice), la caja (venta presencial, parte 7) y la tienda en
// línea (parte 10). Todas las funciones reciben `db`, un cliente dentro de una transacción abierta con
// withTx(usuarioId, …): fn_reservar_pedido y fn_liberar_reserva exigen app.usuario_id.
//
// Reglas que impone la base y que este servicio respeta:
//  - Precio, nombre y descuento de cada línea los fija el trigger; los totales del pedido, también.
//  - Las líneas solo se tocan en "Pago pendiente" y sin stock reservado.
//  - Reservar descuenta stock por FEFO (movimientos "Venta"); liberar lo devuelve ("Liberación de reserva").
import { pool } from '../../core/db.js';
import { HttpError, notFound } from '../../core/errors.js';
import { formatoNumero } from '../../core/documentos.js';
import { aCentavos, aPesos, pesos, redondearEfectivo } from '../../core/redondeo.js';

export const ESTADO = {
  PENDIENTE: 'Pago pendiente', PAGADO: 'Pagado', PREPARACION: 'En preparación', RETIRO: 'Listo para retiro',
  DESPACHO: 'En despacho', ENTREGADO: 'Entregado', CANCELADO: 'Cancelado', EXPIRADO: 'Expirado',
};

// Avance manual después del pago.
export const SIGUIENTES = {
  [ESTADO.PAGADO]: [ESTADO.PREPARACION],
  [ESTADO.PREPARACION]: [ESTADO.RETIRO, ESTADO.DESPACHO],
  [ESTADO.RETIRO]: [ESTADO.ENTREGADO],
  [ESTADO.DESPACHO]: [ESTADO.ENTREGADO],
};
// Hasta "Listo para retiro" aún se puede deshacer la venta; en despacho o entregado ya salió de la tienda.
const CANCELABLES = [ESTADO.PENDIENTE, ESTADO.PAGADO, ESTADO.PREPARACION, ESTADO.RETIRO];

export const codigoPedido = (numero) => formatoNumero('PED', numero);

// Acciones que el usuario puede ejecutar sobre un pedido; la interfaz solo muestra estas.
export function accionesDisponibles({ estado, reservado }) {
  const acciones = [];
  if (estado === ESTADO.PENDIENTE) {
    acciones.push('editar');
    if (!reservado) acciones.push('reservar');
    acciones.push('pagar');
  }
  if (CANCELABLES.includes(estado)) acciones.push('cancelar');
  (SIGUIENTES[estado] ?? []).forEach((s) => acciones.push(`estado:${s}`));
  return acciones;
}

export async function estadoPedidoId(db, nombre) {
  const { rows } = await db.query('SELECT id FROM estado_pedido WHERE nombre = $1', [nombre]);
  if (!rows[0]) throw new HttpError(500, `Falta el estado de pedido "${nombre}".`);
  return rows[0].id;
}

// Unidades netas movidas por el pedido en el kardex: negativo = hay stock reservado/vendido.
export async function stockReservado(db, pedidoId) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(m.cantidad * t.signo), 0)::int AS neto
       FROM movimiento_inventario m
       JOIN motivo_movimiento mm ON mm.id = m.motivo_movimiento_id
       JOIN tipo_movimiento t ON t.id = mm.tipo_movimiento_id
      WHERE m.pedido_id = $1`, [pedidoId]);
  return rows[0].neto < 0;
}

// Bloquea el pedido (mismo orden que fn_reservar_pedido: pedido primero) y devuelve lo necesario para decidir.
export async function bloquearPedido(db, id) {
  const { rows } = await db.query(
    `SELECT p.id, p.numero, p.total, p.sucursal_id, p.fecha, e.nombre AS estado, cv.nombre AS canal, cv.requiere_turno
       FROM pedido p
       JOIN estado_pedido e ON e.id = p.estado_pedido_id
       JOIN canal_venta cv ON cv.id = p.canal_venta_id
      WHERE p.id = $1 FOR UPDATE OF p`, [id]);
  if (!rows[0]) throw notFound('Pedido');
  return rows[0];
}

export async function reservarStock(db, pedidoId) {
  try {
    await db.query('SELECT fn_reservar_pedido($1)', [pedidoId]);
  } catch (err) {
    const m = String(err.message).match(/Stock insuficiente para el producto ([0-9a-f-]{36})/);
    if (!m) throw err;
    // La transacción quedó abortada: el nombre se busca por otra conexión.
    const { rows } = await pool.query('SELECT nombre FROM producto WHERE id = $1', [m[1]]);
    throw new HttpError(409, `Stock insuficiente de "${rows[0]?.nombre ?? 'un producto'}" en la sucursal del pedido.`);
  }
}

export const liberarReserva = (db, pedidoId) => db.query('SELECT fn_liberar_reserva($1)', [pedidoId]);

// Regla de descuento vigente para la cantidad (la más específica y, a igualdad, la de mayor porcentaje).
// El trigger de la línea la valida y calcula el monto.
async function reglaAplicable(db, productoId, cantidad) {
  const { rows } = await db.query(
    `SELECT r.id FROM regla_descuento r JOIN producto p ON p.id = $1
      WHERE r.activa AND (r.categoria_id IS NULL OR r.categoria_id = p.categoria_id)
        AND r.cantidad_minima <= $2 AND (r.cantidad_maxima IS NULL OR r.cantidad_maxima >= $2)
        AND (r.fecha_inicio IS NULL OR r.fecha_inicio <= NOW()) AND (r.fecha_fin IS NULL OR r.fecha_fin >= NOW())
      ORDER BY (r.categoria_id IS NULL), r.porcentaje_descuento DESC LIMIT 1`, [productoId, cantidad]);
  return rows[0]?.id ?? null;
}

async function insertarLineas(db, pedidoId, items) {
  for (const it of items) {
    await db.query(
      'INSERT INTO detalle_pedido (pedido_id, producto_id, cantidad, regla_descuento_id) VALUES ($1,$2,$3,$4)',
      [pedidoId, it.producto_id, it.cantidad, await reglaAplicable(db, it.producto_id, it.cantidad)]);
  }
}

/**
 * Crea un pedido "Pago pendiente" con sus líneas.
 * @param d      { sucursal_id, nombre_cliente, telefono, direccion_pedido, comuna_id, items:[{producto_id,cantidad}], reservar }
 * @param ctx    { canal: 'Online' | 'Presencial', usuarioId, turnoId?, clienteId? }  (Presencial exige turnoId; lo valida la base)
 */
export async function crearPedido(db, d, ctx) {
  const { rows: canal } = await db.query('SELECT id, requiere_turno FROM canal_venta WHERE nombre = $1', [ctx.canal]);
  if (!canal[0]) throw new HttpError(500, `Falta el canal de venta "${ctx.canal}".`);
  const { rows: suc } = await db.query('SELECT habilita_venta_web FROM sucursal WHERE id = $1 AND activa', [d.sucursal_id]);
  if (!suc[0]) throw notFound('Sucursal');
  if (!canal[0].requiere_turno && !suc[0].habilita_venta_web) {
    throw new HttpError(409, 'La sucursal no habilita ventas a distancia.');
  }
  const { rows } = await db.query(
    `INSERT INTO pedido (canal_venta_id, estado_pedido_id, nombre_cliente, direccion_pedido, telefono, comuna_id,
                         cliente_id, vendedor_id, sucursal_id, turno_caja_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [canal[0].id, await estadoPedidoId(db, ESTADO.PENDIENTE), d.nombre_cliente, d.direccion_pedido ?? null, d.telefono ?? null,
      d.comuna_id ?? null, ctx.clienteId ?? null, ctx.usuarioId, d.sucursal_id, ctx.turnoId ?? null]);
  await insertarLineas(db, rows[0].id, d.items);
  if (d.reservar) await reservarStock(db, rows[0].id);
  return rows[0].id;
}

// Reemplaza datos del cliente y líneas de un pedido pendiente. Si tenía stock reservado lo libera antes
// (la base no deja tocar líneas con reserva) y lo vuelve a reservar solo si se pide.
export async function reemplazarPedido(db, id, d) {
  const p = await bloquearPedido(db, id);
  if (p.estado !== ESTADO.PENDIENTE) throw new HttpError(409, 'Solo se puede modificar un pedido en "Pago pendiente".');
  if (p.sucursal_id !== d.sucursal_id) throw new HttpError(400, 'La sucursal de un pedido no se puede cambiar.');
  if (await stockReservado(db, id)) await liberarReserva(db, id);
  await db.query(
    'UPDATE pedido SET nombre_cliente = $1, telefono = $2, direccion_pedido = $3, comuna_id = $4 WHERE id = $5',
    [d.nombre_cliente, d.telefono ?? null, d.direccion_pedido ?? null, d.comuna_id ?? null, id]);
  await db.query('DELETE FROM detalle_pedido WHERE pedido_id = $1', [id]);
  await insertarLineas(db, id, d.items);
  if (d.reservar) await reservarStock(db, id);
}

export async function reservarPedido(db, id) {
  const p = await bloquearPedido(db, id);
  if (p.estado !== ESTADO.PENDIENTE) throw new HttpError(409, 'Solo se reserva stock de un pedido en "Pago pendiente".');
  if (await stockReservado(db, id)) throw new HttpError(409, 'El pedido ya tiene stock reservado.');
  await reservarStock(db, id);
}

// Reparto de un cobro entre medios de pago con el redondeo del efectivo (Ley 20.956). Los montos llegan en pesos.
//   - Sin efectivo, los pagos deben sumar exactamente el total.
//   - Con efectivo, lo que no se pagó por otros medios es el valor a cobrar en efectivo y lo recibido en efectivo
//     debe ser ese valor redondeado al múltiplo de $10 más cercano. La diferencia es el `redondeo` del pedido.
// Devuelve el redondeo en pesos, o lanza el error que corresponda.
export function validarCobro({ total, pagos, efectivoId }) {
  const totalC = aCentavos(total);
  const esEfectivo = (x) => x.medio_pago_id === efectivoId;
  const efectivoC = pagos.filter(esEfectivo).reduce((s, x) => s + aCentavos(x.monto), 0);
  const otrosC = pagos.filter((x) => !esEfectivo(x)).reduce((s, x) => s + aCentavos(x.monto), 0);
  if (!pagos.some(esEfectivo)) {
    if (otrosC !== totalC) throw new HttpError(409, `Los pagos suman ${pesos(aPesos(otrosC))} y el pedido es de ${pesos(aPesos(totalC))}.`);
    return 0;
  }
  const valorEfectivoC = totalC - otrosC; // lo que falta por cobrar, antes del redondeo
  if (valorEfectivoC <= 0) throw new HttpError(409, `Los otros medios ya cubren ${pesos(aPesos(otrosC))} de ${pesos(aPesos(totalC))}: no corresponde cobrar en efectivo.`);
  const esperadoC = redondearEfectivo(valorEfectivoC);
  if (esperadoC <= 0) {
    throw new HttpError(409, `El saldo de ${pesos(aPesos(valorEfectivoC))} se redondea a $0 en efectivo: páguelo con otro medio.`);
  }
  if (efectivoC !== esperadoC) {
    throw new HttpError(409, `El efectivo a cobrar es ${pesos(aPesos(esperadoC))} (${pesos(aPesos(valorEfectivoC))} redondeado según la Ley 20.956) y se informaron ${pesos(aPesos(efectivoC))}.`);
  }
  return aPesos(esperadoC - valorEfectivoC);
}

// Registra el pago (aprobado) y pasa el pedido a "Pagado". Reserva el stock si aún no lo estaba, de modo que la
// caja pueda crear, reservar y cobrar en una sola transacción. El efectivo se redondea (ver validarCobro).
export async function registrarPagos(db, id, pagos) {
  const p = await bloquearPedido(db, id);
  if (p.estado !== ESTADO.PENDIENTE) throw new HttpError(409, 'Solo se paga un pedido en "Pago pendiente".');
  if (aCentavos(p.total) <= 0) throw new HttpError(409, 'El pedido no tiene monto que cobrar.');
  const { rows: medios } = await db.query('SELECT id, nombre FROM medio_pago WHERE activo AND id = ANY($1::uuid[])', [pagos.map((x) => x.medio_pago_id)]);
  if (new Set(medios.map((m) => m.id)).size !== new Set(pagos.map((x) => x.medio_pago_id)).size) {
    throw new HttpError(400, 'Medio de pago no válido o inactivo.');
  }
  const efectivoId = medios.find((m) => m.nombre === 'Efectivo')?.id ?? null;
  const redondeo = validarCobro({ total: p.total, pagos, efectivoId });
  if (!(await stockReservado(db, id))) await reservarStock(db, id);
  const aprobado = await db.query("SELECT id FROM estado_transaccion WHERE nombre = 'Aprobado'");
  if (!aprobado.rows[0]) throw new HttpError(500, 'Falta el estado de transacción "Aprobado".');
  for (const x of pagos) {
    await db.query(
      `INSERT INTO transaccion_pago (pedido_id, medio_pago_id, estado_transaccion_id, monto, codigo_autorizacion)
       VALUES ($1,$2,$3,$4,$5)`, [id, x.medio_pago_id, aprobado.rows[0].id, x.monto, x.codigo_autorizacion ?? null]);
  }
  await db.query('UPDATE pedido SET redondeo = $1, estado_pedido_id = $2 WHERE id = $3', [redondeo, await estadoPedidoId(db, ESTADO.PAGADO), id]);
}

export async function cambiarEstado(db, id, nuevo) {
  const p = await bloquearPedido(db, id);
  if (!(SIGUIENTES[p.estado] ?? []).includes(nuevo)) {
    throw new HttpError(409, `No se puede pasar un pedido "${p.estado}" a "${nuevo}".`);
  }
  await db.query('UPDATE pedido SET estado_pedido_id = $1 WHERE id = $2', [await estadoPedidoId(db, nuevo), id]);
}

// Cancela: devuelve el stock reservado y anula los pagos aprobados (la devolución del dinero es externa al sistema).
export async function cancelarPedido(db, id) {
  const p = await bloquearPedido(db, id);
  if (!CANCELABLES.includes(p.estado)) throw new HttpError(409, `No se puede cancelar un pedido "${p.estado}".`);
  if (await stockReservado(db, id)) await liberarReserva(db, id);
  const anulado = await db.query("SELECT id FROM estado_transaccion WHERE nombre = 'Anulado'");
  const aprobado = await db.query("SELECT id FROM estado_transaccion WHERE nombre = 'Aprobado'");
  if (anulado.rows[0] && aprobado.rows[0]) {
    await db.query('UPDATE transaccion_pago SET estado_transaccion_id = $1 WHERE pedido_id = $2 AND estado_transaccion_id = $3',
      [anulado.rows[0].id, id, aprobado.rows[0].id]);
  }
  await db.query('UPDATE pedido SET estado_pedido_id = $1 WHERE id = $2', [await estadoPedidoId(db, ESTADO.CANCELADO), id]);
}

// Hace lo mismo que el job fn_liberar_reservas_vencidas (pg_cron): pedidos sin pagar pasados `minutos` se marcan
// "Expirado" y devuelven su stock. Salta los que otra transacción está procesando.
export async function expirarPendientes(db, minutos = 20) {
  const { rows } = await db.query(
    `SELECT p.id FROM pedido p JOIN estado_pedido e ON e.id = p.estado_pedido_id
      WHERE e.nombre = $1 AND p.fecha < NOW() - make_interval(mins => $2::int)
      ORDER BY p.id FOR UPDATE OF p SKIP LOCKED`, [ESTADO.PENDIENTE, minutos]);
  const expirado = await estadoPedidoId(db, ESTADO.EXPIRADO);
  for (const { id } of rows) {
    if (await stockReservado(db, id)) await liberarReserva(db, id);
    await db.query('UPDATE pedido SET estado_pedido_id = $1 WHERE id = $2', [expirado, id]);
  }
  return rows.length;
}

// Venta en mostrador: el cliente se lleva los productos en el acto, así que el pedido pagado pasa directo a "Entregado".
export async function entregarEnMostrador(db, id) {
  const p = await bloquearPedido(db, id);
  if (p.estado !== ESTADO.PAGADO) throw new HttpError(409, 'Solo se entrega un pedido pagado.');
  if (!p.requiere_turno) throw new HttpError(409, 'Solo las ventas presenciales se entregan en el acto.');
  await db.query('UPDATE pedido SET estado_pedido_id = $1 WHERE id = $2', [await estadoPedidoId(db, ESTADO.ENTREGADO), id]);
}

// Productos vendibles con su precio y stock disponible en una sucursal (buscador del pedido y de la caja).
// Por un canal a distancia solo se ofrecen los de condición de venta permitida online.
export async function buscarProductosVendibles(db, { sucursalId, q, remoto, limit = 20 }) {
  const { rows } = await db.query(
    `SELECT p.id, p.sku, p.nombre, p.precio, c.nombre AS categoria, cv.nombre AS condicion_venta,
            cv.permite_venta_online, COALESCE(sd.disponible, 0) AS disponible
       FROM producto p
       JOIN categoria c ON c.id = p.categoria_id
       JOIN condicion_venta cv ON cv.id = p.condicion_venta_id
       LEFT JOIN vw_stock_disponible sd ON sd.producto_id = p.id AND sd.sucursal_id = $1
      WHERE p.activo AND cv.activa AND (NOT $2::boolean OR cv.permite_venta_online)
        AND ($3::text IS NULL OR p.sku ILIKE $3 OR p.nombre ILIKE $3)
      ORDER BY (p.sku ILIKE $4) DESC, (COALESCE(sd.disponible, 0) > 0) DESC, p.nombre LIMIT $5`,
    [sucursalId ?? null, remoto, q ? `%${q.replace(/[\\%_]/g, '\\$&')}%` : null, q ? q.replace(/[\\%_]/g, '\\$&') : '', Math.min(limit, 50)]);
  return rows;
}

// Calcula líneas, descuentos y totales sin guardar nada (la caja lo muestra antes de cobrar). Usa la misma regla y el
// mismo redondeo que el trigger de la línea, así el total coincide con el del pedido que luego se crea.
export async function cotizar(db, items) {
  const lineas = [];
  for (const it of items) {
    const reglaId = await reglaAplicable(db, it.producto_id, it.cantidad);
    const { rows } = await db.query(
      `SELECT p.id AS producto_id, p.sku, p.nombre, p.precio, r.nombre AS regla,
              COALESCE(ROUND($2::numeric * p.precio * r.porcentaje_descuento / 100, 0), 0) AS descuento
         FROM producto p LEFT JOIN regla_descuento r ON r.id = $3 WHERE p.id = $1 AND p.activo`, [it.producto_id, it.cantidad, reglaId]);
    if (!rows[0]) throw new HttpError(409, 'Uno de los productos ya no está disponible para la venta.');
    const l = rows[0];
    lineas.push({
      producto_id: l.producto_id, sku: l.sku, nombre: l.nombre, cantidad: it.cantidad, precio_unitario: Number(l.precio),
      descuento: Number(l.descuento), regla: l.regla, subtotal: it.cantidad * Number(l.precio) - Number(l.descuento),
    });
  }
  const bruto = lineas.reduce((s, l) => s + l.cantidad * l.precio_unitario, 0);
  const total = lineas.reduce((s, l) => s + l.subtotal, 0);
  const neto = Math.round(total / 1.19);
  return { lineas, subtotal_bruto: bruto, descuento_total: bruto - total, total, subtotal_neto: neto, iva: total - neto };
}

// Pedido completo para la ficha, el comprobante y la caja.
export async function detallePedido(db, id) {
  const { rows } = await db.query(
    `SELECT p.id, p.numero, p.fecha, p.subtotal_bruto, p.total, p.subtotal_neto, p.iva, p.redondeo,
            p.nombre_cliente, p.telefono, p.direccion_pedido, p.comuna_id, c.nombre AS comuna,
            e.nombre AS estado, p.estado_pedido_id, cv.nombre AS canal, cv.requiere_turno,
            p.sucursal_id, s.nombre AS sucursal, s.direccion AS sucursal_direccion, s.telefono AS sucursal_telefono,
            p.vendedor_id, u.nombre AS vendedor, p.turno_caja_id
       FROM pedido p
       JOIN estado_pedido e ON e.id = p.estado_pedido_id
       JOIN canal_venta cv ON cv.id = p.canal_venta_id
       LEFT JOIN sucursal s ON s.id = p.sucursal_id
       LEFT JOIN comuna c ON c.id = p.comuna_id
       LEFT JOIN usuario u ON u.id = p.vendedor_id
      WHERE p.id = $1`, [id]);
  if (!rows[0]) throw notFound('Pedido');
  const [lineas, pagos, reservado] = await Promise.all([
    db.query(
      `SELECT d.id, d.producto_id, p.sku, d.nombre_producto, d.cantidad, d.precio_unitario, d.descuento_monto,
              (d.cantidad * d.precio_unitario - d.descuento_monto) AS subtotal, r.nombre AS regla
         FROM detalle_pedido d JOIN producto p ON p.id = d.producto_id LEFT JOIN regla_descuento r ON r.id = d.regla_descuento_id
        WHERE d.pedido_id = $1 ORDER BY d.nombre_producto`, [id]),
    db.query(
      `SELECT t.id, t.fecha_transaccion, t.monto, t.codigo_autorizacion, mp.nombre AS medio_pago, et.nombre AS estado
         FROM transaccion_pago t JOIN medio_pago mp ON mp.id = t.medio_pago_id JOIN estado_transaccion et ON et.id = t.estado_transaccion_id
        WHERE t.pedido_id = $1 ORDER BY t.fecha_transaccion`, [id]),
    stockReservado(db, id),
  ]);
  const pedido = rows[0];
  return {
    ...pedido,
    codigo: codigoPedido(pedido.numero),
    descuento_total: Number(pedido.subtotal_bruto) - Number(pedido.total),
    lineas: lineas.rows,
    pagos: pagos.rows,
    stock_reservado: reservado,
    acciones: accionesDisponibles({ estado: pedido.estado, reservado }),
  };
}
