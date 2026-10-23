-- =====================================================================
-- 007 — Jefe de local y permiso de supervisión de caja
-- Hasta ahora supervisar la caja (ver todos los turnos, revisarlos, ver el efectivo esperado de un turno abierto)
-- lo podía quien administraba usuarios. Se separa en un permiso propio, `supervision_caja`, que tienen el
-- Administrador y el nuevo rol "Jefe de local", sin darle a este la gestión de usuarios.
-- El rol Jefe de local trae permisos de operación; se pueden ajustar en "Roles y permisos".
-- Idempotente. Ejecutar en el editor SQL de Supabase (en local, docker compose la aplica al crear la base; ver db/generar-instalacion.sh).
-- =====================================================================
BEGIN;

INSERT INTO rol (nombre) VALUES ('Jefe de local') ON CONFLICT (nombre) DO NOTHING;
INSERT INTO modulo (nombre, clave) VALUES ('Supervisión de caja', 'supervision_caja') ON CONFLICT (clave) DO NOTHING;

-- Todos los roles reciben la fila del módulo nuevo: lo tienen el Administrador y el Jefe de local.
INSERT INTO rol_permiso (rol_id, modulo_id, permitido)
SELECT r.id, m.id, r.nombre IN ('Administrador', 'Jefe de local')
  FROM rol r CROSS JOIN modulo m WHERE m.clave = 'supervision_caja'
ON CONFLICT (rol_id, modulo_id) DO NOTHING;

-- Permisos de operación del Jefe de local en los demás módulos (sin usuarios y permisos).
INSERT INTO rol_permiso (rol_id, modulo_id, permitido)
SELECT r.id, m.id, m.clave IN ('dashboard', 'pos', 'inventario', 'proveedores', 'pedidos', 'cuadratura', 'devoluciones', 'supervision_caja')
  FROM rol r CROSS JOIN modulo m WHERE r.nombre = 'Jefe de local'
ON CONFLICT (rol_id, modulo_id) DO NOTHING;

COMMIT;
