// Crea el primer administrador (cuenta de Supabase Auth + fila en usuario).
// Uso: npm run crear-admin -- correo@dominio.cl "Contraseña segura" "Nombre Apellido"
import 'dotenv/config';
import { pool } from '../src/core/db.js';
import { crearCuenta } from '../src/core/cuentas.js';

const [correo, password, nombre = 'Administrador'] = process.argv.slice(2);
if (!correo || !password) {
  console.error('Uso: npm run crear-admin -- <correo> <contraseña> [nombre]');
  process.exit(1);
}

try {
  const { rows } = await pool.query("SELECT id FROM rol WHERE nombre = 'Administrador'");
  if (!rows[0]) throw new Error('No existe el rol Administrador: ¿se ejecutó el SQL de datos semilla?');
  const id = await crearCuenta({ nombre, correo: correo.toLowerCase(), password, rol_id: rows[0].id });
  console.log(`Administrador creado: ${correo} (${id})`);
} catch (err) {
  console.error('No se pudo crear el administrador:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
