-- =====================================================================
-- FarmaClick — Modelo físico PostgreSQL (Supabase) — VERSIÓN COMPLETA
-- Proyecto de título: MediFarm × D-Software
--
-- USO: ejecutar UNA vez sobre una base NUEVA (por ejemplo, el editor SQL de
-- Supabase). Todo el script corre en una sola transacción: si algo falla, no
-- queda nada a medias. Requiere PostgreSQL 15 o superior.
--
-- QUÉ INCLUYE
--   1. Roles y extensiones            5. Funciones de negocio (reserva FEFO,
--   2. Catálogos y tablas maestras       liberación, vencidos, Cierre Z)
--   3. Inventario, ventas y caja      6. Vistas, jobs (pg_cron) y datos semilla
--   4. Triggers de integridad         7. Seguridad (permisos mínimos + RLS)
--
-- DIFERENCIAS RESPECTO A FarmaClickDB_8_Postgre (para actualizar los diagramas)
--   * condicion_venta.permite_venta_online  (nuevo; hace cumplir el filtro online)
--   * transaccion_pago.pedido_id ahora es ON DELETE RESTRICT (auditoría de pagos)
--   * Triggers nuevos: congelar líneas del pedido, totales de orden de compra,
--     regla de condición de venta online, bloqueo de TRUNCATE en el kardex
--   * Funciones nuevas: fn_reservar_pedido (reemplaza a fn_reservar_stock),
--     fn_liberar_reserva, fn_liberar_reservas_vencidas, fn_baja_lotes_vencidos,
--     fn_cierre_esperado_efectivo, fn_cerrar_turno, fn_programar_jobs
--   * Vistas: vw_catalogo_web, vw_stock_disponible
--   * Seguridad: se aplica AL FINAL; permisos por columna; RLS activado
--   * Índices: se restituyeron los que se habían perdido
--
-- CAMBIOS DE ESTA REVISIÓN (v2, sobre el script original)
--   * transaccion_pago.buy_order VARCHAR(26) UNIQUE (+ CHECK): Webpay Plus exige una orden de compra de
--     hasta 26 caracteres y el uuid del pedido tiene 36, así que no puede usarse como buy_order.
--   * estado_transaccion: se agrega 'Abortado' (pago cancelado por el cliente o expirado en Webpay).
--   * proveedor.activo y categoria.activa: baja lógica sin perder historial (como el resto de maestros).
--   * Índice único parcial uq_prod_prov_principal: un solo proveedor principal por producto.
--
-- CONTRATO DE NOMBRES (los usan las funciones; vienen sembrados y NO deben
-- renombrarse desde la interfaz):
--   estado_pedido:     'Pago pendiente', 'Expirado'
--   estado_transaccion:'Aprobado'        medio_pago: 'Efectivo'
--   motivo_movimiento: 'Venta', 'Liberación de reserva', 'Producto vencido',
--                      'Recepción OC'
--
-- CÓMO LO USA EL BACKEND (Node.js, rol app_backend, pooler en modo transacción)
--   BEGIN;
--   SELECT set_config('app.usuario_id', '<uuid del usuario autenticado>', true);
--   ...operaciones (fn_reservar_pedido, fn_cerrar_turno, INSERT/UPDATE)...
--   COMMIT;
--   La identidad debe fijarse DENTRO de cada transacción, nunca con SET de sesión.
--
-- DESPUÉS DE EJECUTAR (fuera del repositorio):
--   ALTER ROLE app_backend LOGIN PASSWORD '<secreto>';
--   Si pg_cron no estaba habilitado: habilitarlo y ejecutar SELECT fn_programar_jobs();
-- =====================================================================
BEGIN;

DO $$ BEGIN
    IF current_setting('server_version_num')::int < 150000 THEN
        RAISE EXCEPTION 'FarmaClick requiere PostgreSQL 15 o superior (UNIQUE NULLS NOT DISTINCT).';
    END IF;
END $$;

-- =====================================================================
-- 1. EXTENSIONES Y ROLES
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- restricción de exclusión de promociones

DO $$ BEGIN
    BEGIN
        CREATE EXTENSION IF NOT EXISTS pg_cron;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'pg_cron no disponible (%). Los jobs se programarán después con fn_programar_jobs().', SQLERRM;
    END;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_backend') THEN
        CREATE ROLE app_backend NOLOGIN;
    END IF;
END $$;
GRANT USAGE ON SCHEMA public TO app_backend;

-- =====================================================================
-- 2. CATÁLOGOS Y PARAMÉTRICAS
-- =====================================================================
CREATE TABLE canal_venta (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE,
    requiere_turno BOOLEAN DEFAULT FALSE NOT NULL
);
CREATE TABLE condicion_venta (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE,
    permite_venta_online BOOLEAN DEFAULT FALSE NOT NULL,
    activa BOOLEAN DEFAULT TRUE NOT NULL
);
CREATE TABLE estado_orden_compra ( id UUID DEFAULT gen_random_uuid() PRIMARY KEY, nombre VARCHAR(50) NOT NULL UNIQUE );
CREATE TABLE estado_pedido       ( id UUID DEFAULT gen_random_uuid() PRIMARY KEY, nombre VARCHAR(50) NOT NULL UNIQUE );
CREATE TABLE estado_transaccion  ( id UUID DEFAULT gen_random_uuid() PRIMARY KEY, nombre VARCHAR(50) NOT NULL UNIQUE );
CREATE TABLE medio_pago          ( id UUID DEFAULT gen_random_uuid() PRIMARY KEY, nombre VARCHAR(50) NOT NULL UNIQUE, activo BOOLEAN DEFAULT TRUE NOT NULL );
CREATE TABLE modulo              ( id UUID DEFAULT gen_random_uuid() PRIMARY KEY, nombre VARCHAR(100) NOT NULL, clave VARCHAR(50) NOT NULL UNIQUE );
CREATE TABLE pasarela            ( id UUID DEFAULT gen_random_uuid() PRIMARY KEY, nombre VARCHAR(50) NOT NULL UNIQUE, activa BOOLEAN DEFAULT TRUE NOT NULL );
CREATE TABLE region              ( id UUID DEFAULT gen_random_uuid() PRIMARY KEY, nombre VARCHAR(100) NOT NULL UNIQUE );
CREATE TABLE rol                 ( id UUID DEFAULT gen_random_uuid() PRIMARY KEY, nombre VARCHAR(50) NOT NULL UNIQUE );
CREATE TABLE tipo_movimiento (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE,
    signo SMALLINT NOT NULL CHECK (signo IN (1, -1))
);

-- =====================================================================
-- 3. TABLAS MAESTRAS
-- =====================================================================
CREATE TABLE categoria (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    activa BOOLEAN DEFAULT TRUE NOT NULL,
    margen_pesimista NUMERIC(4,2) NOT NULL CHECK (margen_pesimista >= 0),
    margen_probable  NUMERIC(4,2) NOT NULL,
    margen_optimista NUMERIC(4,2) NOT NULL,
    CHECK (margen_pesimista <= margen_probable AND margen_probable <= margen_optimista)
);

CREATE TABLE comuna (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    region_id UUID NOT NULL REFERENCES region(id) ON DELETE RESTRICT,
    UNIQUE (nombre, region_id)
);

CREATE TABLE motivo_movimiento (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    tipo_movimiento_id UUID NOT NULL REFERENCES tipo_movimiento(id) ON DELETE RESTRICT,
    activo BOOLEAN DEFAULT TRUE NOT NULL
);

CREATE TABLE proveedor (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    rut VARCHAR(12) NOT NULL UNIQUE,
    contacto VARCHAR(150),
    activo BOOLEAN DEFAULT TRUE NOT NULL
);

