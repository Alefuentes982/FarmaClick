-- Verificación de seguridad de la base (ejecutar en el SQL Editor de Supabase, dev y prod). Solo lectura.
-- 1. Todas las tablas del esquema public deben tener RLS activado (esperado: 0 filas).
SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity;
-- 2. anon y authenticated no deben tener privilegios sobre las tablas (esperado: 0 filas).
SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated');
-- 3. Política p_backend_all presente en cada tabla (esperado: 39).
SELECT count(DISTINCT tablename) FROM pg_policies WHERE schemaname = 'public' AND policyname = 'p_backend_all';
-- 4. El kardex es inmutable (esperado: ERROR con el mensaje del trigger). Ejecutar solo en dev:
-- UPDATE movimiento_inventario SET cantidad = cantidad WHERE id = (SELECT id FROM movimiento_inventario LIMIT 1);
-- 5. Jobs de pg_cron activos (esperado: 3).
SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;
