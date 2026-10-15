import { z } from 'zod';
import { optionalText } from '../../core/sql.js';

// Revisión del turno por alguien distinto de quien lo abrió (el Administrador puede revisar el suyo). Si hay observaciones o diferencia de caja,
// la observación es obligatoria (la regla de la diferencia la aplica el servicio, que conoce el turno).
export const revisionSchema = z.object({
  conforme: z.boolean(),
  observacion: optionalText(500),
}).superRefine((d, ctx) => {
  if (!d.conforme && (d.observacion ?? '').length < 3) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['observacion'], message: 'Explique las observaciones.' });
  }
});

// Corrección de un monto del turno (solo Administrador): el motivo queda registrado junto al valor anterior.
export const correccionSchema = z.object({
  campo: z.enum(['apertura', 'cierre'], { errorMap: () => ({ message: 'Indique qué monto corrige: apertura o cierre.' }) }),
  monto: z.number({ invalid_type_error: 'Monto inválido.' }).min(0, 'El monto no puede ser negativo.').max(9999999999, 'Monto demasiado alto.'),
  motivo: z.string().trim().min(10, 'Explique el motivo de la corrección (al menos 10 caracteres).').max(500),
});

// Observación sobre un turno (no se edita ni se borra).
export const observacionSchema = z.object({
  texto: z.string().trim().min(3, 'Escriba la observación.').max(1000),
});

const montoCaja = z.number({ invalid_type_error: 'Monto inválido.' }).min(0, 'El monto no puede ser negativo.').max(9999999999, 'Monto demasiado alto.');

// Cierre por fuerza mayor del turno de otra persona (Administrador o Jefe de local).
export const cierreForzadoSchema = z.object({
  monto: montoCaja,
  motivo: z.string().trim().min(10, 'Explique por qué se cierra el turno de otra persona (al menos 10 caracteres).').max(500),
});

// Arqueo de un turno cerrado automáticamente (Administrador o Jefe de local).
export const arqueoSchema = z.object({
  monto: montoCaja,
  observacion: optionalText(1000),
});

export const ESTADOS_TURNO = ['abierto', 'cerrado', 'sin_revisar', 'con_diferencia', 'corregido', 'pendiente_arqueo'];
