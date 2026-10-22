-- =====================================================================
-- 010 — Caja: cierre automático a las 23:59, farmacia de turno, cierre por fuerza mayor y arqueo posterior
-- Ejecutar UNA vez sobre la base existente (editor SQL de Supabase). Es seguro repetirla.
-- Después, en Supabase: SELECT fn_programar_jobs();  (agrega el job del cierre automático).
--   * sucursal.farmacia_de_turno: la sucursal atiende 24 horas y sus turnos NO se cierran solos.
--   * Cierre automático (fn_cierre_automatico_turnos): a las 23:59 (hora de Chile) cierra los turnos que sigan
--     abiertos en las demás sucursales. No inventa el efectivo: el contado queda vacío ("pendiente de arqueo").
--     También cierra turnos que quedaron abiertos de un día anterior (por si el job no corrió).
--   * Cierre por fuerza mayor (fn_cerrar_turno_forzado): el Administrador o el Jefe de local cierran el turno de
--     otra persona con el efectivo contado y un motivo.
--   * Arqueo (fn_registrar_arqueo): el Administrador o el Jefe de local registran el contado de un turno cerrado
--     automáticamente. Recién entonces hay diferencia y se puede revisar.
--   * Revisión: el Administrador y el Jefe de local pueden revisar su propio turno; la revisión cruzada queda
--     solo para los cajeros. No se revisa un turno con arqueo pendiente.
--   * El Jefe de local actúa sobre las cajas de su sucursal (si tiene una asignada); el Administrador, sobre todas.
--   * turno_aviso: registro de los recordatorios por correo ya enviados (evita duplicados).
-- Contrato de nombres: los roles 'Administrador' y 'Jefe de local' no deben renombrarse desde la interfaz.
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- Columnas nuevas
-- ---------------------------------------------------------------------
ALTER TABLE sucursal ADD COLUMN IF NOT EXISTS farmacia_de_turno BOOLEAN DEFAULT FALSE NOT NULL;
COMMENT ON COLUMN sucursal.farmacia_de_turno IS 'Atiende 24 horas: sus turnos de caja no se cierran automáticamente a las 23:59.';

ALTER TABLE turno_caja ADD COLUMN IF NOT EXISTS cierre_tipo VARCHAR(12);
ALTER TABLE turno_caja ADD COLUMN IF NOT EXISTS cerrado_por UUID REFERENCES usuario(id) ON DELETE RESTRICT;
ALTER TABLE turno_caja ADD COLUMN IF NOT EXISTS cierre_motivo VARCHAR(500);
ALTER TABLE turno_caja ADD COLUMN IF NOT EXISTS arqueo_por UUID REFERENCES usuario(id) ON DELETE RESTRICT;
ALTER TABLE turno_caja ADD COLUMN IF NOT EXISTS arqueo_fecha TIMESTAMPTZ;
COMMENT ON COLUMN turno_caja.cierre_tipo IS 'normal = lo cerró quien lo abrió; automatico = el sistema a las 23:59 (contado pendiente hasta el arqueo); forzado = Administrador o Jefe de local por fuerza mayor.';
COMMENT ON COLUMN turno_caja.cerrado_por IS 'Quién cerró el turno (en el cierre automático, el usuario de sistema).';
COMMENT ON COLUMN turno_caja.cierre_motivo IS 'Motivo del cierre por fuerza mayor.';
COMMENT ON COLUMN turno_caja.arqueo_por IS 'Quién registró el contado de un turno cerrado automáticamente.';
COMMENT ON COLUMN turno_caja.monto_cierre_real_efectivo IS 'Efectivo contado. Vacío solo en un turno cerrado automáticamente mientras no se registre el arqueo.';

