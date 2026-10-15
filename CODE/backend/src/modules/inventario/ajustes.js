import { Router } from 'express';
import { z } from 'zod';
import { withTx } from '../../core/db.js';
import { HttpError, notFound } from '../../core/errors.js';
import { uuid } from '../../core/sql.js';
import { bloquearLote, bloquearProducto, hoyChile, insertarMovimiento } from './movimientos.js';

const r = Router();

const MOTIVOS = ['Ajuste positivo', 'Ajuste negativo', 'Merma'];
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD).');

// Ajuste positivo: suma a un lote existente (lote_id) o ingresa uno nuevo (lote_nuevo; sirve para cargar el
// inventario inicial). Ajuste negativo y merma: descuentan de un lote (lote_id). La observación es obligatoria.
export const ajusteSchema = z.object({
  sucursal_id: uuid,
  producto_id: uuid,
  motivo: z.enum(MOTIVOS),
  cantidad: z.number().int().positive('La cantidad debe ser mayor a cero.'),
  lote_id: uuid.nullish(),
  lote_nuevo: z.object({
    numero_lote: z.string().trim().max(50).nullish().transform((v) => v || null),
    fecha_vencimiento: fecha.nullish().transform((v) => v ?? null),
  }).nullish(),
  observacion: z.string().trim().min(3, 'Indique el motivo del ajuste.').max(300),
}).superRefine((d, ctx) => {
  const falla = (message, path) => ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [path] });
  if (d.motivo === 'Ajuste positivo') {
    if (!d.lote_id && !d.lote_nuevo) falla('Indique el lote al que se suma o los datos del lote nuevo.', 'lote_id');
    if (d.lote_id && d.lote_nuevo) falla('Elija un lote existente o uno nuevo, no ambos.', 'lote_nuevo');
  } else {
    if (!d.lote_id) falla('Indique el lote del que se descuenta.', 'lote_id');
    if (d.lote_nuevo) falla('Un descuento no puede crear un lote.', 'lote_nuevo');
  }
});

r.post('/', async (req, res) => {
  const d = ajusteSchema.parse(req.body);
  const resultado = await withTx(req.usuarioId, async (db) => {
    const producto = await bloquearProducto(db, d.producto_id);
    const { rowCount } = await db.query('SELECT 1 FROM sucursal WHERE id = $1 AND activa', [d.sucursal_id]);
    if (!rowCount) throw notFound('Sucursal');

    let lote;
    if (d.lote_nuevo) {
      if (d.lote_nuevo.fecha_vencimiento && d.lote_nuevo.fecha_vencimiento < await hoyChile(db)) {
        throw new HttpError(409, 'No se puede ingresar un lote que ya está vencido.');
      }
      // Sin lote exigido se genera un número técnico: la restricción única (producto, sucursal, lote) no admite dos NULL.
      const numero = d.lote_nuevo.numero_lote ?? (producto.requiere_lote ? null : `AJ-${Date.now().toString(36)}`);
      const ins = await db.query(
        `INSERT INTO lote (numero_lote, fecha_vencimiento, cantidad_recibida, producto_id, sucursal_id)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [numero, d.lote_nuevo.fecha_vencimiento, d.cantidad, d.producto_id, d.sucursal_id]);
      lote = { id: ins.rows[0].id, numero_lote: numero };
    } else {
      lote = await bloquearLote(db, d.lote_id);
      if (lote.producto_id !== d.producto_id || lote.sucursal_id !== d.sucursal_id) {
        throw new HttpError(400, 'El lote no corresponde al producto y sucursal indicados.');
      }
      if (d.motivo === 'Ajuste positivo' && lote.vencido) throw new HttpError(409, 'No se puede sumar stock a un lote vencido.');
      if (d.motivo !== 'Ajuste positivo' && lote.cantidad_actual < d.cantidad) {
        throw new HttpError(409, `Stock insuficiente en el lote ${lote.numero_lote ?? ''}: hay ${lote.cantidad_actual} y se pidió descontar ${d.cantidad}.`);
      }
    }
    const mov = await insertarMovimiento(db, {
      productoId: d.producto_id, sucursalId: d.sucursal_id, cantidad: d.cantidad, motivo: d.motivo,
      loteId: lote.id, usuarioId: req.usuarioId, observacion: d.observacion,
    });
    return { movimiento_id: mov.id, fecha: mov.fecha, lote_id: lote.id, numero_lote: lote.numero_lote };
  });
  res.status(201).json(resultado);
});

export default r;