CREATE TABLE regla_descuento (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL,
    categoria_id UUID REFERENCES categoria(id) ON DELETE RESTRICT,
    cantidad_minima INTEGER NOT NULL CHECK (cantidad_minima > 0),
    cantidad_maxima INTEGER CHECK (cantidad_maxima IS NULL OR cantidad_maxima >= cantidad_minima),
    porcentaje_descuento NUMERIC(5,2) NOT NULL CHECK (porcentaje_descuento >= 0 AND porcentaje_descuento <= 100),
    fecha_inicio TIMESTAMPTZ,
    fecha_fin TIMESTAMPTZ,
    activa BOOLEAN DEFAULT TRUE NOT NULL,
    CHECK (fecha_fin IS NULL OR fecha_inicio IS NULL OR fecha_fin >= fecha_inicio),
    EXCLUDE USING gist (
        COALESCE(categoria_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
        tstzrange(fecha_inicio, fecha_fin) WITH &&,
        int4range(cantidad_minima, cantidad_maxima, '[]') WITH &&
    ) WHERE (activa)
);

CREATE TABLE rol_permiso (
    rol_id UUID NOT NULL REFERENCES rol(id) ON DELETE CASCADE,
    modulo_id UUID NOT NULL REFERENCES modulo(id) ON DELETE CASCADE,
    permitido BOOLEAN DEFAULT FALSE NOT NULL,
    PRIMARY KEY (rol_id, modulo_id)
);

CREATE TABLE sucursal (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    direccion VARCHAR(200),
    telefono VARCHAR(30),
    activa BOOLEAN DEFAULT TRUE NOT NULL,
    habilita_venta_web BOOLEAN DEFAULT FALSE NOT NULL,
    comuna_id UUID NOT NULL REFERENCES comuna(id) ON DELETE RESTRICT
);

CREATE TABLE caja (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    sucursal_id UUID NOT NULL REFERENCES sucursal(id) ON DELETE RESTRICT,
    numero INTEGER NOT NULL CHECK (numero > 0),
    activa BOOLEAN DEFAULT TRUE NOT NULL,
    UNIQUE (sucursal_id, numero)
);

CREATE TABLE usuario (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,   -- para cuentas con login: usar el mismo id de Supabase Auth
    nombre VARCHAR(150) NOT NULL,
    correo VARCHAR(150) NOT NULL UNIQUE,
    rol_id UUID NOT NULL REFERENCES rol(id) ON DELETE RESTRICT,
    sucursal_id UUID REFERENCES sucursal(id) ON DELETE RESTRICT,
    activo BOOLEAN DEFAULT TRUE NOT NULL,
    creado_en TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE cliente (
    usuario_id UUID PRIMARY KEY REFERENCES usuario(id) ON DELETE RESTRICT,
    rut VARCHAR(12) UNIQUE,
    telefono VARCHAR(30),
    direccion_cliente VARCHAR(200),
    comuna_id UUID REFERENCES comuna(id) ON DELETE RESTRICT
);

-- =====================================================================
-- 4. PRODUCTOS, ABASTECIMIENTO E INVENTARIO
-- =====================================================================
CREATE TABLE producto (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    sku VARCHAR(50) NOT NULL UNIQUE,
    nombre VARCHAR(200) NOT NULL,
    costo NUMERIC(12,2) DEFAULT 0 NOT NULL CHECK (costo >= 0),
    margen_utilidad NUMERIC(4,2) NOT NULL CHECK (margen_utilidad >= 0),
    precio NUMERIC(12,2) GENERATED ALWAYS AS (ROUND(costo * (1 + margen_utilidad) * 1.19, 0)) STORED,
    activo BOOLEAN DEFAULT TRUE NOT NULL,
    stock_total_web INTEGER DEFAULT 0 NOT NULL CHECK (stock_total_web >= 0),
    requiere_vencimiento BOOLEAN DEFAULT TRUE NOT NULL,
    requiere_lote BOOLEAN DEFAULT TRUE NOT NULL,
    categoria_id UUID NOT NULL REFERENCES categoria(id) ON DELETE RESTRICT,
    condicion_venta_id UUID NOT NULL REFERENCES condicion_venta(id) ON DELETE RESTRICT,
    creado_en TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE producto_proveedor (
    producto_id UUID NOT NULL REFERENCES producto(id) ON DELETE CASCADE,
    proveedor_id UUID NOT NULL REFERENCES proveedor(id) ON DELETE CASCADE,
    costo_referencial NUMERIC(12,2) NOT NULL CHECK (costo_referencial >= 0),
    es_principal BOOLEAN DEFAULT FALSE NOT NULL,
    PRIMARY KEY (producto_id, proveedor_id)
);

CREATE TABLE stock_minimo_sucursal (
    producto_id UUID NOT NULL REFERENCES producto(id) ON DELETE CASCADE,
    sucursal_id UUID NOT NULL REFERENCES sucursal(id) ON DELETE CASCADE,
    stock_minimo INTEGER DEFAULT 0 NOT NULL CHECK (stock_minimo >= 0),
    PRIMARY KEY (producto_id, sucursal_id)
);

CREATE TABLE orden_compra (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    fecha TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    fecha_esperada DATE,
    estado_orden_compra_id UUID NOT NULL REFERENCES estado_orden_compra(id) ON DELETE RESTRICT,
    subtotal_neto NUMERIC(12,2) DEFAULT 0 NOT NULL CHECK (subtotal_neto >= 0),
    iva NUMERIC(12,2) DEFAULT 0 NOT NULL,
    total NUMERIC(12,2) DEFAULT 0 NOT NULL,
    proveedor_id UUID NOT NULL REFERENCES proveedor(id) ON DELETE RESTRICT,
    usuario_id UUID NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
    sucursal_id UUID NOT NULL REFERENCES sucursal(id) ON DELETE RESTRICT,
    CHECK (subtotal_neto = ROUND(total / 1.19, 0)),
    CHECK (total >= subtotal_neto),
    CHECK (iva = total - subtotal_neto)
);

CREATE TABLE orden_compra_detalle (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    cantidad_solicitada INTEGER NOT NULL CHECK (cantidad_solicitada > 0),
    cantidad_recibida INTEGER DEFAULT 0 NOT NULL CHECK (cantidad_recibida >= 0),
    costo_unitario NUMERIC(12,2) NOT NULL CHECK (costo_unitario >= 0),
    orden_compra_id UUID NOT NULL REFERENCES orden_compra(id) ON DELETE CASCADE,
    producto_id UUID NOT NULL REFERENCES producto(id) ON DELETE RESTRICT
);

CREATE TABLE lote (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    numero_lote VARCHAR(50),
    fecha_vencimiento DATE,
    fecha_ingreso DATE DEFAULT CURRENT_DATE NOT NULL,
    cantidad_recibida INTEGER NOT NULL CHECK (cantidad_recibida >= 0),
    cantidad_actual INTEGER DEFAULT 0 NOT NULL CHECK (cantidad_actual >= 0),
    producto_id UUID NOT NULL REFERENCES producto(id) ON DELETE RESTRICT,
    sucursal_id UUID NOT NULL REFERENCES sucursal(id) ON DELETE RESTRICT,
    orden_compra_detalle_id UUID REFERENCES orden_compra_detalle(id) ON DELETE RESTRICT,
    UNIQUE NULLS NOT DISTINCT (producto_id, sucursal_id, numero_lote),
    CHECK (fecha_vencimiento IS NULL OR fecha_vencimiento >= fecha_ingreso)
);

CREATE TABLE turno_caja (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    usuario_id UUID NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
    caja_id UUID NOT NULL REFERENCES caja(id) ON DELETE RESTRICT,
    fecha_apertura TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    fecha_cierre TIMESTAMPTZ,
    monto_apertura_efectivo NUMERIC(12,2) DEFAULT 0 NOT NULL CHECK (monto_apertura_efectivo >= 0),
    monto_cierre_esperado_efectivo NUMERIC(12,2) DEFAULT 0 NOT NULL,
    monto_cierre_real_efectivo NUMERIC(12,2),
    CHECK (fecha_cierre IS NULL OR fecha_cierre >= fecha_apertura)
);

CREATE TABLE pedido (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    fecha TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    canal_venta_id UUID NOT NULL REFERENCES canal_venta(id) ON DELETE RESTRICT,
    estado_pedido_id UUID NOT NULL REFERENCES estado_pedido(id) ON DELETE RESTRICT,
    subtotal_bruto NUMERIC(12,2) DEFAULT 0 NOT NULL CHECK (subtotal_bruto >= 0),
    total NUMERIC(12,2) DEFAULT 0 NOT NULL CHECK (total >= 0),
    subtotal_neto NUMERIC(12,2) DEFAULT 0 NOT NULL CHECK (subtotal_neto >= 0),
    iva NUMERIC(12,2) DEFAULT 0 NOT NULL CHECK (iva >= 0),
    nombre_cliente VARCHAR(150) NOT NULL,
    direccion_pedido VARCHAR(200),
    telefono VARCHAR(30),
    comuna_id UUID REFERENCES comuna(id) ON DELETE RESTRICT,
    cliente_id UUID REFERENCES usuario(id) ON DELETE RESTRICT,
    vendedor_id UUID REFERENCES usuario(id) ON DELETE RESTRICT,
    sucursal_id UUID REFERENCES sucursal(id) ON DELETE RESTRICT,
    turno_caja_id UUID REFERENCES turno_caja(id) ON DELETE RESTRICT,
    CHECK (subtotal_neto = ROUND(total / 1.19, 0)),
    CHECK (total <= subtotal_bruto),
    CHECK (iva = total - subtotal_neto)
);

CREATE TABLE detalle_pedido (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    nombre_producto VARCHAR(200) DEFAULT '' NOT NULL,          -- lo fija el trigger (snapshot)
    cantidad INTEGER NOT NULL CHECK (cantidad > 0),
    precio_unitario NUMERIC(12,2) DEFAULT 0 NOT NULL CHECK (precio_unitario >= 0),   -- lo fija el trigger (snapshot)
    descuento_monto NUMERIC(12,2) DEFAULT 0 NOT NULL CHECK (descuento_monto >= 0),   -- lo calcula el trigger
    pedido_id UUID NOT NULL REFERENCES pedido(id) ON DELETE CASCADE,
    producto_id UUID NOT NULL REFERENCES producto(id) ON DELETE RESTRICT,
    regla_descuento_id UUID REFERENCES regla_descuento(id) ON DELETE RESTRICT,
    CHECK (descuento_monto <= (cantidad * precio_unitario))
);

CREATE TABLE transaccion_pago (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    pedido_id UUID NOT NULL REFERENCES pedido(id) ON DELETE RESTRICT,
    pasarela_id UUID REFERENCES pasarela(id) ON DELETE RESTRICT,
    medio_pago_id UUID NOT NULL REFERENCES medio_pago(id) ON DELETE RESTRICT,
    buy_order VARCHAR(26) UNIQUE,                      -- orden de compra enviada a Webpay (máx. 26 caracteres)
    token_inicio VARCHAR(100),
    codigo_autorizacion VARCHAR(50),
    estado_transaccion_id UUID NOT NULL REFERENCES estado_transaccion(id) ON DELETE RESTRICT,
    monto NUMERIC(12,2) NOT NULL CHECK (monto > 0),
    fecha_transaccion TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CHECK (pasarela_id IS NULL OR buy_order IS NOT NULL)
);

CREATE TABLE movimiento_inventario (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    producto_id UUID NOT NULL REFERENCES producto(id) ON DELETE RESTRICT,
    sucursal_id UUID NOT NULL REFERENCES sucursal(id) ON DELETE RESTRICT,
    cantidad INTEGER NOT NULL CHECK (cantidad > 0),      -- siempre positiva: el signo lo da tipo_movimiento.signo
    fecha TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    motivo_movimiento_id UUID NOT NULL REFERENCES motivo_movimiento(id) ON DELETE RESTRICT,
    lote_id UUID NOT NULL REFERENCES lote(id) ON DELETE RESTRICT,
    usuario_id UUID NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
    pedido_id UUID REFERENCES pedido(id) ON DELETE RESTRICT,
    orden_compra_id UUID REFERENCES orden_compra(id) ON DELETE RESTRICT
);

-- =====================================================================
-- 5. ÍNDICES
-- =====================================================================
CREATE INDEX idx_detped_ped        ON detalle_pedido(pedido_id);
CREATE INDEX idx_detped_prod       ON detalle_pedido(producto_id);
CREATE INDEX idx_movinv_lote       ON movimiento_inventario(lote_id);
CREATE INDEX idx_movinv_ped        ON movimiento_inventario(pedido_id);
CREATE INDEX idx_movinv_oc         ON movimiento_inventario(orden_compra_id);
CREATE INDEX idx_movinv_prod_suc   ON movimiento_inventario(producto_id, sucursal_id);
CREATE INDEX idx_ped_cliente       ON pedido(cliente_id);
CREATE INDEX idx_ped_vendedor      ON pedido(vendedor_id);
CREATE INDEX idx_ped_sucursal_fecha ON pedido(sucursal_id, fecha);
CREATE INDEX idx_ped_turno_fecha   ON pedido(turno_caja_id, fecha);
CREATE INDEX idx_ped_estado_fecha  ON pedido(estado_pedido_id, fecha);
CREATE INDEX idx_tpago_ped         ON transaccion_pago(pedido_id);
CREATE INDEX idx_lote_suc          ON lote(sucursal_id);
CREATE INDEX idx_lote_ocd          ON lote(orden_compra_detalle_id);
CREATE INDEX idx_lote_venc_activo  ON lote(producto_id, sucursal_id, fecha_vencimiento) WHERE cantidad_actual > 0;
CREATE INDEX idx_turno_caja_fecha  ON turno_caja(caja_id, fecha_apertura);
CREATE INDEX idx_turno_usuario     ON turno_caja(usuario_id);
CREATE INDEX idx_oc_prov           ON orden_compra(proveedor_id);
CREATE INDEX idx_ocd_oc            ON orden_compra_detalle(orden_compra_id);
CREATE INDEX idx_ocd_prod          ON orden_compra_detalle(producto_id);
CREATE INDEX idx_prod_cat          ON producto(categoria_id);
CREATE INDEX idx_pprov_prov        ON producto_proveedor(proveedor_id);
CREATE UNIQUE INDEX uq_turno_abierto_por_caja ON turno_caja(caja_id)   WHERE fecha_cierre IS NULL;
CREATE UNIQUE INDEX uq_turno_abierto_por_usu  ON turno_caja(usuario_id) WHERE fecha_cierre IS NULL;
CREATE UNIQUE INDEX uq_prod_prov_principal    ON producto_proveedor(producto_id) WHERE es_principal;   -- un solo proveedor principal por producto

-- =====================================================================
-- 6. FUNCIONES Y TRIGGERS DE INTEGRIDAD (todas SECURITY DEFINER)
-- =====================================================================

-- 6.1 Regla "quien abre, cierra": la identidad la informa el backend en cada transacción
CREATE OR REPLACE FUNCTION trg_cierre_solo_quien_abrio() RETURNS TRIGGER SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF OLD.fecha_cierre IS NULL AND NEW.fecha_cierre IS NOT NULL
       AND NULLIF(current_setting('app.usuario_id', true), '')::uuid IS DISTINCT FROM OLD.usuario_id THEN
        RAISE EXCEPTION 'Solo quien abrió el turno puede cerrarlo.';
    END IF;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER cierre_turno BEFORE UPDATE ON turno_caja FOR EACH ROW EXECUTE FUNCTION trg_cierre_solo_quien_abrio();

-- 6.2 Pedido: el canal define si exige turno; el turno debe estar abierto y ser de la misma sucursal
CREATE OR REPLACE FUNCTION trg_validar_pedido_turno() RETURNS TRIGGER SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req_turno BOOLEAN; v_caja_sucursal UUID; v_fecha_cierre TIMESTAMPTZ;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.canal_venta_id IS NOT DISTINCT FROM OLD.canal_venta_id
       AND NEW.turno_caja_id IS NOT DISTINCT FROM OLD.turno_caja_id
       AND NEW.sucursal_id IS NOT DISTINCT FROM OLD.sucursal_id THEN RETURN NEW; END IF;
    SELECT requiere_turno INTO v_req_turno FROM canal_venta WHERE id = NEW.canal_venta_id;
    IF NOT v_req_turno THEN
        IF NEW.turno_caja_id IS NOT NULL THEN RAISE EXCEPTION 'Canal sin turno no admite turno_caja_id.'; END IF;
    ELSE
        IF NEW.turno_caja_id IS NULL THEN RAISE EXCEPTION 'Canal exige turno.'; END IF;
        IF NEW.sucursal_id IS NULL THEN RAISE EXCEPTION 'Pedido exige sucursal_id.'; END IF;
        SELECT c.sucursal_id, t.fecha_cierre INTO v_caja_sucursal, v_fecha_cierre
          FROM turno_caja t JOIN caja c ON t.caja_id = c.id WHERE t.id = NEW.turno_caja_id;
        IF NEW.sucursal_id IS DISTINCT FROM v_caja_sucursal THEN RAISE EXCEPTION 'Sucursal del pedido difiere de la caja.'; END IF;
        IF v_fecha_cierre IS NOT NULL THEN RAISE EXCEPTION 'El turno asignado está cerrado.'; END IF;
    END IF;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER val_pedido_turno BEFORE INSERT OR UPDATE ON pedido FOR EACH ROW EXECUTE FUNCTION trg_validar_pedido_turno();

-- 6.3 Línea de pedido: precio y nombre congelados al crearla, promoción validada y calculada
--     por la base, producto activo y condición de venta compatible con el canal
CREATE OR REPLACE FUNCTION trg_calcular_linea_pedido() RETURNS TRIGGER SECURITY DEFINER SET search_path = public AS $$
DECLARE v_precio NUMERIC; v_nombre VARCHAR; v_cat UUID; v_activo BOOLEAN; v_cond UUID; v_regla RECORD; v_canal_remoto BOOLEAN;
BEGIN
    SELECT precio, nombre, categoria_id, activo, condicion_venta_id INTO v_precio, v_nombre, v_cat, v_activo, v_cond
      FROM producto WHERE id = NEW.producto_id;
    IF TG_OP = 'INSERT' OR NEW.producto_id IS DISTINCT FROM OLD.producto_id THEN
        IF NOT v_activo THEN RAISE EXCEPTION 'El producto está dado de baja.'; END IF;
        SELECT NOT cv.requiere_turno INTO v_canal_remoto FROM pedido p JOIN canal_venta cv ON cv.id = p.canal_venta_id WHERE p.id = NEW.pedido_id;
        IF v_canal_remoto AND NOT (SELECT permite_venta_online FROM condicion_venta WHERE id = v_cond) THEN
            RAISE EXCEPTION 'La condición de venta del producto no permite venderlo por un canal remoto.'; END IF;
        NEW.precio_unitario := v_precio; NEW.nombre_producto := v_nombre;
    ELSE
        NEW.precio_unitario := OLD.precio_unitario; NEW.nombre_producto := OLD.nombre_producto;
    END IF;
    IF NEW.regla_descuento_id IS NOT NULL THEN
        SELECT * INTO v_regla FROM regla_descuento WHERE id = NEW.regla_descuento_id;
        IF NOT v_regla.activa THEN RAISE EXCEPTION 'Regla inactiva'; END IF;
        IF v_regla.categoria_id IS NOT NULL AND v_regla.categoria_id <> v_cat THEN RAISE EXCEPTION 'La regla pertenece a otra categoría.'; END IF;
        IF v_regla.fecha_inicio IS NOT NULL AND CURRENT_TIMESTAMP < v_regla.fecha_inicio THEN RAISE EXCEPTION 'Fuera de fecha'; END IF;
        IF v_regla.fecha_fin IS NOT NULL AND CURRENT_TIMESTAMP > v_regla.fecha_fin THEN RAISE EXCEPTION 'Fuera de fecha'; END IF;
        IF NEW.cantidad < v_regla.cantidad_minima OR (v_regla.cantidad_maxima IS NOT NULL AND NEW.cantidad > v_regla.cantidad_maxima) THEN
            RAISE EXCEPTION 'Rango de cantidad inválido'; END IF;
        NEW.descuento_monto := ROUND(NEW.cantidad * NEW.precio_unitario * v_regla.porcentaje_descuento / 100, 0);
    ELSE NEW.descuento_monto := 0; END IF;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER calcular_linea BEFORE INSERT OR UPDATE ON detalle_pedido FOR EACH ROW EXECUTE FUNCTION trg_calcular_linea_pedido();

-- 6.4 Congelar líneas: solo se editan mientras el pedido está "Pago pendiente" y sin stock reservado
CREATE OR REPLACE FUNCTION fn_pedido_editable(p_pedido_id UUID) RETURNS BOOLEAN SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pendiente BOOLEAN; v_reservado NUMERIC;
BEGIN
    SELECT (ep.nombre = 'Pago pendiente') INTO v_pendiente
      FROM pedido p JOIN estado_pedido ep ON ep.id = p.estado_pedido_id WHERE p.id = p_pedido_id;
    IF NOT COALESCE(v_pendiente, FALSE) THEN RAISE EXCEPTION 'Las líneas solo se modifican mientras el pedido está en "Pago pendiente".'; END IF;
    SELECT COALESCE(SUM(m.cantidad * t.signo), 0) INTO v_reservado
      FROM movimiento_inventario m JOIN motivo_movimiento mm ON mm.id = m.motivo_movimiento_id
      JOIN tipo_movimiento t ON t.id = mm.tipo_movimiento_id WHERE m.pedido_id = p_pedido_id;
    IF v_reservado <> 0 THEN RAISE EXCEPTION 'El pedido tiene stock reservado: libere la reserva antes de modificar sus líneas.'; END IF;
    RETURN TRUE;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_congelar_lineas() RETURNS TRIGGER SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN PERFORM fn_pedido_editable(OLD.pedido_id); END IF;
    IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW.pedido_id IS DISTINCT FROM OLD.pedido_id) THEN PERFORM fn_pedido_editable(NEW.pedido_id); END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER congelar_lineas BEFORE INSERT OR UPDATE OR DELETE ON detalle_pedido FOR EACH ROW EXECUTE FUNCTION trg_congelar_lineas();

-- 6.5 Totales del pedido (la base es la única que los escribe)
CREATE OR REPLACE FUNCTION recalcular_un_pedido(p_id UUID) RETURNS VOID SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bruto NUMERIC; v_total NUMERIC; v_neto NUMERIC;
BEGIN
    PERFORM id FROM pedido WHERE id = p_id FOR UPDATE;
    SELECT COALESCE(SUM(cantidad * precio_unitario), 0), COALESCE(SUM((cantidad * precio_unitario) - descuento_monto), 0)
      INTO v_bruto, v_total FROM detalle_pedido WHERE pedido_id = p_id;
    v_neto := ROUND(v_total / 1.19, 0);
    UPDATE pedido SET subtotal_bruto = v_bruto, total = v_total, subtotal_neto = v_neto, iva = v_total - v_neto WHERE id = p_id;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_recalcular_totales_pedido() RETURNS TRIGGER SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN PERFORM recalcular_un_pedido(NEW.pedido_id); END IF;
    IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.pedido_id IS DISTINCT FROM NEW.pedido_id) THEN PERFORM recalcular_un_pedido(OLD.pedido_id); END IF;
    RETURN NULL;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER recalcular_pedido AFTER INSERT OR UPDATE OR DELETE ON detalle_pedido FOR EACH ROW EXECUTE FUNCTION trg_recalcular_totales_pedido();

-- 6.6 Totales de la orden de compra: neto = suma de líneas pedidas (redondeado a peso), IVA 19 %
CREATE OR REPLACE FUNCTION recalcular_una_orden_compra(p_id UUID) RETURNS VOID SECURITY DEFINER SET search_path = public AS $$
DECLARE v_neto NUMERIC; v_iva NUMERIC;
BEGIN
    PERFORM id FROM orden_compra WHERE id = p_id FOR UPDATE;
    SELECT ROUND(COALESCE(SUM(cantidad_solicitada * costo_unitario), 0), 0) INTO v_neto FROM orden_compra_detalle WHERE orden_compra_id = p_id;
    v_iva := ROUND(v_neto * 0.19, 0);
    UPDATE orden_compra SET subtotal_neto = v_neto, iva = v_iva, total = v_neto + v_iva WHERE id = p_id;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_recalcular_totales_oc() RETURNS TRIGGER SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN PERFORM recalcular_una_orden_compra(NEW.orden_compra_id); END IF;
    IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.orden_compra_id IS DISTINCT FROM NEW.orden_compra_id) THEN PERFORM recalcular_una_orden_compra(OLD.orden_compra_id); END IF;
    RETURN NULL;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER recalcular_oc AFTER INSERT OR UPDATE OR DELETE ON orden_compra_detalle FOR EACH ROW EXECUTE FUNCTION trg_recalcular_totales_oc();