-- Turnos cerrados antes de esta migración: cierre normal hecho por quien los abrió.
UPDATE turno_caja SET cierre_tipo = 'normal', cerrado_por = usuario_id WHERE fecha_cierre IS NOT NULL AND cierre_tipo IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'turno_caja'::regclass AND conname = 'turno_caja_cierre_tipo_check') THEN
        ALTER TABLE turno_caja ADD CONSTRAINT turno_caja_cierre_tipo_check
            CHECK (cierre_tipo IN ('normal', 'automatico', 'forzado') AND fecha_cierre IS NOT NULL OR cierre_tipo IS NULL AND fecha_cierre IS NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'turno_caja'::regclass AND conname = 'turno_caja_contado_check') THEN
        ALTER TABLE turno_caja ADD CONSTRAINT turno_caja_contado_check
            CHECK (fecha_cierre IS NULL OR monto_cierre_real_efectivo IS NOT NULL OR cierre_tipo = 'automatico');
    END IF;
END $$;

-- ---------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------
-- Administrador o Jefe de local, activo.
CREATE OR REPLACE FUNCTION fn_es_supervisor_caja(p_usuario UUID) RETURNS BOOLEAN STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM usuario u JOIN rol r ON r.id = u.rol_id
                    WHERE u.id = p_usuario AND u.activo AND r.nombre IN ('Administrador', 'Jefe de local'));
$$ LANGUAGE sql;

-- ¿El usuario puede operar sobre esta caja? El Administrador, sobre todas; el Jefe de local, sobre las de su
-- sucursal (o todas, si no tiene una asignada).
CREATE OR REPLACE FUNCTION fn_supervisa_caja(p_usuario UUID, p_caja UUID) RETURNS BOOLEAN STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT fn_es_administrador(p_usuario)
        OR (fn_es_supervisor_caja(p_usuario)
            AND (SELECT u.sucursal_id IS NULL OR u.sucursal_id = c.sucursal_id
                   FROM usuario u, caja c WHERE u.id = p_usuario AND c.id = p_caja));
$$ LANGUAGE sql;

-- ---------------------------------------------------------------------
-- Cerrar un turno: quien lo abrió, o una función autorizada (cierre automático o por fuerza mayor)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_cierre_solo_quien_abrio() RETURNS TRIGGER SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF OLD.fecha_cierre IS NULL AND NEW.fecha_cierre IS NOT NULL
       AND COALESCE(current_setting('app.cierre_autorizado', true), '') <> 'on'
       AND NULLIF(current_setting('app.usuario_id', true), '')::uuid IS DISTINCT FROM OLD.usuario_id THEN
        RAISE EXCEPTION 'Solo quien abrió el turno puede cerrarlo.';
    END IF;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- Cierre normal (lo hace quien abrió el turno): ahora registra el tipo y quién cerró.
CREATE OR REPLACE FUNCTION fn_cerrar_turno(p_turno_id UUID, p_monto_real NUMERIC) RETURNS NUMERIC SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cierre TIMESTAMPTZ; v_usuario UUID; v_esperado NUMERIC;
BEGIN
    IF p_monto_real IS NULL OR p_monto_real < 0 THEN RAISE EXCEPTION 'El efectivo contado debe ser un monto mayor o igual a cero.'; END IF;
    SELECT fecha_cierre, usuario_id INTO v_cierre, v_usuario FROM turno_caja WHERE id = p_turno_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Turno inexistente.'; END IF;
    IF v_cierre IS NOT NULL THEN RAISE EXCEPTION 'El turno ya está cerrado.'; END IF;
    v_esperado := fn_cierre_esperado_efectivo(p_turno_id);
    UPDATE turno_caja SET fecha_cierre = NOW(), monto_cierre_esperado_efectivo = v_esperado, monto_cierre_real_efectivo = p_monto_real,
                          cierre_tipo = 'normal', cerrado_por = v_usuario
     WHERE id = p_turno_id;
    RETURN p_monto_real - v_esperado;
END; $$ LANGUAGE plpgsql;

