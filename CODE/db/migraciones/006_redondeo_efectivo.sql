-- =====================================================================
-- 006 — Redondeo del efectivo (Ley 20.956)
-- Los pagos en efectivo se redondean al múltiplo de $10 más cercano. El total del pedido y el valor de lo devuelto no
-- cambian: la diferencia se guarda aparte, en `redondeo` (negativo si se cobra o devuelve de menos, positivo si de más).
--   * pedido.redondeo:     suma de los pagos aprobados = total + redondeo
--   * devolucion.redondeo: suma de los reembolsos      = total_reembolso + redondeo
-- transaccion_pago.monto en efectivo sigue siendo el monto realmente recibido, así el cierre de caja no cambia.
-- Idempotente. Ejecutar en el editor SQL de Supabase (en local, docker compose la aplica al crear la base; ver db/generar-instalacion.sh).
-- =====================================================================
BEGIN;

ALTER TABLE pedido ADD COLUMN IF NOT EXISTS redondeo NUMERIC(12,2) DEFAULT 0 NOT NULL;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pedido_redondeo_rango') THEN
        ALTER TABLE pedido ADD CONSTRAINT pedido_redondeo_rango CHECK (redondeo BETWEEN -5 AND 5);
    END IF;
END $$;
COMMENT ON COLUMN pedido.redondeo IS 'Ajuste por redondeo del efectivo (Ley 20.956). Pagos aprobados = total + redondeo.';
GRANT UPDATE (redondeo) ON pedido TO app_backend;

ALTER TABLE devolucion ADD COLUMN IF NOT EXISTS redondeo NUMERIC(12,2) DEFAULT 0 NOT NULL;
COMMENT ON COLUMN devolucion.redondeo IS 'Ajuste por redondeo del efectivo devuelto (Ley 20.956). Reembolsos = total_reembolso + redondeo.';

-- Los reembolsos deben sumar el total devuelto más el redondeo del efectivo.
CREATE OR REPLACE FUNCTION trg_validar_totales_devolucion() RETURNS TRIGGER SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lineas NUMERIC; v_pagos NUMERIC;
BEGIN
    SELECT COALESCE(SUM(monto_reembolso), 0) INTO v_lineas FROM devolucion_detalle WHERE devolucion_id = NEW.id;
    SELECT COALESCE(SUM(monto), 0) INTO v_pagos FROM devolucion_pago WHERE devolucion_id = NEW.id;
    IF v_lineas <> NEW.total_reembolso THEN
        RAISE EXCEPTION 'Las líneas de la devolución suman % y el total es %.', v_lineas, NEW.total_reembolso;
    END IF;
    IF v_pagos <> NEW.total_reembolso + NEW.redondeo THEN
        RAISE EXCEPTION 'Los reembolsos suman % y la devolución es de % con un redondeo de %.', v_pagos, NEW.total_reembolso, NEW.redondeo;
    END IF;
    RETURN NULL;
END; $$ LANGUAGE plpgsql;

COMMIT;
