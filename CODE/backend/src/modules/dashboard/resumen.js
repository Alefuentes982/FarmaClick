// Indicadores de la portada del dashboard. Reutiliza los informes (una sola definición de cada cifra);
// el inventario y las compras solo se calculan para quien tiene el permiso correspondiente.
import { condicionRango } from '../../core/fechas.js';
import { buscarInforme, ejecutarInforme } from './informes.js';

const suma = (informe, clave) => informe.totales[clave] ?? 0;

export async function resumenDashboard(db, user, f) {
  const ver = (p) => user.permisos.includes(p);
  const ejecutar = (id, extra = {}) => ejecutarInforme(db, buscarInforme(id), { ...f, ...extra });

  const [diarias, unidades] = await Promise.all([
    ejecutar('ventas-diarias'),
    db.query(
      `SELECT COALESCE(SUM(dp.cantidad), 0)::int AS unidades
         FROM detalle_pedido dp JOIN pedido p ON p.id = dp.pedido_id JOIN estado_pedido e ON e.id = p.estado_pedido_id
        WHERE e.nombre IN ('Pagado', 'En preparación', 'Listo para retiro', 'En despacho', 'Entregado')
          AND ${condicionRango('p.fecha', 1, 2)} AND ($3::uuid IS NULL OR p.sucursal_id = $3)`,
      [f.desde, f.hasta, f.sucursal_id]),
  ]);
  const ventas = suma(diarias, 'ventas');
  const totalVentas = suma(diarias, 'total_ventas');
  const out = {
    ventas: {
      ventas, total_ventas: totalVentas,
      devoluciones: suma(diarias, 'devoluciones'), total_devoluciones: suma(diarias, 'total_devoluciones'),
      ventas_netas: suma(diarias, 'neto'),
      ticket_promedio: ventas ? Math.round(totalVentas / ventas) : 0,
      unidades: unidades.rows[0].unidades,
    },
    inventario: null,
    compras: null,
  };

  // Sin límite de filas: son conteos y sumas de informes que ya vienen acotados por stock mínimo o plazo.
  if (ver('inventario')) {
    const [bajo, porVencer, valor] = await Promise.all([
      ejecutar('stock-bajo-minimo'), ejecutar('lotes-por-vencer', { dias: 30 }), ejecutar('inventario-valorizado'),
    ]);
    out.inventario = {
      bajo_minimo: bajo.filas.length,
      lotes_vencidos: porVencer.filas.filter((l) => l.estado === 'Vencido').length,
      lotes_por_vencer: porVencer.filas.filter((l) => l.estado !== 'Vencido').length,
      valor_inventario: suma(valor, 'valor_costo'),
      valor_vencido: suma(valor, 'valor_vencido'),
    };
  }
  if (ver('proveedores')) {
    const [comprado, pendientes] = await Promise.all([ejecutar('compras-por-proveedor'), ejecutar('ordenes-pendientes')]);
    out.compras = {
      total_comprado: suma(comprado, 'total_comprado'),
      ordenes: suma(comprado, 'ordenes'),
      por_recibir: pendientes.filas.length,
      atrasadas: pendientes.filas.filter((o) => o.dias_atraso > 0).length,
    };
  }
  return out;
}
