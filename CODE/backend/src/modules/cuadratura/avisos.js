// Tareas programadas de la caja, que corren dentro de la API (una revisión por minuto):
//   1. Cierre automático: llama a fn_cierre_automatico_turnos(). La función decide si corresponde (23:59 en Chile, solo
//      sucursales que no son farmacia de turno), así que llamarla de más no hace nada. En Supabase, además, la ejecuta
//      pg_cron (job farmaclick-cierre-automatico): el cierre ocurre aunque la API esté detenida.
//   2. Recordatorios por correo, 60 y 30 minutos antes del cierre, al cajero, al Administrador y al Jefe de local.
//   3. Aviso de cierre automático (turno pendiente de arqueo) a los mismos destinatarios.
// Cada aviso se registra en turno_aviso: no se repite aunque la API se reinicie. Sin SMTP configurado, solo se hace
// el cierre automático. Se desactiva con TAREAS_CAJA=off (por ejemplo, en un entorno de pruebas).
import { withTx } from '../../core/db.js';
import { correoConfigurado, enviarCorreo } from '../../core/correo.js';

const CADA_MS = 60_000;
const LLAVE_CANDADO = 2026101301; // pg_try_advisory_xact_lock: una sola instancia de la API hace el trabajo
const RECORDATORIOS = [[30, 'recordatorio_30'], [60, 'recordatorio_60']]; // de menor a mayor

const hora = (v) => new Date(v).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short' });
const empresa = () => process.env.EMPRESA_NOMBRE || 'FarmaClick';
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Correos de quienes deben enterarse de un turno: el cajero, los Administradores y los Jefes de local de esa sucursal
// (o sin sucursal asignada). Solo usuarios activos.
async function destinatarios(db, turno) {
  const { rows } = await db.query(
    `SELECT DISTINCT u.correo FROM usuario u JOIN rol r ON r.id = u.rol_id
      WHERE u.activo AND (u.id = $1 OR r.nombre = 'Administrador'
                          OR (r.nombre = 'Jefe de local' AND (u.sucursal_id IS NULL OR u.sucursal_id = $2)))`,
    [turno.usuario_id, turno.sucursal_id]);
  return rows.map((x) => x.correo);
}