-- 6.7 Kardex inmutable (incluye TRUNCATE)
CREATE OR REPLACE FUNCTION trg_kardex_inmutable() RETURNS TRIGGER SECURITY DEFINER SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'Kardex inmutable. Ingrese un movimiento inverso.'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER prevent_kardex_upd BEFORE UPDATE OR DELETE ON movimiento_inventario FOR EACH ROW EXECUTE FUNCTION trg_kardex_inmutable();
CREATE TRIGGER prevent_kardex_truncate BEFORE TRUNCATE ON movimiento_inventario FOR EACH STATEMENT EXECUTE FUNCTION trg_kardex_inmutable();

-- 6.8 Sanidad: lote y vencimiento según las banderas del producto
CREATE OR REPLACE FUNCTION trg_validar_sanidad() RETURNS TRIGGER SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req_venc BOOLEAN; v_req_lote BOOLEAN;
BEGIN
    SELECT requiere_vencimiento, requiere_lote INTO v_req_venc, v_req_lote FROM producto WHERE id = NEW.producto_id;
    IF v_req_venc AND NEW.fecha_vencimiento IS NULL THEN RAISE EXCEPTION 'Exige fecha de vencimiento.'; END IF;
    IF v_req_lote AND NEW.numero_lote IS NULL THEN RAISE EXCEPTION 'Exige número de lote.'; END IF;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER val_sanidad BEFORE INSERT OR UPDATE ON lote FOR EACH ROW EXECUTE FUNCTION trg_validar_sanidad();

