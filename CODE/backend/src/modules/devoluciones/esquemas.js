import { z } from 'zod';
import { optionalText, uuid } from '../../core/sql.js';

const items = z
  .array(z.object({
    detalle_id: uuid,
    cantidad: z.number().int().positive('La cantidad debe ser mayor a cero.'),
    // El stock devuelto solo vuelve al inventario si quien atiende lo indica (productos en buen estado y sellados).
    reingresa_stock: z.boolean().default(false),
  }))
  .min(1, 'Seleccione al menos un producto a devolver.')
  .refine((l) => new Set(l.map((x) => x.detalle_id)).size === l.length, 'Línea repetida en la devolución.');

export const cotizacionSchema = z.object({ pedido_id: uuid, items });

export const devolucionSchema = z.object({
  pedido_id: uuid,
  items,
  motivo: z.string().trim().min(3, 'Indique el motivo de la devolución.').max(300),
  reembolsos: z.array(z.object({
    medio_pago_id: uuid,
    monto: z.number().positive('El monto debe ser mayor a cero.'),
    referencia: optionalText(50),
  })).min(1, 'Indique cómo se devuelve el dinero.'),
});

// Filtros de la búsqueda de pedidos a devolver (query string). Los campos vacíos se ignoran.
const vacioANulo = (v) => (v === '' || v == null ? undefined : v);
const monto = z.preprocess(vacioANulo, z.coerce.number({ invalid_type_error: 'Monto inválido.' }).min(0, 'El monto no puede ser negativo.').optional());
export const filtrosDevolviblesSchema = z.object({
  q: z.preprocess(vacioANulo, z.string().trim().max(150).optional()),
  producto: z.preprocess(vacioANulo, z.string().trim().max(150).optional()),
  medio_pago_id: z.preprocess(vacioANulo, uuid.optional()),
  sucursal_id: z.preprocess(vacioANulo, uuid.optional()),
  monto_desde: monto,
  monto_hasta: monto,
}).refine((f) => f.monto_desde == null || f.monto_hasta == null || f.monto_desde <= f.monto_hasta,
  'El "monto desde" no puede ser mayor que el "monto hasta".');