-- Cierre por fuerza mayor: el Administrador o el Jefe de local cierran el turno de otra persona con el contado y un motivo.
CREATE OR REPLACE FUNCTION fn_cerrar_turno_forzado(p_turno_id UUID, p_monto_real NUMERIC, p_motivo TEXT) RETURNS NUMERIC
SECURITY DEFINER SET search_path = public AS $$
DECLARE v_usuario UUID := NULLIF(current_setting('app.usuario_id', true), '')::uuid; t turno_caja%ROWTYPE; v_esperado NUMERIC;
BEGIN
    IF v_usuario IS NULL THEN RAISE EXCEPTION 'Falta el usuario que cierra (app.usuario_id).'; END IF;
    IF p_monto_real IS NULL OR p_monto_real < 0 THEN RAISE EXCEPTION 'El efectivo contado debe ser un monto mayor o igual a cero.'; END IF;
    IF LENGTH(BTRIM(COALESCE(p_motivo, ''))) < 10 THEN RAISE EXCEPTION 'Explique el motivo del cierre (al menos 10 caracteres).'; END IF;
    SELECT * INTO t FROM turno_caja WHERE id = p_turno_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Turno inexistente.'; END IF;
    IF NOT fn_supervisa_caja(v_usuario, t.caja_id) THEN
        RAISE EXCEPTION 'Solo el Administrador o el Jefe de local de la sucursal pueden cerrar el turno de otra persona.';
    END IF;
    IF t.fecha_cierre IS NOT NULL THEN RAISE EXCEPTION 'El turno ya está cerrado.'; END IF;
    IF t.usuario_id = v_usuario THEN RAISE EXCEPTION 'Es su propio turno: ciérrelo desde la caja.'; END IF;
    v_esperado := fn_cierre_esperado_efectivo(p_turno_id);
    PERFORM set_config('app.cierre_autorizado', 'on', true);
    UPDATE turno_caja SET fecha_cierre = NOW(), monto_cierre_esperado_efectivo = v_esperado, monto_cierre_real_efectivo = p_monto_real,
                          cierre_tipo = 'forzado', cerrado_por = v_usuario, cierre_motivo = BTRIM(p_motivo)
     WHERE id = p_turno_id;
    PERFORM set_config('app.cierre_autorizado', 'off', true);
    RETURN p_monto_real - v_esperado;
END; $$ LANGUAGE plpgsql;

-- Cierre automático: turnos abiertos de sucursales que no son farmacia de turno, a partir de las 23:59 (Chile), y
-- cualquier turno de esas sucursales que siga abierto desde un día anterior. El contado queda pendiente de arqueo.
-- Se puede llamar en cualquier momento (pg_cron cada hora al minuto 59, y la API cada pocos minutos): si no
-- corresponde cerrar nada, no hace nada. Devuelve cuántos turnos cerró.
CREATE OR REPLACE FUNCTION fn_cierre_automatico_turnos() RETURNS INTEGER SECURITY DEFINER SET search_path = public AS $$
DECLARE v_local TIMESTAMP := NOW() AT TIME ZONE 'America/Santiago'; v_sis UUID; v_n INTEGER := 0; r RECORD;
BEGIN
    SELECT id INTO v_sis FROM usuario WHERE correo = 'sistema@farmaclick.cl';
    IF v_sis IS NULL THEN RAISE EXCEPTION 'Falta el usuario de sistema (sistema@farmaclick.cl).'; END IF;
    PERFORM set_config('app.cierre_autorizado', 'on', true);
    FOR r IN
        SELECT t.id FROM turno_caja t JOIN caja c ON c.id = t.caja_id JOIN sucursal s ON s.id = c.sucursal_id
         WHERE t.fecha_cierre IS NULL AND NOT s.farmacia_de_turno
           AND (v_local::time >= TIME '23:59' OR (t.fecha_apertura AT TIME ZONE 'America/Santiago')::date < v_local::date)
         FOR UPDATE OF t SKIP LOCKED
    LOOP
        UPDATE turno_caja SET fecha_cierre = NOW(), monto_cierre_esperado_efectivo = fn_cierre_esperado_efectivo(r.id),
                              monto_cierre_real_efectivo = NULL, cierre_tipo = 'automatico', cerrado_por = v_sis
         WHERE id = r.id;
        v_n := v_n + 1;
    END LOOP;
    PERFORM set_config('app.cierre_autorizado', 'off', true);
    RETURN v_n;
END; $$ LANGUAGE plpgsql;