-- 6.9 PMP (se ejecuta ANTES del trigger de stock: los triggers del mismo momento corren por orden alfabético)
CREATE OR REPLACE FUNCTION trg_01_pmp() RETURNS TRIGGER SECURITY DEFINER SET search_path = public AS $$
DECLARE v_stock_previo INTEGER; v_costo_previo NUMERIC; v_costo_entrada NUMERIC; v_nuevo NUMERIC;
        v_hoy DATE := (NOW() AT TIME ZONE 'America/Santiago')::date;
BEGIN
    IF NEW.motivo_movimiento_id IS DISTINCT FROM (SELECT id FROM motivo_movimiento WHERE nombre = 'Recepción OC') THEN RETURN NEW; END IF;
    SELECT ocd.costo_unitario INTO v_costo_entrada
      FROM lote l JOIN orden_compra_detalle ocd ON ocd.id = l.orden_compra_detalle_id WHERE l.id = NEW.lote_id;
    IF v_costo_entrada IS NULL THEN RAISE EXCEPTION 'La recepción no está asociada a una línea de orden de compra con costo.'; END IF;
    SELECT costo INTO v_costo_previo FROM producto WHERE id = NEW.producto_id FOR UPDATE;
    SELECT COALESCE(SUM(cantidad_actual), 0) INTO v_stock_previo FROM lote
     WHERE producto_id = NEW.producto_id AND (fecha_vencimiento IS NULL OR fecha_vencimiento >= v_hoy);
    IF v_stock_previo = 0 THEN v_nuevo := v_costo_entrada;
    ELSE v_nuevo := (v_stock_previo * v_costo_previo + NEW.cantidad * v_costo_entrada) / (v_stock_previo + NEW.cantidad); END IF;
    UPDATE producto SET costo = ROUND(v_nuevo, 2) WHERE id = NEW.producto_id;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_01_pmp_trigger BEFORE INSERT ON movimiento_inventario FOR EACH ROW EXECUTE FUNCTION trg_01_pmp();

