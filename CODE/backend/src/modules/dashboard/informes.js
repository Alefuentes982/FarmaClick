// Catálogo de informes del dashboard. Cada informe se define una sola vez (consulta + columnas) y de ahí salen
// la tabla de la pantalla, el CSV y el PDF, así las tres vistas nunca difieren. Todo es de solo lectura.
//
//   id, titulo, grupo, descripcion
//   permiso    clave adicional que exige (además de `dashboard`); sin ella, basta con dashboard
//   fechas     true si el informe respeta el rango desde/hasta
//   columnas   [{ key, header, tipo: 'texto' | 'entero' | 'clp' | 'fecha', suma? }]
//   consulta   (f) => ({ text, values })  con f = { desde, hasta, sucursal_id, dias, limite }
//   fila       (fila) => fila             ajuste opcional por fila (p. ej. armar el código OC-000123)
import { condicionRango } from '../../core/fechas.js';
import { formatoNumero } from '../../core/documentos.js';

// "Venta" = pedido pagado en adelante (un pedido pendiente, cancelado o expirado no es venta).
const VENDIDO = "e.nombre IN ('Pagado', 'En preparación', 'Listo para retiro', 'En despacho', 'Entregado')";
const DIA = (col) => `(${col} AT TIME ZONE 'America/Santiago')::date`;
const HOY = "(NOW() AT TIME ZONE 'America/Santiago')::date";
// Parámetros comunes de los informes con fechas: $1 desde, $2 hasta, $3 sucursal.
const rangoPedido = `${VENDIDO} AND ${condicionRango('p.fecha', 1, 2)} AND ($3::uuid IS NULL OR p.sucursal_id = $3)`;
const rangoDevolucion = `${condicionRango('dv.fecha', 1, 2)} AND ($3::uuid IS NULL OR p.sucursal_id = $3)`;
const valores = (f) => [f.desde, f.hasta, f.sucursal_id];

const COLS_VENTAS = (clave, header) => [
  { key: clave, header, tipo: 'texto' },
  { key: 'ventas', header: 'Ventas', tipo: 'entero', suma: true },
  { key: 'total_ventas', header: 'Total vendido', tipo: 'clp', suma: true },
  { key: 'devoluciones', header: 'Devol.', tipo: 'entero', suma: true },
  { key: 'total_devoluciones', header: 'Devuelto', tipo: 'clp', suma: true },
  { key: 'neto', header: 'Venta neta', tipo: 'clp', suma: true },
];

// Ventas y devoluciones agrupadas por algo que se deduce del pedido (canal, sucursal).
const porPedido = (join, etiqueta, columna) => (f) => ({
  text: `WITH v AS (SELECT ${etiqueta} AS grupo, COUNT(*)::int AS n, SUM(p.total) AS total
                      FROM pedido p JOIN estado_pedido e ON e.id = p.estado_pedido_id ${join}
                     WHERE ${rangoPedido} GROUP BY 1),
              d AS (SELECT ${etiqueta} AS grupo, COUNT(*)::int AS n, SUM(dv.total_reembolso) AS total
                      FROM devolucion dv JOIN pedido p ON p.id = dv.pedido_id ${join}
                     WHERE ${rangoDevolucion} GROUP BY 1)
         SELECT COALESCE(v.grupo, d.grupo) AS ${columna}, COALESCE(v.n, 0) AS ventas, COALESCE(v.total, 0) AS total_ventas,
                COALESCE(d.n, 0) AS devoluciones, COALESCE(d.total, 0) AS total_devoluciones,
                COALESCE(v.total, 0) - COALESCE(d.total, 0) AS neto
           FROM v FULL JOIN d ON d.grupo = v.grupo
          ORDER BY neto DESC, 1`,
  values: valores(f),
});

