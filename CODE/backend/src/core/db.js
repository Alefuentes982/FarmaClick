import 'dotenv/config';
import pg from 'pg';

// Las columnas DATE (vencimientos, fechas esperadas) se entregan como texto AAAA-MM-DD: pg las convertiría a un
// instante en la zona horaria del servidor y el día podría correrse.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: 10,
});

// El pooler de Supabase en modo transacción no admite SET de sesión ni sentencias
// preparadas con nombre: la identidad se fija dentro de cada transacción.
export async function withTx(usuarioId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (usuarioId) await client.query("SELECT set_config('app.usuario_id', $1, true)", [usuarioId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