-- 6.10 Stock por deltas. Todas las rutas bloquean primero el producto y luego el lote (sin interbloqueos).
CREATE OR REPLACE FUNCTION trg_02_actualizar_stock() RETURNS TRIGGER SECURITY DEFINER SET search_path = public AS $$
DECLARE v_signo SMALLINT; v_lote_prod UUID; v_lote_suc UUID; v_habilita_web BOOLEAN;
BEGIN
    PERFORM 1 FROM producto WHERE id = NEW.producto_id FOR UPDATE;
    SELECT tm.signo INTO v_signo FROM tipo_movimiento tm JOIN motivo_movimiento mm ON mm.tipo_movimiento_id = tm.id WHERE mm.id = NEW.motivo_movimiento_id;
    SELECT producto_id, sucursal_id INTO v_lote_prod, v_lote_suc FROM lote WHERE id = NEW.lote_id;
    IF v_lote_prod IS DISTINCT FROM NEW.producto_id OR v_lote_suc IS DISTINCT FROM NEW.sucursal_id THEN RAISE EXCEPTION 'Producto o sucursal no coinciden con el lote.'; END IF;
    UPDATE lote SET cantidad_actual = cantidad_actual + (NEW.cantidad * v_signo) WHERE id = NEW.lote_id;
    SELECT habilita_venta_web INTO v_habilita_web FROM sucursal WHERE id = NEW.sucursal_id;
    IF v_habilita_web THEN UPDATE producto SET stock_total_web = stock_total_web + (NEW.cantidad * v_signo) WHERE id = NEW.producto_id; END IF;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_02_stock_trigger BEFORE INSERT ON movimiento_inventario FOR EACH ROW EXECUTE FUNCTION trg_02_actualizar_stock();

-- =====================================================================
-- 7. FUNCIONES DE NEGOCIO
-- =====================================================================

-- 7.1 Reserva FEFO: lee las líneas del propio pedido, es idempotente y bloquea en orden fijo
CREATE OR REPLACE FUNCTION fn_reservar_pedido(p_pedido_id UUID) RETURNS VOID SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_ped RECORD; v_usuario UUID; v_motivo UUID; v_linea RECORD; v_lote RECORD;
    v_restante INTEGER; v_toma INTEGER; v_hoy DATE := (NOW() AT TIME ZONE 'America/Santiago')::date;
