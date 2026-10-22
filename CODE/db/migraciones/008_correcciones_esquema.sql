-- =====================================================================
-- 008 — Correcciones del esquema base (revisión v2 del script)
-- Para una base creada con la versión anterior de farmaclick_postgresql_completo.sql. Es seguro repetirla.
-- Si la base se creó con la versión actual del script, esta migración no cambia nada.
--   * transaccion_pago.buy_order: orden de compra enviada a Webpay Plus (máx. 26 caracteres, única). El uuid del
--     pedido (36) no cabe, así que cada intento de pago por pasarela lleva su propia orden. Obligatoria si hay pasarela.
--   * estado_transaccion 'Abortado': el cliente abandonó el formulario de Webpay o el plazo expiró.
--   * proveedor.activo y categoria.activa: baja lógica sin perder historial.
--   * Índice único parcial: un solo proveedor principal por producto.
-- No afecta a la caja ni a la venta presencial: sus pagos no usan pasarela (pasarela_id nulo).
-- =====================================================================
BEGIN;

ALTER TABLE transaccion_pago ADD COLUMN IF NOT EXISTS buy_order VARCHAR(26);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'transaccion_pago'::regclass AND conname = 'transaccion_pago_buy_order_key') THEN
        ALTER TABLE transaccion_pago ADD CONSTRAINT transaccion_pago_buy_order_key UNIQUE (buy_order);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'transaccion_pago'::regclass AND conname = 'transaccion_pago_check') THEN
        ALTER TABLE transaccion_pago ADD CONSTRAINT transaccion_pago_check CHECK (pasarela_id IS NULL OR buy_order IS NOT NULL);
    END IF;
END $$;
COMMENT ON COLUMN transaccion_pago.buy_order IS 'Orden de compra enviada a Webpay Plus (máx. 26 caracteres). Obligatoria cuando hay pasarela.';

INSERT INTO estado_transaccion (nombre) VALUES ('Abortado') ON CONFLICT (nombre) DO NOTHING;

ALTER TABLE proveedor ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT TRUE NOT NULL;
ALTER TABLE categoria ADD COLUMN IF NOT EXISTS activa BOOLEAN DEFAULT TRUE NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_prod_prov_principal ON producto_proveedor(producto_id) WHERE es_principal;

GRANT INSERT (buy_order) ON transaccion_pago TO app_backend;

COMMIT;
