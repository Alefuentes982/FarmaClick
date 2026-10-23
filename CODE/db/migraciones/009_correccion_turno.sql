-- =====================================================================
-- 009 — Cuadratura: corrección de montos del turno, observaciones y autorrevisión del Administrador
-- Ejecutar UNA vez sobre la base existente (editor SQL de Supabase). Es seguro repetirla.
--   * turno_correccion: corrige un error de digitación en el efectivo de apertura o en el contado del cierre.
--     Solo la hace un usuario con rol Administrador, con motivo obligatorio y mientras el turno no esté revisado.
--     Guarda el valor anterior y el nuevo (y el esperado antes y después): nada se pierde. Inmutable.
--   * fn_corregir_turno: única vía para corregir. Valida las reglas, actualiza el turno, recalcula el efectivo
--     esperado si el turno está cerrado y registra la corrección, todo en la misma operación.
--   * turno_observacion: notas sobre un turno (quién, cuándo, qué). Se agregan, nunca se editan ni se borran.
--   * Revisión: el Administrador puede revisar su propio turno; el resto (Jefe de local) sigue sin poder hacerlo.
-- Contrato de nombres: el rol 'Administrador' no debe renombrarse desde la interfaz.
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- Correcciones
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS turno_correccion (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    turno_caja_id UUID NOT NULL REFERENCES turno_caja(id) ON DELETE RESTRICT,
    usuario_id UUID NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
    fecha TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    campo VARCHAR(10) NOT NULL CHECK (campo IN ('apertura', 'cierre')),
    valor_anterior NUMERIC(12,2) NOT NULL,
    valor_nuevo NUMERIC(12,2) NOT NULL CHECK (valor_nuevo >= 0),
    esperado_anterior NUMERIC(12,2),
    esperado_nuevo NUMERIC(12,2),
    motivo VARCHAR(500) NOT NULL CHECK (LENGTH(BTRIM(motivo)) >= 10),
    CHECK (valor_nuevo <> valor_anterior)
);
CREATE INDEX IF NOT EXISTS idx_turno_correccion_turno ON turno_correccion(turno_caja_id, fecha);
CREATE INDEX IF NOT EXISTS idx_turno_correccion_usuario ON turno_correccion(usuario_id);

COMMENT ON TABLE  turno_correccion IS 'Corrección de un monto digitado en un turno de caja (apertura o contado del cierre). Solo Administrador, con motivo, antes de la revisión. Inmutable; se escribe solo con fn_corregir_turno.';
COMMENT ON COLUMN turno_correccion.campo IS 'apertura = monto_apertura_efectivo; cierre = monto_cierre_real_efectivo (efectivo contado).';
COMMENT ON COLUMN turno_correccion.esperado_anterior IS 'Efectivo esperado del turno antes de la corrección (solo turnos cerrados).';

-- ---------------------------------------------------------------------
-- Observaciones
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS turno_observacion (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    turno_caja_id UUID NOT NULL REFERENCES turno_caja(id) ON DELETE RESTRICT,
    usuario_id UUID NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
    fecha TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    texto VARCHAR(1000) NOT NULL CHECK (LENGTH(BTRIM(texto)) >= 3)
);
CREATE INDEX IF NOT EXISTS idx_turno_observacion_turno ON turno_observacion(turno_caja_id, fecha);
CREATE INDEX IF NOT EXISTS idx_turno_observacion_usuario ON turno_observacion(usuario_id);

COMMENT ON TABLE turno_observacion IS 'Notas sobre un turno de caja (cuadratura). Se agregan en cualquier estado del turno; inmutables.';

-- Ambas tablas son inmutables, como el kardex, las devoluciones y las revisiones.
CREATE OR REPLACE FUNCTION trg_registro_turno_inmutable() RETURNS TRIGGER SECURITY DEFINER SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'Las correcciones y observaciones de un turno son inmutables: registre una nueva.'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS inmutable_turno_correccion ON turno_correccion;
CREATE TRIGGER inmutable_turno_correccion BEFORE UPDATE OR DELETE ON turno_correccion FOR EACH ROW EXECUTE FUNCTION trg_registro_turno_inmutable();
DROP TRIGGER IF EXISTS inmutable_turno_observacion ON turno_observacion;
CREATE TRIGGER inmutable_turno_observacion BEFORE UPDATE OR DELETE ON turno_observacion FOR EACH ROW EXECUTE FUNCTION trg_registro_turno_inmutable();

-- ---------------------------------------------------------------------
-- ¿El usuario es Administrador (activo)?
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_es_administrador(p_usuario UUID) RETURNS BOOLEAN STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM usuario u JOIN rol r ON r.id = u.rol_id
                    WHERE u.id = p_usuario AND u.activo AND r.nombre = 'Administrador');
$$ LANGUAGE sql;

-- ---------------------------------------------------------------------
-- Corrección de un monto del turno. Quien corrige se toma de app.usuario_id (lo fija el backend en la transacción).
--   p_campo: 'apertura' | 'cierre'.  Devuelve el id de la corrección.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_corregir_turno(p_turno_id UUID, p_campo TEXT, p_valor NUMERIC, p_motivo TEXT)
RETURNS UUID SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_usuario UUID := NULLIF(current_setting('app.usuario_id', true), '')::uuid;
    t turno_caja%ROWTYPE;
    v_anterior NUMERIC; v_esp_ant NUMERIC; v_esp_nuevo NUMERIC; v_id UUID;