// Venta y devolución por producto, base de "top productos" y "por categoría". La venta de una línea es
// cantidad × precio − descuento (con IVA, igual que el total del pedido); lo devuelto, el reembolso prorrateado.
const PRODUCTOS = `
  l AS (SELECT dp.producto_id, SUM(dp.cantidad)::int AS uds, SUM(dp.cantidad * dp.precio_unitario - dp.descuento_monto) AS venta
          FROM detalle_pedido dp JOIN pedido p ON p.id = dp.pedido_id JOIN estado_pedido e ON e.id = p.estado_pedido_id
         WHERE ${rangoPedido} GROUP BY 1),
  r AS (SELECT dp.producto_id, SUM(dd.cantidad)::int AS uds, SUM(dd.monto_reembolso) AS monto
          FROM devolucion_detalle dd JOIN devolucion dv ON dv.id = dd.devolucion_id
          JOIN detalle_pedido dp ON dp.id = dd.detalle_pedido_id JOIN pedido p ON p.id = dv.pedido_id
         WHERE ${rangoDevolucion} GROUP BY 1),
  pp AS (SELECT pr.sku, pr.nombre AS producto, c.nombre AS categoria,
                COALESCE(l.uds, 0) AS unidades, COALESCE(r.uds, 0) AS unidades_devueltas,
                COALESCE(l.venta, 0) AS venta_bruta, COALESCE(r.monto, 0) AS devuelto,
                COALESCE(l.venta, 0) - COALESCE(r.monto, 0) AS neto
           FROM producto pr JOIN categoria c ON c.id = pr.categoria_id
           LEFT JOIN l ON l.producto_id = pr.id LEFT JOIN r ON r.producto_id = pr.id
          WHERE l.producto_id IS NOT NULL OR r.producto_id IS NOT NULL)`;

// Existencias por producto y sucursal, igual que el módulo de inventario: vendible = lotes sin vencer.
const CTE_STOCK = `
  agg AS (SELECT l.producto_id, l.sucursal_id,
                 COALESCE(SUM(l.cantidad_actual) FILTER (WHERE l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= ${HOY}), 0)::int AS disponible
            FROM lote l GROUP BY 1, 2)`;