-- Arqueo de un turno cerrado automáticamente: el Administrador o el Jefe de local registran el efectivo contado.
CREATE OR REPLACE FUNCTION fn_registrar_arqueo(p_turno_id UUID, p_monto_real NUMERIC, p_observacion TEXT) RETURNS NUMERIC
SECURITY DEFINER SET search_path = public AS $$
DECLARE v_usuario UUID := NULLIF(current_setting('app.usuario_id', true), '')::uuid; t turno_caja%ROWTYPE;
BEGIN
    IF v_usuario IS NULL THEN RAISE EXCEPTION 'Falta el usuario que registra el arqueo (app.usuario_id).'; END IF;
    IF p_monto_real IS NULL OR p_monto_real < 0 THEN RAISE EXCEPTION 'El efectivo contado debe ser un monto mayor o igual a cero.'; END IF;
    SELECT * INTO t FROM turno_caja WHERE id = p_turno_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Turno inexistente.'; END IF;
    IF NOT fn_supervisa_caja(v_usuario, t.caja_id) THEN
        RAISE EXCEPTION 'Solo el Administrador o el Jefe de local de la sucursal pueden registrar el arqueo.';
    END IF;
    IF t.cierre_tipo IS DISTINCT FROM 'automatico' OR t.monto_cierre_real_efectivo IS NOT NULL THEN
        RAISE EXCEPTION 'Este turno no tiene un arqueo pendiente.';
    END IF;
    UPDATE turno_caja SET monto_cierre_real_efectivo = p_monto_real, arqueo_por = v_usuario, arqueo_fecha = NOW() WHERE id = p_turno_id;
    IF LENGTH(BTRIM(COALESCE(p_observacion, ''))) >= 3 THEN
        INSERT INTO turno_observacion (turno_caja_id, usuario_id, texto) VALUES (p_turno_id, v_usuario, BTRIM(p_observacion));
    END IF;
    RETURN p_monto_real - t.monto_cierre_esperado_efectivo;
END; $$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- Revisión: el Administrador y el Jefe de local pueden revisar su propio turno; nadie revisa con arqueo pendiente.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_validar_turno_revision() RETURNS TRIGGER SECURITY DEFINER SET search_path = public AS $$
DECLARE v_usuario UUID; v_cierre TIMESTAMPTZ; v_contado NUMERIC;
BEGIN
    SELECT usuario_id, fecha_cierre, monto_cierre_real_efectivo INTO v_usuario, v_cierre, v_contado FROM turno_caja WHERE id = NEW.turno_caja_id;
    IF v_cierre IS NULL THEN RAISE EXCEPTION 'Solo se revisa un turno cerrado.'; END IF;
    IF v_contado IS NULL THEN RAISE EXCEPTION 'El turno tiene el arqueo pendiente: registre el efectivo contado antes de revisarlo.'; END IF;
    IF v_usuario = NEW.usuario_id AND NOT fn_es_supervisor_caja(NEW.usuario_id) THEN
        RAISE EXCEPTION 'Nadie puede revisar su propio turno, salvo el Administrador o el Jefe de local.';
    END IF;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;
COMMENT ON TABLE turno_revision IS 'Visto bueno de la cuadratura de un turno cerrado. Una por turno, inmutable. El revisor no puede ser quien abrió el turno, salvo el Administrador o el Jefe de local.';

-- Corrección (009): el contado de un turno con arqueo pendiente no se corrige, se registra con el arqueo.
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
    IF p_campo = 'cierre' AND t.monto_cierre_real_efectivo IS NULL THEN
        RAISE EXCEPTION 'El turno tiene el arqueo pendiente: registre el efectivo contado con el arqueo.';
    END IF;

    v_anterior := CASE p_campo WHEN 'apertura' THEN t.monto_apertura_efectivo ELSE t.monto_cierre_real_efectivo END;
    IF v_anterior = p_valor THEN RAISE EXCEPTION 'El monto corregido es igual al registrado.'; END IF;

    IF p_campo = 'apertura' THEN
        UPDATE turno_caja SET monto_apertura_efectivo = p_valor WHERE id = p_turno_id;
    ELSE
        UPDATE turno_caja SET monto_cierre_real_efectivo = p_valor WHERE id = p_turno_id;
    END IF;

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
-- Avisos por correo ya enviados (recordatorios de cierre y aviso de cierre automático): uno por turno y tipo.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS turno_aviso (
    turno_caja_id UUID NOT NULL REFERENCES turno_caja(id) ON DELETE RESTRICT,
    tipo VARCHAR(30) NOT NULL CHECK (tipo ~ '^[a-z0-9_]+$'),
    enviado_en TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    destinatarios INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (turno_caja_id, tipo)
);
COMMENT ON TABLE turno_aviso IS 'Avisos por correo enviados para un turno (recordatorio_60, recordatorio_30, cierre_automatico). Evita enviarlos dos veces.';