BEGIN
    IF v_usuario IS NULL THEN RAISE EXCEPTION 'Falta el usuario que corrige (app.usuario_id).'; END IF;
    IF NOT fn_es_administrador(v_usuario) THEN RAISE EXCEPTION 'Solo un Administrador puede corregir los montos de un turno.'; END IF;
    IF p_campo NOT IN ('apertura', 'cierre') THEN RAISE EXCEPTION 'Campo a corregir inválido: %.', p_campo; END IF;
    IF p_valor IS NULL OR p_valor < 0 THEN RAISE EXCEPTION 'El monto corregido debe ser mayor o igual a cero.'; END IF;
    IF LENGTH(BTRIM(COALESCE(p_motivo, ''))) < 10 THEN RAISE EXCEPTION 'Explique el motivo de la corrección (al menos 10 caracteres).'; END IF;

    SELECT * INTO t FROM turno_caja WHERE id = p_turno_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Turno inexistente.'; END IF;
    IF EXISTS (SELECT 1 FROM turno_revision WHERE turno_caja_id = p_turno_id) THEN
        RAISE EXCEPTION 'El turno ya fue revisado: sus montos no se pueden corregir. Agregue una observación.';
    END IF;
    IF p_campo = 'cierre' AND t.fecha_cierre IS NULL THEN RAISE EXCEPTION 'El contado del cierre solo se corrige en un turno cerrado.'; END IF;

    v_anterior := CASE p_campo WHEN 'apertura' THEN t.monto_apertura_efectivo ELSE t.monto_cierre_real_efectivo END;
    IF v_anterior = p_valor THEN RAISE EXCEPTION 'El monto corregido es igual al registrado.'; END IF;

    IF p_campo = 'apertura' THEN
        UPDATE turno_caja SET monto_apertura_efectivo = p_valor WHERE id = p_turno_id;
    ELSE
        UPDATE turno_caja SET monto_cierre_real_efectivo = p_valor WHERE id = p_turno_id;
    END IF;

    -- En un turno cerrado el esperado está congelado: se recalcula con la apertura corregida.
    IF t.fecha_cierre IS NOT NULL THEN
        v_esp_ant := t.monto_cierre_esperado_efectivo;
        v_esp_nuevo := fn_cierre_esperado_efectivo(p_turno_id);
        UPDATE turno_caja SET monto_cierre_esperado_efectivo = v_esp_nuevo WHERE id = p_turno_id;
    END IF;

    INSERT INTO turno_correccion (turno_caja_id, usuario_id, campo, valor_anterior, valor_nuevo, esperado_anterior, esperado_nuevo, motivo)
    VALUES (p_turno_id, v_usuario, p_campo, v_anterior, p_valor, v_esp_ant, v_esp_nuevo, BTRIM(p_motivo))
    RETURNING id INTO v_id;
    RETURN v_id;
END; $$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- Revisión: nadie revisa su propio turno, salvo el Administrador.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_validar_turno_revision() RETURNS TRIGGER SECURITY DEFINER SET search_path = public AS $$
DECLARE v_usuario UUID; v_cierre TIMESTAMPTZ;
BEGIN
    SELECT usuario_id, fecha_cierre INTO v_usuario, v_cierre FROM turno_caja WHERE id = NEW.turno_caja_id;
    IF v_cierre IS NULL THEN RAISE EXCEPTION 'Solo se revisa un turno cerrado.'; END IF;
    IF v_usuario = NEW.usuario_id AND NOT fn_es_administrador(NEW.usuario_id) THEN
        RAISE EXCEPTION 'Nadie puede revisar su propio turno, salvo el Administrador.';
    END IF;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;
COMMENT ON TABLE turno_revision IS 'Visto bueno de la cuadratura de un turno cerrado. Una por turno, inmutable. El revisor no puede ser quien abrió el turno, salvo el Administrador.';

-- ---------------------------------------------------------------------
-- Seguridad (mismo criterio que el resto del esquema)
-- ---------------------------------------------------------------------
DO $$
DECLARE r TEXT; tabla TEXT;
BEGIN
    FOREACH tabla IN ARRAY ARRAY['turno_correccion', 'turno_observacion'] LOOP
        FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
                EXECUTE format('REVOKE ALL ON %I FROM %I', tabla, r);
            END IF;
        END LOOP;
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tabla);
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = tabla AND policyname = 'p_backend_all') THEN
            EXECUTE format('CREATE POLICY p_backend_all ON public.%I FOR ALL TO app_backend USING (true) WITH CHECK (true)', tabla);
        END IF;
    END LOOP;
END $$;
GRANT SELECT ON turno_correccion TO app_backend;                    -- se escribe solo con fn_corregir_turno
GRANT SELECT, INSERT ON turno_observacion TO app_backend;           -- sin UPDATE/DELETE
REVOKE ALL ON FUNCTION fn_corregir_turno(UUID, TEXT, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_corregir_turno(UUID, TEXT, NUMERIC, TEXT) TO app_backend;
GRANT EXECUTE ON FUNCTION fn_es_administrador(UUID) TO app_backend;

COMMIT;
