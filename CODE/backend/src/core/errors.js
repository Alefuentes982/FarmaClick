import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const notFound = (what = 'Registro') => new HttpError(404, `${what} no encontrado.`);

export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Datos inválidos.',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  switch (err.code) {
    case '23505': return res.status(409).json({ error: 'Ya existe un registro con ese valor único (SKU, RUT, número de lote...).' });
    case '23503': return res.status(409).json({ error: 'Referencia inválida o registro en uso por otros datos.' });
    case '23514': return res.status(400).json({ error: 'Los datos no cumplen una regla de la base de datos.' });
    case '22P02':
    case '22007': return res.status(400).json({ error: 'Formato de dato inválido (identificador o fecha).' });
    case 'P0001': return res.status(409).json({ error: err.message }); // RAISE EXCEPTION de los triggers
  }
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
}