BEGIN
    v_usuario := NULLIF(current_setting('app.usuario_id', true), '')::uuid;
    IF v_usuario IS NULL THEN RAISE EXCEPTION 'Falta app.usuario_id: el movimiento debe quedar a nombre de alguien.'; END IF;
    SELECT id INTO v_motivo FROM motivo_movimiento WHERE nombre = 'Venta';
    IF v_motivo IS NULL THEN RAISE EXCEPTION 'Falta el motivo de movimiento "Venta".'; END IF;

    SELECT p.id, p.sucursal_id, cv.requiere_turno INTO v_ped
      FROM pedido p JOIN canal_venta cv ON cv.id = p.canal_venta_id WHERE p.id = p_pedido_id FOR UPDATE OF p;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pedido inexistente.'; END IF;
    IF v_ped.sucursal_id IS NULL THEN RAISE EXCEPTION 'El pedido no tiene sucursal de despacho.'; END IF;
    IF NOT v_ped.requiere_turno AND NOT (SELECT habilita_venta_web FROM sucursal WHERE id = v_ped.sucursal_id) THEN
        RAISE EXCEPTION 'La sucursal del pedido online no habilita venta web.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM detalle_pedido WHERE pedido_id = p_pedido_id) THEN RAISE EXCEPTION 'El pedido no tiene líneas.'; END IF;

    IF COALESCE((SELECT SUM(m.cantidad * t.signo) FROM movimiento_inventario m
                   JOIN motivo_movimiento mm ON mm.id = m.motivo_movimiento_id
                   JOIN tipo_movimiento t ON t.id = mm.tipo_movimiento_id
                  WHERE m.pedido_id = p_pedido_id), 0) <> 0 THEN
        RAISE EXCEPTION 'El pedido ya tiene stock reservado.'; END IF;

    FOR v_linea IN SELECT producto_id, SUM(cantidad)::INTEGER AS cantidad FROM detalle_pedido
                    WHERE pedido_id = p_pedido_id GROUP BY producto_id ORDER BY producto_id LOOP
        PERFORM 1 FROM producto WHERE id = v_linea.producto_id FOR UPDATE;   -- orden: producto -> lotes
        v_restante := v_linea.cantidad;
        FOR v_lote IN SELECT id, cantidad_actual FROM lote
                       WHERE producto_id = v_linea.producto_id AND sucursal_id = v_ped.sucursal_id
                         AND cantidad_actual > 0 AND (fecha_vencimiento IS NULL OR fecha_vencimiento >= v_hoy)
                       ORDER BY fecha_vencimiento ASC NULLS LAST, id ASC FOR UPDATE LOOP
            EXIT WHEN v_restante = 0;
            v_toma := LEAST(v_lote.cantidad_actual, v_restante);
            INSERT INTO movimiento_inventario (producto_id, sucursal_id, cantidad, motivo_movimiento_id, lote_id, usuario_id, pedido_id)
            VALUES (v_linea.producto_id, v_ped.sucursal_id, v_toma, v_motivo, v_lote.id, v_usuario, p_pedido_id);
            v_restante := v_restante - v_toma;
        END LOOP;
        IF v_restante > 0 THEN RAISE EXCEPTION 'Stock insuficiente para el producto %', v_linea.producto_id; END IF;
    END LOOP;
END; $$ LANGUAGE plpgsql;

-- 7.2 Liberación de la reserva (pago rechazado, vencido o pedido cancelado). Idempotente.
CREATE OR REPLACE FUNCTION fn_liberar_reserva(p_pedido_id UUID) RETURNS VOID SECURITY DEFINER SET search_path = public AS $$
DECLARE v_usuario UUID; v_motivo UUID; v_mov RECORD;
BEGIN
    v_usuario := NULLIF(current_setting('app.usuario_id', true), '')::uuid;
    IF v_usuario IS NULL THEN RAISE EXCEPTION 'Falta app.usuario_id.'; END IF;
    SELECT id INTO v_motivo FROM motivo_movimiento WHERE nombre = 'Liberación de reserva';
    IF v_motivo IS NULL THEN RAISE EXCEPTION 'Falta el motivo "Liberación de reserva".'; END IF;
    PERFORM 1 FROM pedido WHERE id = p_pedido_id FOR UPDATE;
    FOR v_mov IN SELECT m.producto_id, m.sucursal_id, m.lote_id, SUM(m.cantidad * t.signo)::INTEGER AS neto
                   FROM movimiento_inventario m
                   JOIN motivo_movimiento mm ON mm.id = m.motivo_movimiento_id
                   JOIN tipo_movimiento t ON t.id = mm.tipo_movimiento_id
                  WHERE m.pedido_id = p_pedido_id
                  GROUP BY m.producto_id, m.sucursal_id, m.lote_id HAVING SUM(m.cantidad * t.signo) < 0
                  ORDER BY m.producto_id, m.lote_id LOOP
        INSERT INTO movimiento_inventario (producto_id, sucursal_id, cantidad, motivo_movimiento_id, lote_id, usuario_id, pedido_id)
        VALUES (v_mov.producto_id, v_mov.sucursal_id, -v_mov.neto, v_motivo, v_mov.lote_id, v_usuario, p_pedido_id);
    END LOOP;
END; $$ LANGUAGE plpgsql;

-- 7.3 Job: expira pedidos "Pago pendiente" antiguos y libera su reserva. Salta los pedidos que
--     otra transacción está procesando (por ejemplo, una aprobación de pago en curso).
CREATE OR REPLACE FUNCTION fn_liberar_reservas_vencidas(p_minutos INTEGER, p_usuario_id UUID) RETURNS INTEGER SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ped UUID; v_n INTEGER := 0; v_pend UUID; v_exp UUID;
BEGIN
    PERFORM set_config('app.usuario_id', p_usuario_id::text, true);
    SELECT id INTO v_pend FROM estado_pedido WHERE nombre = 'Pago pendiente';
    SELECT id INTO v_exp  FROM estado_pedido WHERE nombre = 'Expirado';
    IF v_pend IS NULL OR v_exp IS NULL THEN RAISE EXCEPTION 'Faltan los estados "Pago pendiente" / "Expirado".'; END IF;
    FOR v_ped IN SELECT id FROM pedido WHERE estado_pedido_id = v_pend AND fecha < NOW() - make_interval(mins => p_minutos)
                  ORDER BY id FOR UPDATE SKIP LOCKED LOOP
        PERFORM fn_liberar_reserva(v_ped);
        UPDATE pedido SET estado_pedido_id = v_exp WHERE id = v_ped;
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END; $$ LANGUAGE plpgsql;

-- 7.4 Job nocturno: baja de lotes vencidos (movimiento "Producto vencido"). Bloquea producto antes que lote.
CREATE OR REPLACE FUNCTION fn_baja_lotes_vencidos(p_usuario_id UUID) RETURNS INTEGER SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prod UUID; v_lote RECORD; v_motivo UUID; v_n INTEGER := 0;
        v_hoy DATE := (NOW() AT TIME ZONE 'America/Santiago')::date;
BEGIN
    SELECT id INTO v_motivo FROM motivo_movimiento WHERE nombre = 'Producto vencido';
    IF v_motivo IS NULL THEN RAISE EXCEPTION 'Falta el motivo "Producto vencido".'; END IF;
    FOR v_prod IN SELECT DISTINCT producto_id FROM lote WHERE cantidad_actual > 0 AND fecha_vencimiento < v_hoy ORDER BY 1 LOOP
        PERFORM 1 FROM producto WHERE id = v_prod FOR UPDATE;
        FOR v_lote IN SELECT id, producto_id, sucursal_id, cantidad_actual FROM lote
                       WHERE producto_id = v_prod AND cantidad_actual > 0 AND fecha_vencimiento < v_hoy ORDER BY id FOR UPDATE LOOP
            INSERT INTO movimiento_inventario (producto_id, sucursal_id, cantidad, motivo_movimiento_id, lote_id, usuario_id)
            VALUES (v_lote.producto_id, v_lote.sucursal_id, v_lote.cantidad_actual, v_motivo, v_lote.id, p_usuario_id);
            v_n := v_n + 1;
        END LOOP;
    END LOOP;
    RETURN v_n;
END; $$ LANGUAGE plpgsql;

-- 7.5 Cierre Z. El efectivo esperado suma SOLO pagos en efectivo aprobados de los pedidos del turno.
--     transaccion_pago.monto en efectivo debe ser el monto APLICADO a la venta (no el entregado).
CREATE OR REPLACE FUNCTION fn_cierre_esperado_efectivo(p_turno_id UUID) RETURNS NUMERIC SECURITY DEFINER SET search_path = public AS $$
DECLARE v_esperado NUMERIC;
BEGIN
    SELECT t.monto_apertura_efectivo + COALESCE((
             SELECT SUM(tp.monto) FROM pedido p
               JOIN transaccion_pago tp ON tp.pedido_id = p.id
               JOIN medio_pago mp ON mp.id = tp.medio_pago_id AND mp.nombre = 'Efectivo'
               JOIN estado_transaccion et ON et.id = tp.estado_transaccion_id AND et.nombre = 'Aprobado'
              WHERE p.turno_caja_id = t.id), 0)
      INTO v_esperado FROM turno_caja t WHERE t.id = p_turno_id;
    IF v_esperado IS NULL THEN RAISE EXCEPTION 'Turno inexistente.'; END IF;
    RETURN v_esperado;
