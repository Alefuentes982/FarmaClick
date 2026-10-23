-- =====================================================================
-- 002 — Kardex: observación en los movimientos
-- Ejecutar UNA vez sobre la base existente (editor SQL de Supabase). Es seguro repetirla.
--   * movimiento_inventario.observacion: motivo escrito de ajustes, mermas y bajas manuales.
--     Es opcional (las ventas y recepciones no la usan). El kardex sigue siendo inmutable: la columna se
--     informa al insertar el movimiento y no se puede modificar después.
-- No requiere GRANT nuevo: app_backend ya tiene INSERT sobre toda la tabla.
-- =====================================================================
BEGIN;

ALTER TABLE movimiento_inventario ADD COLUMN IF NOT EXISTS observacion VARCHAR(300);
COMMENT ON COLUMN movimiento_inventario.observacion IS 'Motivo escrito (ajustes, mermas, bajas manuales). Opcional; se informa al insertar y no se modifica.';

COMMIT;
