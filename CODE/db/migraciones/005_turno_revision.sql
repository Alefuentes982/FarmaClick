-- =====================================================================
-- 005 — Cuadratura: revisión de turnos de caja cerrados
-- Ejecutar UNA vez sobre la base existente (editor SQL de Supabase). Es seguro repetirla.
--   * turno_revision: una revisión por turno cerrado, hecha por alguien distinto de quien lo abrió.
--     "conforme" = la cuadratura está bien; si no, la observación explica la diferencia (obligatoria).
--   * Inmutable: la revisión no se modifica ni se borra (como el kardex y las devoluciones).
-- Los datos del turno (esperado, contado) ya los congela fn_cerrar_turno; esta tabla solo agrega el visto bueno.
-- =====================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS turno_revision (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    turno_caja_id UUID NOT NULL UNIQUE REFERENCES turno_caja(id) ON DELETE RESTRICT,
    usuario_id UUID NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
    fecha TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    conforme BOOLEAN NOT NULL,
    observacion VARCHAR(500),
    CHECK (conforme OR LENGTH(BTRIM(COALESCE(observacion, ''))) >= 3)
);
CREATE INDEX IF NOT EXISTS idx_turno_revision_usuario ON turno_revision(usuario_id);

COMMENT ON TABLE  turno_revision IS 'Visto bueno de la cuadratura de un turno cerrado. Una por turno, inmutable, y el revisor no puede ser quien abrió el turno.';
COMMENT ON COLUMN turno_revision.conforme IS 'TRUE = revisado conforme; FALSE = revisado con observaciones (la observación es obligatoria).';

CREATE OR REPLACE FUNCTION trg_validar_turno_revision() RETURNS TRIGGER SECURITY DEFINER SET search_path = public AS $$
DECLARE v_usuario UUID; v_cierre TIMESTAMPTZ;
BEGIN
    SELECT usuario_id, fecha_cierre INTO v_usuario, v_cierre FROM turno_caja WHERE id = NEW.turno_caja_id;
    IF v_cierre IS NULL THEN RAISE EXCEPTION 'Solo se revisa un turno cerrado.'; END IF;
    IF v_usuario = NEW.usuario_id THEN RAISE EXCEPTION 'Nadie puede revisar su propio turno.'; END IF;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS val_turno_revision ON turno_revision;
CREATE TRIGGER val_turno_revision BEFORE INSERT ON turno_revision FOR EACH ROW EXECUTE FUNCTION trg_validar_turno_revision();

CREATE OR REPLACE FUNCTION trg_turno_revision_inmutable() RETURNS TRIGGER SECURITY DEFINER SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'Las revisiones de turno son inmutables.'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS inmutable_turno_revision ON turno_revision;
CREATE TRIGGER inmutable_turno_revision BEFORE UPDATE OR DELETE ON turno_revision FOR EACH ROW EXECUTE FUNCTION trg_turno_revision_inmutable();

-- Seguridad (mismo criterio que el resto del esquema)
DO $$
DECLARE r TEXT;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON turno_revision FROM %I', r);
        END IF;
    END LOOP;
    ALTER TABLE public.turno_revision ENABLE ROW LEVEL SECURITY;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'turno_revision' AND policyname = 'p_backend_all') THEN
        CREATE POLICY p_backend_all ON public.turno_revision FOR ALL TO app_backend USING (true) WITH CHECK (true);
    END IF;
END $$;
GRANT SELECT, INSERT ON turno_revision TO app_backend;   -- sin UPDATE/DELETE

COMMIT;