// Marca el aviso como enviado. Devuelve false si otro proceso ya lo había registrado.
async function registrarAviso(db, turnoId, tipo, n) {
  const { rowCount } = await db.query(
    'INSERT INTO turno_aviso (turno_caja_id, tipo, destinatarios) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [turnoId, tipo, n]);
  return rowCount > 0;
}

// Envía un aviso y lo registra. Si el correo falla, no se registra: se reintenta en la próxima vuelta.
async function enviarAviso(db, turno, tipo, { asunto, texto }) {
  try {
    const para = await destinatarios(db, turno);
    if (para.length) {
      await enviarCorreo({
        para: para.join(', '), asunto: `${asunto} · ${empresa()}`, texto,
        html: texto.split('\n').map((l) => `<p>${esc(l)}</p>`).join(''),
      });
    }
    return await registrarAviso(db, turno.id, tipo, para.length);
  } catch (err) {
    console.error(`Aviso ${tipo} del turno ${turno.id}:`, err.message);
    return false;
  }
}

// Qué recordatorio enviar a un turno según los minutos que faltan para las 23:59 y los ya enviados: el más cercano
// que corresponda (si la API partió tarde, no se manda el de 60 después del de 30). null = ninguno.
export function recordatorioQueCorresponde(minutos, enviados = []) {
  if (minutos < 0) return null; // ya pasó la hora: lo cierra fn_cierre_automatico_turnos
  const r = RECORDATORIOS.find(([m]) => minutos <= m);
  if (!r || enviados.includes(r[1]) || (r[1] === 'recordatorio_60' && enviados.includes('recordatorio_30'))) return null;
  return r;
}

// Recordatorios de cierre para los turnos abiertos de sucursales con cierre automático.
async function recordatorios(db) {
  const { rows } = await db.query(
    `SELECT t.id, t.usuario_id, t.fecha_apertura, c.numero AS caja_numero, c.sucursal_id, s.nombre AS sucursal, u.nombre AS cajero,
            FLOOR(EXTRACT(EPOCH FROM (TIME '23:59' - (NOW() AT TIME ZONE 'America/Santiago')::time)) / 60)::int AS minutos,
            ARRAY(SELECT a.tipo FROM turno_aviso a WHERE a.turno_caja_id = t.id) AS enviados
       FROM turno_caja t JOIN caja c ON c.id = t.caja_id JOIN sucursal s ON s.id = c.sucursal_id JOIN usuario u ON u.id = t.usuario_id
      WHERE t.fecha_cierre IS NULL AND NOT s.farmacia_de_turno`);
  for (const t of rows) {
    const r = recordatorioQueCorresponde(t.minutos, t.enviados);
    if (!r) continue;
    const [limite, tipo] = r;
    await enviarAviso(db, t, tipo, {
      asunto: `Recordatorio: la Caja ${t.caja_numero} sigue abierta`,
      texto: `El turno de ${t.cajero} en la Caja ${t.caja_numero} (${t.sucursal}), abierto el ${hora(t.fecha_apertura)}, sigue abierto.\n`
        + `Ciérrelo antes de las 23:59 (faltan ${t.minutos} minutos). A esa hora el sistema lo cerrará automáticamente y `
        + 'el efectivo quedará pendiente de arqueo por el Administrador o el Jefe de local.\n'
        + `Este aviso se envía ${limite} minutos antes del cierre.`,
    });
  }
}

// Aviso de los turnos que cerró el sistema en las últimas 24 horas y aún no se notificaron.
async function avisosCierreAutomatico(db) {
  const { rows } = await db.query(
    `SELECT t.id, t.usuario_id, t.fecha_apertura, t.fecha_cierre, c.numero AS caja_numero, c.sucursal_id, s.nombre AS sucursal, u.nombre AS cajero
       FROM turno_caja t JOIN caja c ON c.id = t.caja_id JOIN sucursal s ON s.id = c.sucursal_id JOIN usuario u ON u.id = t.usuario_id
      WHERE t.cierre_tipo = 'automatico' AND t.fecha_cierre > NOW() - INTERVAL '24 hours'
        AND NOT EXISTS (SELECT 1 FROM turno_aviso a WHERE a.turno_caja_id = t.id AND a.tipo = 'cierre_automatico')`);
  for (const t of rows) {
    await enviarAviso(db, t, 'cierre_automatico', {
      asunto: `Caja ${t.caja_numero} cerrada automáticamente: arqueo pendiente`,
      texto: `El turno de ${t.cajero} en la Caja ${t.caja_numero} (${t.sucursal}), abierto el ${hora(t.fecha_apertura)}, no se cerró `
        + `y el sistema lo cerró automáticamente el ${hora(t.fecha_cierre)}.\n`
        + 'El efectivo contado quedó pendiente: el Administrador o el Jefe de local deben contar la caja y registrar el arqueo '
        + 'en Cuadratura de caja. Hasta entonces el turno no tiene diferencia calculada ni se puede revisar.',
    });
  }
}

// Una vuelta: primero el cierre automático (su propia transacción) y después los correos. Cada parte toma un candado
// de la base para que, si hubiera dos instancias de la API, solo una la haga.
export async function revisarCaja() {
  const conCandado = (fn) => withTx(null, async (db) => {
    const { rows } = await db.query('SELECT pg_try_advisory_xact_lock($1) AS libre', [LLAVE_CANDADO]);
    return rows[0].libre ? fn(db) : null;
  });
  const cerrados = await conCandado(async (db) => (await db.query('SELECT fn_cierre_automatico_turnos() AS n')).rows[0].n);
  if (cerrados) console.log(`Cierre automático: ${cerrados} turno(s) de caja cerrados (pendientes de arqueo).`);
  if (correoConfigurado()) {
    await conCandado(async (db) => {
      await recordatorios(db);
      await avisosCierreAutomatico(db);
    });
  }
  return { cerrados: cerrados ?? 0 };
}

// Inicia la revisión periódica. Un error (base o correo caídos) se registra y se reintenta en la próxima vuelta.
export function iniciarTareasCaja() {
  if (process.env.TAREAS_CAJA === 'off') return null;
  const vuelta = () => revisarCaja().catch((err) => console.error('Tareas de caja:', err.message));
  setTimeout(vuelta, 5_000);
  return setInterval(vuelta, CADA_MS);
}
