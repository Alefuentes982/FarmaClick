import { Router } from 'express';
import { z } from 'zod';
import { pool, withTx } from '../../core/db.js';
import { HttpError, notFound } from '../../core/errors.js';
import { ROLES_EXCLUIDOS } from '../../core/cuentas.js';
import { uuid } from '../../core/sql.js';

const r = Router();

// Matriz de permisos: módulos x roles de personal. Un módulo sin fila en rol_permiso cuenta como no permitido.
r.get('/', async (_req, res) => {
  const [roles, modulos, permisos] = await Promise.all([
    pool.query('SELECT id, nombre FROM rol WHERE nombre <> ALL($1::text[]) ORDER BY nombre', [ROLES_EXCLUIDOS]),
    pool.query('SELECT id, nombre, clave FROM modulo ORDER BY nombre'),
    pool.query('SELECT rol_id, modulo_id, permitido FROM rol_permiso'),
  ]);
  res.json({
    modulos: modulos.rows,
    roles: roles.rows.map((rol) => ({
      ...rol,
      permisos: Object.fromEntries(
        permisos.rows.filter((p) => p.rol_id === rol.id).map((p) => [p.modulo_id, p.permitido])),
    })),
  });
});

const body = z.object({
  permisos: z.array(z.object({ modulo_id: uuid, permitido: z.boolean() })).min(1),
});

r.put('/:id/permisos', async (req, res) => {
  const { permisos } = body.parse(req.body);
  await withTx(req.usuarioId, async (db) => {
    const { rows } = await db.query('SELECT nombre FROM rol WHERE id = $1', [req.params.id]);
    if (!rows[0] || ROLES_EXCLUIDOS.includes(rows[0].nombre)) throw notFound('Rol');

    // Evita que el administrador se deje sin acceso a la gestión de usuarios y permisos.
    if (rows[0].nombre === 'Administrador') {
      const { rows: m } = await db.query("SELECT id FROM modulo WHERE clave = 'usuarios'");
      if (permisos.some((p) => p.modulo_id === m[0]?.id && !p.permitido)) {
        throw new HttpError(409, 'El rol Administrador no puede perder el módulo "Usuarios y permisos".');
      }
    }
    for (const p of permisos) {
      await db.query(
        `INSERT INTO rol_permiso (rol_id, modulo_id, permitido) VALUES ($1,$2,$3)
         ON CONFLICT (rol_id, modulo_id) DO UPDATE SET permitido = EXCLUDED.permitido`,
        [req.params.id, p.modulo_id, p.permitido]);
    }
  });
  res.status(204).end();
});

export default r;
