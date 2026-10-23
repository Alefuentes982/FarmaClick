-- =====================================================================
-- SOLO DESARROLLO LOCAL (docker compose). No se ejecuta en Supabase ni en producción.
-- Prepara la base local para trabajar sin Supabase Auth (AUTH_MODE=local en el backend):
--   * habilita el rol app_backend con contraseña de desarrollo;
--   * crea una sucursal con su caja y tabla de credenciales de desarrollo;
--   * crea dos usuarios de prueba:  admin@farmaclick.local / Admin12345   y   vendedor@farmaclick.local / Vendedor12345
-- =====================================================================
ALTER ROLE app_backend LOGIN PASSWORD 'app_backend';

INSERT INTO sucursal (nombre, comuna_id, habilita_venta_web)
SELECT 'Casa Matriz', id, TRUE FROM comuna WHERE nombre = 'San Bernardo';
INSERT INTO caja (sucursal_id, numero) SELECT id, 1 FROM sucursal;

CREATE TABLE dev_credencial (
    usuario_id UUID PRIMARY KEY, correo VARCHAR(150) NOT NULL UNIQUE, password_hash TEXT NOT NULL);
GRANT SELECT, INSERT, UPDATE, DELETE ON dev_credencial TO app_backend;

WITH nuevos AS (
    INSERT INTO usuario (nombre, correo, rol_id, sucursal_id)
    SELECT v.nombre, v.correo, r.id, CASE WHEN r.nombre = 'Administrador' THEN NULL ELSE (SELECT id FROM sucursal LIMIT 1) END
      FROM (VALUES ('Administrador Local', 'admin@farmaclick.local', 'Administrador'),
                   ('Vendedor Local', 'vendedor@farmaclick.local', 'Vendedor')) AS v(nombre, correo, rol)
      JOIN rol r ON r.nombre = v.rol
    RETURNING id, correo)
INSERT INTO dev_credencial (usuario_id, correo, password_hash)
SELECT n.id, n.correo, CASE n.correo WHEN 'admin@farmaclick.local' THEN 'cd7c73b2273c4bf75971bb00b162b22d:29a6be6e42db715934890762617e68a0efe53a95a6ad5d6452a70b12e249cd498d78f16da5d21faf1aebe5a782829951c57306d26b529bbf3d092a82c5ea5d58'
                                     ELSE '9e1c0bd78ecd11925d28a9af3d5086ab:d3cbf2898aee241641dc4b4403cf8a96c0c0cfc5b8b9775279ffe6b7ec4b3b31974288a4cb6ead98bdee59ab2d2e990f305602f237aefa7f4745b1d0bc1fe6e5' END
  FROM nuevos n;