export const INFORMES = [
  {
    id: 'ventas-diarias', titulo: 'Ventas por día', grupo: 'Ventas', fechas: true,
    descripcion: 'Ventas, devoluciones y venta neta de cada día (días de Chile).',
    columnas: COLS_VENTAS('fecha', 'Fecha').map((c) => (c.key === 'fecha' ? { ...c, tipo: 'fecha' } : c)),
    // Con ambas fechas se listan también los días sin movimiento, para que la serie no tenga saltos. La serie va en
    // timestamp sin zona: con timestamptz, el cambio de hora de Chile hace que un día se pierda o se repita.
    consulta: (f) => ({
      text: `WITH v AS (SELECT ${DIA('p.fecha')} AS dia, COUNT(*)::int AS n, SUM(p.total) AS total
                          FROM pedido p JOIN estado_pedido e ON e.id = p.estado_pedido_id
                         WHERE ${rangoPedido} GROUP BY 1),
                  d AS (SELECT ${DIA('dv.fecha')} AS dia, COUNT(*)::int AS n, SUM(dv.total_reembolso) AS total
                          FROM devolucion dv JOIN pedido p ON p.id = dv.pedido_id
                         WHERE ${rangoDevolucion} GROUP BY 1),
                  u AS (SELECT dia FROM v UNION SELECT dia FROM d),
                  dias AS (SELECT g::date AS dia
                             FROM generate_series(COALESCE($1::date, (SELECT MIN(dia) FROM u))::timestamp,
                                                  COALESCE($2::date, (SELECT MAX(dia) FROM u))::timestamp, '1 day') g)
             SELECT dias.dia AS fecha, COALESCE(v.n, 0) AS ventas, COALESCE(v.total, 0) AS total_ventas,
                    COALESCE(d.n, 0) AS devoluciones, COALESCE(d.total, 0) AS total_devoluciones,
                    COALESCE(v.total, 0) - COALESCE(d.total, 0) AS neto
               FROM dias LEFT JOIN v ON v.dia = dias.dia LEFT JOIN d ON d.dia = dias.dia
              ORDER BY dias.dia`,
      values: valores(f),
    }),
  },
  {
    id: 'ventas-por-canal', titulo: 'Ventas por canal', grupo: 'Ventas', fechas: true,
    descripcion: 'Presencial frente a online.',
    columnas: COLS_VENTAS('canal', 'Canal'),
    consulta: porPedido('JOIN canal_venta cv ON cv.id = p.canal_venta_id', 'cv.nombre', 'canal'),
  },
  {
    id: 'ventas-por-sucursal', titulo: 'Ventas por sucursal', grupo: 'Ventas', fechas: true,
    descripcion: 'Venta neta de cada sucursal.',
    columnas: COLS_VENTAS('sucursal', 'Sucursal'),
    consulta: porPedido('LEFT JOIN sucursal s ON s.id = p.sucursal_id', "COALESCE(s.nombre, 'Sin sucursal')", 'sucursal'),
  },
  {
    id: 'ventas-por-medio', titulo: 'Ventas por medio de pago', grupo: 'Ventas', fechas: true,
    descripcion: 'Lo cobrado y lo devuelto por cada medio de pago. El efectivo incluye el redondeo de la Ley 20.956, por eso puede diferir en pesos de la venta neta.',
    columnas: [
      { key: 'medio_pago', header: 'Medio de pago', tipo: 'texto' },
      { key: 'cobrado', header: 'Cobrado', tipo: 'clp', suma: true },
      { key: 'devuelto', header: 'Devuelto', tipo: 'clp', suma: true },
      { key: 'neto', header: 'Neto', tipo: 'clp', suma: true },
    ],
    consulta: (f) => ({
      text: `WITH c AS (SELECT tp.medio_pago_id, SUM(tp.monto) AS monto
                           FROM transaccion_pago tp JOIN estado_transaccion et ON et.id = tp.estado_transaccion_id AND et.nombre = 'Aprobado'
                           JOIN pedido p ON p.id = tp.pedido_id JOIN estado_pedido e ON e.id = p.estado_pedido_id
                          WHERE ${rangoPedido} GROUP BY 1),
                  d AS (SELECT dp.medio_pago_id, SUM(dp.monto) AS monto
                           FROM devolucion_pago dp JOIN devolucion dv ON dv.id = dp.devolucion_id JOIN pedido p ON p.id = dv.pedido_id
                          WHERE ${rangoDevolucion} GROUP BY 1)
             SELECT mp.nombre AS medio_pago, COALESCE(c.monto, 0) AS cobrado, COALESCE(d.monto, 0) AS devuelto,
                    COALESCE(c.monto, 0) - COALESCE(d.monto, 0) AS neto
               FROM medio_pago mp LEFT JOIN c ON c.medio_pago_id = mp.id LEFT JOIN d ON d.medio_pago_id = mp.id
              WHERE c.medio_pago_id IS NOT NULL OR d.medio_pago_id IS NOT NULL
              ORDER BY neto DESC, mp.nombre`,
      values: valores(f),
    }),
  },
  {
    id: 'ventas-por-categoria', titulo: 'Ventas por categoría', grupo: 'Ventas', fechas: true,
    descripcion: 'Venta neta de devoluciones por categoría de producto.',
    columnas: [
      { key: 'categoria', header: 'Categoría', tipo: 'texto' },
      { key: 'unidades', header: 'Unidades', tipo: 'entero', suma: true },
      { key: 'venta_bruta', header: 'Vendido', tipo: 'clp', suma: true },
      { key: 'devuelto', header: 'Devuelto', tipo: 'clp', suma: true },
      { key: 'neto', header: 'Venta neta', tipo: 'clp', suma: true },
    ],
    consulta: (f) => ({
      text: `WITH ${PRODUCTOS}
             SELECT categoria, SUM(unidades)::int AS unidades, SUM(venta_bruta) AS venta_bruta, SUM(devuelto) AS devuelto, SUM(neto) AS neto
               FROM pp GROUP BY categoria ORDER BY neto DESC, categoria`,
      values: valores(f),
    }),
  },
  {
    id: 'top-productos', titulo: 'Productos más vendidos', grupo: 'Ventas', fechas: true,
    descripcion: 'Ordenados por venta neta de devoluciones.',
    columnas: [
      { key: 'sku', header: 'SKU', tipo: 'texto' },
      { key: 'producto', header: 'Producto', tipo: 'texto' },
      { key: 'categoria', header: 'Categoría', tipo: 'texto' },
      { key: 'unidades', header: 'Unidades', tipo: 'entero', suma: true },
      { key: 'unidades_devueltas', header: 'Devueltas', tipo: 'entero', suma: true },
      { key: 'neto', header: 'Venta neta', tipo: 'clp', suma: true },
    ],
    consulta: (f) => ({
      text: `WITH ${PRODUCTOS} SELECT sku, producto, categoria, unidades, unidades_devueltas, neto FROM pp ORDER BY neto DESC, producto LIMIT $4`,
      values: [...valores(f), f.limite],
    }),
  },

  {
    id: 'stock-bajo-minimo', titulo: 'Stock bajo el mínimo', grupo: 'Inventario', permiso: 'inventario',
    descripcion: 'Productos que están bajo el stock mínimo fijado para su sucursal (solo unidades sin vencer).',
    columnas: [
      { key: 'sucursal', header: 'Sucursal', tipo: 'texto' },
      { key: 'sku', header: 'SKU', tipo: 'texto' },
      { key: 'producto', header: 'Producto', tipo: 'texto' },
      { key: 'disponible', header: 'Disponible', tipo: 'entero' },
      { key: 'minimo', header: 'Mínimo', tipo: 'entero' },
      { key: 'faltante', header: 'A reponer', tipo: 'entero', suma: true },
    ],
    consulta: (f) => ({
      text: `WITH ${CTE_STOCK}
             SELECT s.nombre AS sucursal, p.sku, p.nombre AS producto, COALESCE(a.disponible, 0) AS disponible,
                    m.stock_minimo AS minimo, (m.stock_minimo - COALESCE(a.disponible, 0)) AS faltante
               FROM stock_minimo_sucursal m
               JOIN producto p ON p.id = m.producto_id AND p.activo
               JOIN sucursal s ON s.id = m.sucursal_id
               LEFT JOIN agg a ON a.producto_id = m.producto_id AND a.sucursal_id = m.sucursal_id
              WHERE m.stock_minimo > 0 AND COALESCE(a.disponible, 0) < m.stock_minimo AND ($1::uuid IS NULL OR m.sucursal_id = $1)
              ORDER BY faltante DESC, producto, sucursal`,
      values: [f.sucursal_id],
    }),
  },
  {
    id: 'lotes-por-vencer', titulo: 'Lotes por vencer', grupo: 'Inventario', permiso: 'inventario',
    descripcion: 'Lotes con existencias que ya vencieron o vencen dentro del plazo elegido (días).',
    columnas: [
      { key: 'sucursal', header: 'Sucursal', tipo: 'texto' },
      { key: 'sku', header: 'SKU', tipo: 'texto' },
      { key: 'producto', header: 'Producto', tipo: 'texto' },
      { key: 'lote', header: 'Lote', tipo: 'texto' },
      { key: 'vencimiento', header: 'Vence', tipo: 'fecha' },
      { key: 'cantidad', header: 'Unidades', tipo: 'entero', suma: true },
      { key: 'estado', header: 'Estado', tipo: 'texto' },
    ],
    consulta: (f) => ({
      text: `SELECT s.nombre AS sucursal, p.sku, p.nombre AS producto, COALESCE(l.numero_lote, 'Sin lote') AS lote,
                    l.fecha_vencimiento AS vencimiento, l.cantidad_actual AS cantidad,
                    CASE WHEN l.fecha_vencimiento < ${HOY} THEN 'Vencido'
                         ELSE 'Vence en ' || (l.fecha_vencimiento - ${HOY}) || ' días' END AS estado
               FROM lote l JOIN producto p ON p.id = l.producto_id JOIN sucursal s ON s.id = l.sucursal_id
              WHERE l.cantidad_actual > 0 AND l.fecha_vencimiento IS NOT NULL
                AND l.fecha_vencimiento <= ${HOY} + $2::int AND ($1::uuid IS NULL OR l.sucursal_id = $1)
              ORDER BY l.fecha_vencimiento, p.nombre`,
      values: [f.sucursal_id, f.dias],
    }),
  },
  {
    id: 'inventario-valorizado', titulo: 'Inventario valorizado', grupo: 'Inventario', permiso: 'inventario',
    descripcion: 'Existencias al costo actual de cada producto, por sucursal y categoría, con lo ya vencido aparte.',
    columnas: [
      { key: 'sucursal', header: 'Sucursal', tipo: 'texto' },
      { key: 'categoria', header: 'Categoría', tipo: 'texto' },
      { key: 'unidades', header: 'Unidades', tipo: 'entero', suma: true },
      { key: 'valor_costo', header: 'Valor al costo', tipo: 'clp', suma: true },
      { key: 'unidades_vencidas', header: 'Vencidas', tipo: 'entero', suma: true },
      { key: 'valor_vencido', header: 'Valor vencido', tipo: 'clp', suma: true },
    ],
    consulta: (f) => ({
      text: `SELECT s.nombre AS sucursal, c.nombre AS categoria,
                    SUM(l.cantidad_actual)::int AS unidades, SUM(l.cantidad_actual * p.costo) AS valor_costo,
                    COALESCE(SUM(l.cantidad_actual) FILTER (WHERE l.fecha_vencimiento < ${HOY}), 0)::int AS unidades_vencidas,
                    COALESCE(SUM(l.cantidad_actual * p.costo) FILTER (WHERE l.fecha_vencimiento < ${HOY}), 0) AS valor_vencido
               FROM lote l JOIN producto p ON p.id = l.producto_id JOIN categoria c ON c.id = p.categoria_id
               JOIN sucursal s ON s.id = l.sucursal_id
              WHERE l.cantidad_actual > 0 AND ($1::uuid IS NULL OR l.sucursal_id = $1)
              GROUP BY s.nombre, c.nombre ORDER BY s.nombre, valor_costo DESC`,
      values: [f.sucursal_id],
    }),
  },

  {
    id: 'compras-por-proveedor', titulo: 'Compras por proveedor', grupo: 'Compras', permiso: 'proveedores', fechas: true,
    descripcion: 'Órdenes de compra emitidas en el período (sin borradores ni canceladas en el total).',
    columnas: [
      { key: 'proveedor', header: 'Proveedor', tipo: 'texto' },
      { key: 'ordenes', header: 'Órdenes', tipo: 'entero', suma: true },
      { key: 'total_comprado', header: 'Total comprado', tipo: 'clp', suma: true },
      { key: 'pendientes', header: 'Por recibir', tipo: 'entero', suma: true },
      { key: 'canceladas', header: 'Canceladas', tipo: 'entero', suma: true },
    ],
    consulta: (f) => ({
      text: `SELECT pv.nombre AS proveedor,
                    COUNT(*) FILTER (WHERE e.nombre <> 'Cancelada')::int AS ordenes,
                    COALESCE(SUM(oc.total) FILTER (WHERE e.nombre <> 'Cancelada'), 0) AS total_comprado,
                    COUNT(*) FILTER (WHERE e.nombre IN ('Pendiente', 'Recibida parcial'))::int AS pendientes,
                    COUNT(*) FILTER (WHERE e.nombre = 'Cancelada')::int AS canceladas
               FROM orden_compra oc JOIN estado_orden_compra e ON e.id = oc.estado_orden_compra_id
               JOIN proveedor pv ON pv.id = oc.proveedor_id
              WHERE e.nombre <> 'Borrador' AND ${condicionRango('oc.fecha', 1, 2)} AND ($3::uuid IS NULL OR oc.sucursal_id = $3)
              GROUP BY pv.id, pv.nombre ORDER BY total_comprado DESC, pv.nombre`,
      values: valores(f),
    }),
  },
  {
    id: 'ordenes-pendientes', titulo: 'Órdenes por recibir', grupo: 'Compras', permiso: 'proveedores',
    descripcion: 'Órdenes emitidas que aún no se reciben por completo, con los días de atraso sobre la fecha esperada.',
    columnas: [
      { key: 'codigo', header: 'Orden', tipo: 'texto' },
      { key: 'proveedor', header: 'Proveedor', tipo: 'texto' },
      { key: 'sucursal', header: 'Destino', tipo: 'texto' },
      { key: 'estado', header: 'Estado', tipo: 'texto' },
      { key: 'fecha_esperada', header: 'Entrega esperada', tipo: 'fecha' },
      { key: 'dias_atraso', header: 'Días de atraso', tipo: 'entero' },
      { key: 'total', header: 'Total', tipo: 'clp', suma: true },
    ],
    consulta: (f) => ({
      text: `SELECT oc.numero, pv.nombre AS proveedor, s.nombre AS sucursal, e.nombre AS estado, oc.fecha_esperada,
                    GREATEST(COALESCE(${HOY} - oc.fecha_esperada, 0), 0)::int AS dias_atraso, oc.total
               FROM orden_compra oc JOIN estado_orden_compra e ON e.id = oc.estado_orden_compra_id
               JOIN proveedor pv ON pv.id = oc.proveedor_id JOIN sucursal s ON s.id = oc.sucursal_id
              WHERE e.nombre IN ('Pendiente', 'Recibida parcial') AND ($1::uuid IS NULL OR oc.sucursal_id = $1)
              ORDER BY dias_atraso DESC, oc.numero`,
      values: [f.sucursal_id],
    }),
    fila: ({ numero, ...resto }) => ({ codigo: formatoNumero('OC', numero), ...resto }),
  },
];

export const buscarInforme = (id) => INFORMES.find((i) => i.id === id);
export const puedeVer = (user, informe) => user.permisos.includes(informe.permiso ?? 'dashboard');

const convertir = (tipo, v) => (tipo === 'clp' || tipo === 'entero' ? Number(v ?? 0) : v);

// Ejecuta un informe y devuelve sus columnas, filas con los números ya convertidos y los totales de las columnas `suma`.
export async function ejecutarInforme(db, informe, f) {
  const { text, values } = informe.consulta(f);
  const { rows } = await db.query(text, values);
  const filas = rows.map((r) => {
    const base = informe.fila ? informe.fila(r) : r;
    return Object.fromEntries(informe.columnas.map((c) => [c.key, convertir(c.tipo, base[c.key])]));
  });
  const totales = Object.fromEntries(informe.columnas.filter((c) => c.suma).map((c) => [c.key, filas.reduce((s, r) => s + r[c.key], 0)]));
  return { id: informe.id, titulo: informe.titulo, grupo: informe.grupo, fechas: Boolean(informe.fechas), columnas: informe.columnas, filas, totales };
}
