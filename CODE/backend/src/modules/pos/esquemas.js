import { z } from 'zod';
import { optionalText, uuid } from '../../core/sql.js';
import { pagosSchema } from '../pedidos/esquemas.js';

const lineas = z
  .array(z.object({ producto_id: uuid, cantidad: z.number().int().positive('La cantidad debe ser mayor a cero.') }))
  .min(1, 'La venta necesita al menos un producto.')
  .refine((l) => new Set(l.map((x) => x.producto_id)).size === l.length, 'Producto repetido en la venta.');

export const aperturaSchema = z.object({
  caja_id: uuid,
  monto_apertura_efectivo: z.number().min(0, 'El efectivo inicial no puede ser negativo.'),
});

export const cierreSchema = z.object({
  monto_contado: z.number().min(0, 'El efectivo contado no puede ser negativo.'),
});

export const cotizacionSchema = z.object({ items: lineas });

// Venta en mostrador: líneas, pago (uno o varios medios) y, opcionalmente, el nombre del cliente.
export const ventaSchema = z.object({
  items: lineas,
  nombre_cliente: optionalText(150),
  pagos: pagosSchema.shape.pagos,
});

export const cajaSchema = z.object({ sucursal_id: uuid });