END; $$ LANGUAGE plpgsql;

-- Cierra el turno: congela el esperado y el contado. Devuelve la diferencia (contado - esperado).
-- La regla "quien abre, cierra" la aplica el trigger cierre_turno con app.usuario_id.
CREATE OR REPLACE FUNCTION fn_cerrar_turno(p_turno_id UUID, p_monto_real NUMERIC) RETURNS NUMERIC SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cierre TIMESTAMPTZ; v_esperado NUMERIC;
BEGIN
    IF p_monto_real IS NULL OR p_monto_real < 0 THEN RAISE EXCEPTION 'El efectivo contado debe ser un monto mayor o igual a cero.'; END IF;
    SELECT fecha_cierre INTO v_cierre FROM turno_caja WHERE id = p_turno_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Turno inexistente.'; END IF;
    IF v_cierre IS NOT NULL THEN RAISE EXCEPTION 'El turno ya está cerrado.'; END IF;
    v_esperado := fn_cierre_esperado_efectivo(p_turno_id);
    UPDATE turno_caja SET fecha_cierre = NOW(), monto_cierre_esperado_efectivo = v_esperado, monto_cierre_real_efectivo = p_monto_real WHERE id = p_turno_id;
    RETURN p_monto_real - v_esperado;
END; $$ LANGUAGE plpgsql;

-- 7.6 Programación de jobs con pg_cron. Idempotente: se puede volver a ejecutar.
--     Liberación de reservas cada 5 min (pedidos con más de 20 min sin pago); baja de vencidos a las
--     05:00 UTC (01:00 o 02:00 en Chile, siempre después de medianoche local).
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
    RETURN 'Jobs programados: farmaclick-liberar-reservas y farmaclick-baja-vencidos.';
END; $$ LANGUAGE plpgsql;

-- =====================================================================
-- 8. VISTAS
-- =====================================================================
-- Vitrina del e-commerce: solo productos activos con condición de venta permitida online.
-- stock_total_web es la suma de las sucursales hub (habilita_venta_web = TRUE).
CREATE VIEW vw_catalogo_web AS
SELECT p.id, p.sku, p.nombre, p.precio, p.stock_total_web,
       c.nombre AS categoria, cv.nombre AS condicion_venta
  FROM producto p
  JOIN categoria c ON c.id = p.categoria_id
  JOIN condicion_venta cv ON cv.id = p.condicion_venta_id
 WHERE p.activo AND cv.activa AND cv.permite_venta_online;

-- Disponibilidad por sucursal (retiro en tienda): excluye lotes vencidos.
CREATE VIEW vw_stock_disponible AS
SELECT l.producto_id, l.sucursal_id, SUM(l.cantidad_actual)::INTEGER AS disponible
  FROM lote l
 WHERE l.cantidad_actual > 0
   AND (l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= (NOW() AT TIME ZONE 'America/Santiago')::date)
 GROUP BY l.producto_id, l.sucursal_id;

-- =====================================================================
-- 9. DATOS SEMILLA
-- =====================================================================
INSERT INTO rol (nombre) VALUES ('Administrador'), ('Vendedor'), ('Bodega'), ('Cliente'), ('Sistema');

INSERT INTO modulo (nombre, clave) VALUES
    ('Dashboard', 'dashboard'), ('Venta presencial', 'pos'), ('Inventario', 'inventario'),
    ('Proveedores', 'proveedores'), ('Pedidos', 'pedidos'), ('Cuadratura', 'cuadratura'),
    ('Usuarios y permisos', 'usuarios');

INSERT INTO rol_permiso (rol_id, modulo_id, permitido)
SELECT r.id, m.id,
       CASE r.nombre
            WHEN 'Administrador' THEN TRUE
            WHEN 'Vendedor' THEN m.clave IN ('dashboard', 'pos', 'pedidos', 'cuadratura')
            WHEN 'Bodega'   THEN m.clave IN ('dashboard', 'inventario', 'proveedores')
            ELSE FALSE END
  FROM rol r CROSS JOIN modulo m;

INSERT INTO canal_venta (nombre, requiere_turno) VALUES ('Online', FALSE), ('Presencial', TRUE);

-- Clasificación de condiciones de venta: confirmar con el químico farmacéutico.
-- En el MVP el e-commerce solo vende "Venta directa" (la venta con receta se difiere a la Fase 2).
INSERT INTO condicion_venta (nombre, permite_venta_online) VALUES
    ('Venta directa', TRUE), ('Receta médica simple', FALSE),
    ('Receta médica retenida', FALSE), ('Receta cheque', FALSE);

INSERT INTO estado_pedido (nombre) VALUES
    ('Pago pendiente'), ('Pagado'), ('En preparación'), ('Listo para retiro'),
    ('En despacho'), ('Entregado'), ('Cancelado'), ('Expirado');
INSERT INTO estado_orden_compra (nombre) VALUES ('Pendiente'), ('Recibida parcial'), ('Recibida'), ('Cancelada');
INSERT INTO estado_transaccion (nombre) VALUES ('Pendiente'), ('Aprobado'), ('Rechazado'), ('Anulado'), ('Abortado');
INSERT INTO medio_pago (nombre) VALUES ('Efectivo'), ('Débito'), ('Crédito'), ('Transferencia'), ('Webpay Plus');
INSERT INTO pasarela (nombre) VALUES ('Transbank Webpay Plus');

INSERT INTO tipo_movimiento (nombre, signo) VALUES ('Entrada', 1), ('Salida', -1);
INSERT INTO motivo_movimiento (nombre, tipo_movimiento_id)
SELECT v.nombre, t.id FROM tipo_movimiento t
  JOIN (VALUES ('Recepción OC', 'Entrada'), ('Liberación de reserva', 'Entrada'), ('Ajuste positivo', 'Entrada'),
               ('Venta', 'Salida'), ('Producto vencido', 'Salida'), ('Merma', 'Salida'), ('Ajuste negativo', 'Salida')) v(nombre, tipo)
    ON v.tipo = t.nombre;

INSERT INTO region (nombre) VALUES
    ('Arica y Parinacota'), ('Tarapacá'), ('Antofagasta'), ('Atacama'), ('Coquimbo'), ('Valparaíso'),
    ('Metropolitana de Santiago'), ('Libertador General Bernardo O''Higgins'), ('Maule'), ('Ñuble'),
    ('Biobío'), ('La Araucanía'), ('Los Ríos'), ('Los Lagos'),
    ('Aysén del General Carlos Ibáñez del Campo'), ('Magallanes y de la Antártica Chilena');

-- Comunas de la Región Metropolitana (52). Las de las demás regiones deben cargarse desde la fuente oficial (SUBDERE/INE).
INSERT INTO comuna (nombre, region_id)
SELECT c, r.id FROM region r,
       unnest(ARRAY['Alhué','Buin','Calera de Tango','Cerrillos','Cerro Navia','Colina','Conchalí','Curacaví','El Bosque',
                    'El Monte','Estación Central','Huechuraba','Independencia','Isla de Maipo','La Cisterna','La Florida',
                    'La Granja','La Pintana','La Reina','Lampa','Las Condes','Lo Barnechea','Lo Espejo','Lo Prado','Macul',
                    'Maipú','María Pinto','Melipilla','Ñuñoa','Padre Hurtado','Paine','Pedro Aguirre Cerda','Peñaflor',
                    'Peñalolén','Pirque','Providencia','Pudahuel','Puente Alto','Quilicura','Quinta Normal','Recoleta','Renca',
                    'San Bernardo','San Joaquín','San José de Maipo','San Miguel','San Pedro','San Ramón','Santiago',
                    'Talagante','Tiltil','Vitacura']) AS c
 WHERE r.nombre = 'Metropolitana de Santiago';

-- Usuario técnico: autor de los movimientos automáticos (jobs y ventas web). No tiene permisos de módulos.
INSERT INTO usuario (nombre, correo, rol_id)
SELECT 'Sistema FarmaClick', 'sistema@farmaclick.cl', id FROM rol WHERE nombre = 'Sistema';