-- ---------------------------------------------------------------------
-- Job del cierre automático (pg_cron, cada hora al minuto 59: las 23:59 de Chile caen siempre en un minuto 59 UTC)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_programar_jobs() RETURNS TEXT SET search_path = public AS $$
DECLARE v_sis UUID;
BEGIN
    IF to_regnamespace('cron') IS NULL THEN
        RETURN 'pg_cron no está habilitado. Habilítelo (Supabase: Database > Extensions) y ejecute SELECT fn_programar_jobs();';
    END IF;
    SELECT id INTO v_sis FROM usuario WHERE correo = 'sistema@farmaclick.cl';
    IF v_sis IS NULL THEN RAISE EXCEPTION 'Falta el usuario de sistema (sistema@farmaclick.cl).'; END IF;
    EXECUTE format('SELECT cron.schedule(%L, %L, %L)', 'farmaclick-liberar-reservas', '*/5 * * * *',
                   format('SELECT public.fn_liberar_reservas_vencidas(20, %L::uuid)', v_sis));
    EXECUTE format('SELECT cron.schedule(%L, %L, %L)', 'farmaclick-baja-vencidos', '0 5 * * *',
                   format('SELECT public.fn_baja_lotes_vencidos(%L::uuid)', v_sis));
    EXECUTE format('SELECT cron.schedule(%L, %L, %L)', 'farmaclick-cierre-automatico', '59 * * * *',
                   'SELECT public.fn_cierre_automatico_turnos()');
    RETURN 'Jobs programados: farmaclick-liberar-reservas, farmaclick-baja-vencidos y farmaclick-cierre-automatico.';
END; $$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- Seguridad
-- ---------------------------------------------------------------------
DO $$
DECLARE r TEXT;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON turno_aviso FROM %I', r);
        END IF;
    END LOOP;
    ALTER TABLE public.turno_aviso ENABLE ROW LEVEL SECURITY;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'turno_aviso' AND policyname = 'p_backend_all') THEN
        CREATE POLICY p_backend_all ON public.turno_aviso FOR ALL TO app_backend USING (true) WITH CHECK (true);
    END IF;
END $$;
GRANT SELECT, INSERT ON turno_aviso TO app_backend;
REVOKE ALL ON FUNCTION fn_cerrar_turno_forzado(UUID, NUMERIC, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_registrar_arqueo(UUID, NUMERIC, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_cierre_automatico_turnos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_cerrar_turno_forzado(UUID, NUMERIC, TEXT) TO app_backend;
GRANT EXECUTE ON FUNCTION fn_registrar_arqueo(UUID, NUMERIC, TEXT) TO app_backend;
GRANT EXECUTE ON FUNCTION fn_cierre_automatico_turnos() TO app_backend;
GRANT EXECUTE ON FUNCTION fn_es_supervisor_caja(UUID) TO app_backend;
GRANT EXECUTE ON FUNCTION fn_supervisa_caja(UUID, UUID) TO app_backend;

-- Si pg_cron está disponible, se agrega el job ahora; si no, queda para SELECT fn_programar_jobs();
DO $$
BEGIN
    RAISE NOTICE '%', fn_programar_jobs();
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'No se pudieron programar los jobs (%). Ejecute más tarde: SELECT fn_programar_jobs();', SQLERRM;
END $$;

COMMIT;
