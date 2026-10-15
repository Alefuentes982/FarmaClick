import { z } from 'zod';
import { optionalText, uuid } from '../../core/sql.js';

const lineas = z
  .array(z.object({ producto_id: uuid, cantidad: z.number().int().positive('La cantidad debe ser mayor a cero.') }))
  .min(1, 'El pedido necesita al menos una línea.')
  .refine((l) => new Set(l.map((x) => x.producto_id)).size === l.length, 'Producto repetido en el pedido.');

// reservar=true deja el stock apartado al guardar (FEFO); si no, el pedido queda "Pago pendiente" sin reserva.
export const pedidoSchema = z.object({
  sucursal_id: uuid,
  nombre_cliente: z.string().trim().min(1, 'Indique el nombre del cliente.').max(150),
  telefono: optionalText(30),
  direccion_pedido: optionalText(200),
  comuna_id: uuid.nullish().transform((v) => v ?? null),
  items: lineas,
  reservar: z.boolean().default(false),
});

// Pago dividido en uno o más medios. Sin efectivo la suma calza exacto con el total; el efectivo se informa ya
// redondeado al múltiplo de $10 (Ley 20.956), lo valida validarCobro en el servicio.
export const pagosSchema = z.object({
  pagos: z.array(z.object({
    medio_pago_id: uuid,
    monto: z.number().positive('El monto debe ser mayor a cero.'),
    codigo_autorizacion: optionalText(50),
  })).min(1, 'Indique al menos un medio de pago.'),
});

export const estadoSchema = z.object({ estado: z.string().trim().min(1) });