-- =====================================================================
-- 10. SEGURIDAD (se ejecuta AL FINAL, cuando ya existen todos los objetos)
-- =====================================================================
-- 10.1 Cerrar la API pública de Supabase y hacer que los objetos futuros nazcan cerrados
DO $$
DECLARE r TEXT;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
            EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
            EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
        END IF;
    END LOOP;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

-- 10.2 RLS activado en todas las tablas como red de seguridad: sin políticas para anon/authenticated,
--      aunque alguien les conceda permisos por error no verán filas. El backend tiene su política;
--      los privilegios (10.3) siguen siendo los que limitan lo que puede hacer.
DO $$
DECLARE t TEXT;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY p_backend_all ON public.%I FOR ALL TO app_backend USING (true) WITH CHECK (true)', t);
    END LOOP;
END $$;

-- 10.3 Permisos mínimos del backend. Un REVOKE de columna NO quita un GRANT de tabla, por eso se
--      parte de cero y se concede columna por columna donde hay campos protegidos.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_backend;

GRANT SELECT ON canal_venta, condicion_venta, estado_orden_compra, estado_pedido, estado_transaccion,
                medio_pago, modulo, pasarela, region, comuna, rol, tipo_movimiento, motivo_movimiento TO app_backend;

GRANT SELECT, INSERT, UPDATE ON categoria, proveedor, regla_descuento, sucursal, caja, cliente TO app_backend;
GRANT SELECT, INSERT, UPDATE, DELETE ON rol_permiso, producto_proveedor, stock_minimo_sucursal TO app_backend;

GRANT SELECT ON producto TO app_backend;
GRANT INSERT (sku, nombre, costo, margen_utilidad, activo, requiere_vencimiento, requiere_lote, categoria_id, condicion_venta_id) ON producto TO app_backend;
GRANT UPDATE (sku, nombre, margen_utilidad, activo, requiere_vencimiento, requiere_lote, categoria_id, condicion_venta_id) ON producto TO app_backend;

GRANT SELECT ON usuario TO app_backend;
GRANT INSERT (id, nombre, correo, rol_id, sucursal_id, activo) ON usuario TO app_backend;
GRANT UPDATE (nombre, correo, rol_id, sucursal_id, activo) ON usuario TO app_backend;

GRANT SELECT ON lote TO app_backend;
GRANT INSERT (numero_lote, fecha_vencimiento, fecha_ingreso, cantidad_recibida, producto_id, sucursal_id, orden_compra_detalle_id) ON lote TO app_backend;
GRANT UPDATE (numero_lote, fecha_vencimiento) ON lote TO app_backend;

GRANT SELECT, INSERT ON movimiento_inventario TO app_backend;   -- sin UPDATE/DELETE: kardex inmutable

GRANT SELECT ON pedido TO app_backend;
GRANT INSERT (canal_venta_id, estado_pedido_id, nombre_cliente, direccion_pedido, telefono, comuna_id, cliente_id, vendedor_id, sucursal_id, turno_caja_id) ON pedido TO app_backend;
GRANT UPDATE (estado_pedido_id, nombre_cliente, direccion_pedido, telefono, comuna_id) ON pedido TO app_backend;

GRANT SELECT, DELETE ON detalle_pedido TO app_backend;
GRANT INSERT (pedido_id, producto_id, cantidad, regla_descuento_id) ON detalle_pedido TO app_backend;
GRANT UPDATE (cantidad, regla_descuento_id) ON detalle_pedido TO app_backend;

GRANT SELECT ON transaccion_pago TO app_backend;
GRANT INSERT (pedido_id, pasarela_id, medio_pago_id, buy_order, token_inicio, codigo_autorizacion, estado_transaccion_id, monto) ON transaccion_pago TO app_backend;
GRANT UPDATE (estado_transaccion_id, codigo_autorizacion) ON transaccion_pago TO app_backend;

GRANT SELECT ON turno_caja TO app_backend;                       -- el cierre se hace solo con fn_cerrar_turno
GRANT INSERT (usuario_id, caja_id, monto_apertura_efectivo) ON turno_caja TO app_backend;

GRANT SELECT ON orden_compra TO app_backend;                     -- los totales los calcula el trigger
GRANT INSERT (fecha_esperada, estado_orden_compra_id, proveedor_id, usuario_id, sucursal_id) ON orden_compra TO app_backend;
GRANT UPDATE (fecha_esperada, estado_orden_compra_id) ON orden_compra TO app_backend;
GRANT SELECT, DELETE ON orden_compra_detalle TO app_backend;
GRANT INSERT (cantidad_solicitada, costo_unitario, orden_compra_id, producto_id) ON orden_compra_detalle TO app_backend;
GRANT UPDATE (cantidad_solicitada, cantidad_recibida, costo_unitario) ON orden_compra_detalle TO app_backend;

GRANT SELECT ON vw_catalogo_web, vw_stock_disponible TO app_backend;

-- 10.4 Funciones: el backend ejecuta solo las de negocio. Los jobs los corre el propietario (pg_cron).
GRANT EXECUTE ON FUNCTION fn_reservar_pedido(UUID)                TO app_backend;
GRANT EXECUTE ON FUNCTION fn_liberar_reserva(UUID)                TO app_backend;
GRANT EXECUTE ON FUNCTION fn_cierre_esperado_efectivo(UUID)       TO app_backend;
GRANT EXECUTE ON FUNCTION fn_cerrar_turno(UUID, NUMERIC)          TO app_backend;

-- =====================================================================
-- 11. DOCUMENTACIÓN EN EL PROPIO ESQUEMA
-- =====================================================================
COMMENT ON COLUMN lote.cantidad_actual IS 'Unidades DISPONIBLES PARA VENDER (no necesariamente en la estantería: incluye reservas). Solo la mueve el trigger del kardex.';
COMMENT ON COLUMN producto.stock_total_web IS 'Suma de las sucursales con habilita_venta_web. Mantenido por trigger; el backend no puede escribirlo.';
COMMENT ON COLUMN producto.costo IS 'Costo NETO. Se recalcula por Precio Medio Ponderado (PMP) en cada Recepción OC.';
COMMENT ON COLUMN producto.precio IS 'Precio de venta BRUTO (con IVA), generado: ROUND(costo * (1 + margen_utilidad) * 1.19). margen_utilidad es un recargo (markup) sobre el costo.';
COMMENT ON COLUMN detalle_pedido.precio_unitario IS 'Snapshot del precio al crear la línea; lo fija el trigger, no el cliente.';
COMMENT ON COLUMN detalle_pedido.descuento_monto IS 'Calculado por el trigger a partir de regla_descuento; nunca lo informa el backend.';
COMMENT ON COLUMN pedido.total IS 'Calculado por trigger a partir de las líneas; el backend no puede escribirlo.';
COMMENT ON COLUMN orden_compra.total IS 'Calculado por trigger a partir de las líneas (cantidad_solicitada x costo_unitario, IVA 19 %).';
COMMENT ON COLUMN transaccion_pago.monto IS 'Monto APLICADO a la venta. En efectivo no incluye el vuelto: el Cierre Z suma este campo.';
COMMENT ON COLUMN turno_caja.monto_cierre_esperado_efectivo IS 'Se congela al cerrar el turno con fn_cerrar_turno: apertura + efectivo aprobado de los pedidos del turno.';
COMMENT ON TABLE  movimiento_inventario IS 'Kardex inmutable (sin UPDATE, DELETE ni TRUNCATE). Correcciones = movimiento inverso. cantidad siempre > 0; el signo sale de tipo_movimiento.signo.';
COMMENT ON TABLE  condicion_venta IS 'Clasificación de venta del producto. permite_venta_online controla qué puede venderse por canales sin caja física.';

-- Programar los jobs si pg_cron está disponible; si no, queda el aviso.
DO $$
BEGIN
    RAISE NOTICE '%', fn_programar_jobs();
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'No se pudieron programar los jobs (%). Ejecute más tarde: SELECT fn_programar_jobs();', SQLERRM;
END $$;

COMMIT;
