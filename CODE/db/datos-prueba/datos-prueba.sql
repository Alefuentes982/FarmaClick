-- =====================================================================
-- Datos de prueba de FarmaClick (ficticios; no cargar en producción real).
--
-- Carga categorías, proveedores ficticios, 90 productos con su proveedor, stock mínimo y stock inicial en
-- Casa Matriz (San Bernardo). Los nombres, costos y proveedores son de EJEMPLO, no son un catálogo real.
-- Idempotente: se puede ejecutar varias veces; lo que ya existe (por SKU, RUT o nombre) no se duplica ni se pisa.
-- Requisitos: esquema base y las migraciones al día. En Supabase se ejecuta en el editor SQL, con el usuario por defecto.
-- El stock entra por el kardex (movimiento "Ajuste positivo" a nombre del usuario Sistema), como cualquier ajuste.
-- =====================================================================

DO $$
DECLARE faltan TEXT;
BEGIN
    SELECT string_agg(v, ', ') INTO faltan
      FROM unnest(ARRAY['Venta directa', 'Receta médica simple', 'Receta médica retenida']) v
     WHERE v NOT IN (SELECT nombre FROM condicion_venta);
    IF faltan IS NOT NULL THEN RAISE EXCEPTION 'Faltan condiciones de venta: %', faltan; END IF;
    IF NOT EXISTS (SELECT 1 FROM usuario WHERE correo = 'sistema@farmaclick.cl') THEN
        RAISE EXCEPTION 'Falta el usuario técnico sistema@farmaclick.cl (lo crea el esquema base).';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM motivo_movimiento WHERE nombre = 'Ajuste positivo') THEN
        RAISE EXCEPTION 'Falta el motivo de movimiento "Ajuste positivo".';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM sucursal WHERE nombre = 'Casa Matriz')
       AND NOT EXISTS (SELECT 1 FROM comuna WHERE nombre = 'San Bernardo') THEN
        RAISE EXCEPTION 'No existe la comuna San Bernardo: cargue las comunas del esquema base.';
    END IF;
END $$;

-- 1. Sucursal (solo si no existe): la casa matriz, con venta web habilitada
INSERT INTO sucursal (nombre, comuna_id, habilita_venta_web)
SELECT 'Casa Matriz', c.id, TRUE FROM comuna c JOIN region r ON r.id = c.region_id
 WHERE c.nombre = 'San Bernardo' AND r.nombre = 'Metropolitana de Santiago'
   AND NOT EXISTS (SELECT 1 FROM sucursal WHERE nombre = 'Casa Matriz');

-- 2. Categorías con sus márgenes (fracción del costo: 0.30 = 30%)
INSERT INTO categoria (nombre, margen_pesimista, margen_probable, margen_optimista) VALUES
    ('Medicamentos', 0.20, 0.30, 0.40),
    ('Dermocosmética', 0.30, 0.45, 0.60),
    ('Cuidado personal', 0.25, 0.40, 0.55),
    ('Vitaminas y suplementos', 0.30, 0.45, 0.60),
    ('Primeros auxilios', 0.25, 0.40, 0.55),
    ('Bebé y maternidad', 0.20, 0.30, 0.40)
ON CONFLICT (nombre) DO NOTHING;

-- 3. Proveedores ficticios
INSERT INTO proveedor (nombre, rut, contacto) VALUES
    ('Droguería Andes Farma SpA', '76201345-2', 'Ventas: Marcela Rojas'),
    ('Distribuidora Médica Mapocho Ltda.', '76318920-1', 'Pedidos: Jorge Salinas'),
    ('Laboratorios Pacífico Sur S.A.', '77045610-K', 'Comercial: Andrea Pizarro'),
    ('Cosmética y Cuidado Maipo SpA', '76550134-2', 'Ejecutivo: Camila Fuentes'),
    ('Insumos Clínicos Cordillera Ltda.', '76702458-4', 'Despacho: Luis Contreras'),
    ('Importadora Nutrivida SpA', '77120936-K', 'Ventas: Daniela Muñoz')
ON CONFLICT (rut) DO NOTHING;

-- 4. Productos (el precio de venta lo calcula la base: costo × (1 + margen) × 1,19)
DROP TABLE IF EXISTS _prod_prueba;
CREATE TEMP TABLE _prod_prueba AS
SELECT * FROM (VALUES
    ('MED-001', 'Paracetamol 500 mg x16 comprimidos', 'Medicamentos', 'Venta directa', '450', '', '150', '40', '30', '77045610-K', '76201345-2'),
    ('MED-002', 'Paracetamol 1 g x20 comprimidos', 'Medicamentos', 'Venta directa', '780', '', '110', '30', '30', '77045610-K', '76201345-2'),
    ('MED-003', 'Ibuprofeno 400 mg x20 comprimidos', 'Medicamentos', 'Venta directa', '900', '', '120', '30', '28', '77045610-K', '76201345-2'),
    ('MED-004', 'Ibuprofeno 600 mg x10 comprimidos', 'Medicamentos', 'Venta directa', '850', '', '90', '25', '28', '77045610-K', '76318920-1'),
    ('MED-005', 'Ácido acetilsalicílico 500 mg x20 comprimidos', 'Medicamentos', 'Venta directa', '600', '', '80', '20', '24', '77045610-K', '76201345-2'),
    ('MED-006', 'Loratadina 10 mg x10 comprimidos', 'Medicamentos', 'Venta directa', '520', '', '100', '25', '30', '77045610-K', '76201345-2'),
    ('MED-007', 'Cetirizina 10 mg x10 comprimidos', 'Medicamentos', 'Venta directa', '650', '', '85', '25', '30', '77045610-K', '76318920-1'),
    ('MED-008', 'Omeprazol 20 mg x14 cápsulas', 'Medicamentos', 'Venta directa', '1100', '', '70', '20', '24', '76201345-2', '77045610-K'),
    ('MED-009', 'Hidróxido de aluminio y magnesio suspensión 360 ml', 'Medicamentos', 'Venta directa', '1900', '', '45', '15', '20', '76201345-2', '76318920-1'),
    ('MED-010', 'Sales de rehidratación oral sobre 27,9 g', 'Medicamentos', 'Venta directa', '300', '', '60', '25', '24', '76318920-1', '76201345-2'),
    ('MED-011', 'Loperamida 2 mg x12 comprimidos', 'Medicamentos', 'Venta directa', '700', '', '55', '15', '30', '77045610-K', '76201345-2'),
    ('MED-012', 'Butilescopolamina 10 mg x20 grageas', 'Medicamentos', 'Venta directa', '1500', '', '50', '15', '24', '76201345-2', '76318920-1'),
    ('MED-013', 'Ambroxol jarabe 120 ml', 'Medicamentos', 'Venta directa', '1400', '', '40', '12', '18', '77045610-K', '76201345-2'),
    ('MED-014', 'Jarabe para la tos infantil 120 ml', 'Medicamentos', 'Venta directa', '1500', '', '35', '12', '18', '77045610-K', '76318920-1'),
    ('MED-015', 'Pastillas para la garganta mentol x24', 'Medicamentos', 'Venta directa', '1200', '', '75', '20', '24', '76318920-1', '77045610-K'),
    ('MED-016', 'Descongestionante nasal spray 15 ml', 'Medicamentos', 'Venta directa', '1700', '', '8', '20', '20', '76201345-2', '77045610-K'),
    ('MED-017', 'Antiácido masticable x12 comprimidos', 'Medicamentos', 'Venta directa', '800', '', '0', '15', '24', '77045610-K', '76201345-2'),
    ('MED-020', 'Amoxicilina 500 mg x21 cápsulas', 'Medicamentos', 'Receta médica simple', '2200', '', '60', '20', '24', '76201345-2', '76318920-1'),
    ('MED-021', 'Amoxicilina + ácido clavulánico 875/125 mg x14 comprimidos', 'Medicamentos', 'Receta médica simple', '5200', '', '30', '10', '24', '76201345-2', '76318920-1'),
    ('MED-022', 'Azitromicina 500 mg x3 comprimidos', 'Medicamentos', 'Receta médica simple', '3200', '', '35', '10', '24', '76201345-2', '76318920-1'),
    ('MED-023', 'Ciprofloxacino 500 mg x10 comprimidos', 'Medicamentos', 'Receta médica simple', '1800', '', '40', '12', '24', '76201345-2', '77045610-K'),
    ('MED-024', 'Losartán 50 mg x30 comprimidos', 'Medicamentos', 'Receta médica simple', '1500', '', '90', '30', '30', '77045610-K', '76201345-2'),
    ('MED-025', 'Enalapril 10 mg x30 comprimidos', 'Medicamentos', 'Receta médica simple', '1200', '', '85', '30', '30', '77045610-K', '76201345-2'),
    ('MED-026', 'Metformina 850 mg x60 comprimidos', 'Medicamentos', 'Receta médica simple', '1800', '', '70', '25', '30', '77045610-K', '76201345-2'),
    ('MED-027', 'Atorvastatina 20 mg x30 comprimidos', 'Medicamentos', 'Receta médica simple', '2600', '', '65', '20', '30', '76201345-2', '77045610-K'),
    ('MED-028', 'Levotiroxina 100 mcg x30 comprimidos', 'Medicamentos', 'Receta médica simple', '2100', '', '55', '20', '24', '76201345-2', '76318920-1'),
    ('MED-029', 'Diclofenaco 50 mg x20 comprimidos', 'Medicamentos', 'Receta médica simple', '1100', '', '5', '20', '1', '77045610-K', '76201345-2'),
    ('MED-030', 'Prednisona 20 mg x10 comprimidos', 'Medicamentos', 'Receta médica simple', '900', '', '45', '15', '-1', '77045610-K', '76201345-2'),
    ('MED-040', 'Clonazepam 0,5 mg x30 comprimidos', 'Medicamentos', 'Receta médica retenida', '1900', '', '40', '10', '24', '76201345-2', '76318920-1'),
    ('MED-041', 'Zopiclona 7,5 mg x30 comprimidos', 'Medicamentos', 'Receta médica retenida', '3100', '', '30', '10', '24', '76201345-2', '76318920-1'),
    ('MED-042', 'Alprazolam 0,5 mg x30 comprimidos', 'Medicamentos', 'Receta médica retenida', '2300', '', '35', '10', '24', '76201345-2', '76318920-1'),
    ('DER-001', 'Protector solar FPS 50+ 60 ml', 'Dermocosmética', 'Venta directa', '6500', '', '70', '20', '24', '76550134-2', ''),
    ('DER-002', 'Protector solar facial FPS 50 50 ml', 'Dermocosmética', 'Venta directa', '7800', '', '45', '15', '24', '76550134-2', ''),
    ('DER-003', 'Crema hidratante corporal 400 ml', 'Dermocosmética', 'Venta directa', '3900', '', '60', '15', '30', '76550134-2', '77120936-K'),
    ('DER-004', 'Crema hidratante facial de día 50 ml', 'Dermocosmética', 'Venta directa', '5600', '', '40', '12', '24', '76550134-2', ''),
    ('DER-005', 'Gel limpiador facial 200 ml', 'Dermocosmética', 'Venta directa', '4200', '', '50', '15', '30', '76550134-2', ''),
    ('DER-006', 'Agua micelar 400 ml', 'Dermocosmética', 'Venta directa', '4800', '', '45', '12', '30', '76550134-2', ''),
    ('DER-007', 'Crema antiarrugas de noche 50 ml', 'Dermocosmética', 'Venta directa', '9500', '', '25', '8', '24', '76550134-2', ''),
    ('DER-008', 'Bálsamo labial FPS 15', 'Dermocosmética', 'Venta directa', '1200', '', '100', '30', '30', '76550134-2', '76318920-1'),
    ('DER-009', 'Crema para manos 75 ml', 'Dermocosmética', 'Venta directa', '2100', '', '65', '20', '30', '76550134-2', '76318920-1'),
    ('DER-010', 'Shampoo anticaspa 400 ml', 'Dermocosmética', 'Venta directa', '3600', '', '55', '15', '30', '76550134-2', '76318920-1'),
    ('DER-011', 'Crema para la pañalitis 100 g', 'Dermocosmética', 'Venta directa', '3000', '', '6', '15', '24', '77120936-K', '76550134-2'),
    ('DER-012', 'Gel de aloe vera 200 ml', 'Dermocosmética', 'Venta directa', '2800', '', '0', '10', '24', '76550134-2', ''),
    ('CUI-001', 'Pasta dental 90 g', 'Cuidado personal', 'Venta directa', '1000', '', '140', '40', '30', '76550134-2', '76318920-1'),
    ('CUI-002', 'Cepillo dental medio x1', 'Cuidado personal', 'Venta directa', '600', '', '120', '30', '', '76550134-2', '76318920-1'),
    ('CUI-003', 'Enjuague bucal 500 ml', 'Cuidado personal', 'Venta directa', '2300', '', '50', '15', '30', '76550134-2', '76318920-1'),
    ('CUI-004', 'Hilo dental 50 m', 'Cuidado personal', 'Venta directa', '900', '', '60', '20', '36', '76550134-2', ''),
    ('CUI-005', 'Desodorante en barra 50 g', 'Cuidado personal', 'Venta directa', '1800', '', '90', '25', '30', '76550134-2', '76318920-1'),
    ('CUI-006', 'Shampoo 400 ml', 'Cuidado personal', 'Venta directa', '2200', '', '80', '25', '30', '76550134-2', '76318920-1'),
    ('CUI-007', 'Acondicionador 400 ml', 'Cuidado personal', 'Venta directa', '2300', '', '70', '20', '30', '76550134-2', '76318920-1'),
    ('CUI-008', 'Jabón en barra x3', 'Cuidado personal', 'Venta directa', '1100', '', '100', '30', '36', '76550134-2', '76318920-1'),
    ('CUI-009', 'Toallas higiénicas x16', 'Cuidado personal', 'Venta directa', '1300', '', '95', '30', '36', '76550134-2', '76318920-1'),
    ('CUI-010', 'Protectores diarios x40', 'Cuidado personal', 'Venta directa', '1400', '', '85', '25', '36', '76550134-2', '76318920-1'),
    ('CUI-011', 'Papel higiénico x12 rollos', 'Cuidado personal', 'Venta directa', '3000', '', '60', '20', '', '76318920-1', '76550134-2'),
    ('CUI-012', 'Pañuelos desechables pack x6', 'Cuidado personal', 'Venta directa', '1400', '', '75', '20', '', '76318920-1', '76550134-2'),
    ('CUI-013', 'Alcohol gel 500 ml', 'Cuidado personal', 'Venta directa', '2200', '', '65', '20', '24', '76702458-4', '76318920-1'),
    ('CUI-014', 'Preservativos x3', 'Cuidado personal', 'Venta directa', '1600', '', '80', '25', '36', '76318920-1', ''),
    ('CUI-015', 'Máquina de afeitar desechable x4', 'Cuidado personal', 'Venta directa', '1500', '', '50', '15', '', '76550134-2', '76318920-1'),
    ('CUI-016', 'Repelente de insectos 100 ml', 'Cuidado personal', 'Venta directa', '2900', '', '30', '10', '2', '76550134-2', '76318920-1'),
    ('CUI-017', 'Mascarillas desechables x50', 'Cuidado personal', 'Venta directa', '2600', '', '40', '15', '', '76702458-4', '76318920-1'),
    ('PRI-001', 'Alcohol 70° 1 L', 'Primeros auxilios', 'Venta directa', '1900', '', '60', '20', '36', '76702458-4', '76318920-1'),
    ('PRI-002', 'Agua oxigenada 10 volúmenes 100 ml', 'Primeros auxilios', 'Venta directa', '600', '', '55', '15', '30', '76702458-4', '76318920-1'),
    ('PRI-003', 'Povidona yodada 10% 120 ml', 'Primeros auxilios', 'Venta directa', '2000', '', '40', '12', '30', '76702458-4', '76318920-1'),
    ('PRI-004', 'Parches curitas x20', 'Primeros auxilios', 'Venta directa', '700', '', '110', '30', '36', '76702458-4', '76318920-1'),
    ('PRI-005', 'Gasas estériles 10x10 cm x10', 'Primeros auxilios', 'Venta directa', '900', '', '70', '20', '36', '76702458-4', '76318920-1'),
    ('PRI-006', 'Venda elástica 10 cm', 'Primeros auxilios', 'Venta directa', '1100', '', '50', '15', '', '76702458-4', '76318920-1'),
    ('PRI-007', 'Algodón 100 g', 'Primeros auxilios', 'Venta directa', '900', '', '60', '15', '', '76702458-4', '76318920-1'),
    ('PRI-008', 'Termómetro digital', 'Primeros auxilios', 'Venta directa', '3500', '', '25', '8', '', '76702458-4', '76318920-1'),
    ('PRI-009', 'Suero fisiológico ampollas 5 ml x20', 'Primeros auxilios', 'Venta directa', '1600', '', '45', '15', '24', '76702458-4', '76318920-1'),
    ('PRI-010', 'Cinta micropore 2,5 cm', 'Primeros auxilios', 'Venta directa', '700', '', '65', '20', '36', '76702458-4', '76318920-1'),
    ('PRI-011', 'Guantes de examen x100', 'Primeros auxilios', 'Venta directa', '5200', '', '3', '12', '36', '76702458-4', '76318920-1'),
    ('PRI-012', 'Jeringa desechable 5 ml x1', 'Primeros auxilios', 'Venta directa', '250', '', '150', '50', '36', '76702458-4', '76318920-1'),
    ('VIT-001', 'Vitamina C 1 g x10 comprimidos efervescentes', 'Vitaminas y suplementos', 'Venta directa', '2200', '', '80', '20', '24', '77120936-K', '77045610-K'),
    ('VIT-002', 'Multivitamínico adultos x30 comprimidos', 'Vitaminas y suplementos', 'Venta directa', '4800', '', '50', '15', '24', '77120936-K', '77045610-K'),
    ('VIT-003', 'Omega 3 1000 mg x60 cápsulas', 'Vitaminas y suplementos', 'Venta directa', '7200', '', '35', '10', '24', '77120936-K', ''),
    ('VIT-004', 'Vitamina D3 2000 UI x60 cápsulas', 'Vitaminas y suplementos', 'Venta directa', '5600', '', '40', '12', '24', '77120936-K', ''),
    ('VIT-005', 'Magnesio x60 comprimidos', 'Vitaminas y suplementos', 'Venta directa', '5200', '', '38', '10', '24', '77120936-K', ''),
    ('VIT-006', 'Zinc x30 comprimidos', 'Vitaminas y suplementos', 'Venta directa', '3000', '', '45', '12', '24', '77120936-K', '77045610-K'),
    ('VIT-007', 'Calcio + vitamina D x60 comprimidos', 'Vitaminas y suplementos', 'Venta directa', '4600', '', '42', '12', '24', '77120936-K', '77045610-K'),
    ('VIT-008', 'Complejo B x30 comprimidos', 'Vitaminas y suplementos', 'Venta directa', '3600', '', '48', '12', '24', '77120936-K', '77045610-K'),
    ('VIT-009', 'Colágeno hidrolizado sachets x30', 'Vitaminas y suplementos', 'Venta directa', '11500', '', '20', '6', '18', '77120936-K', ''),
    ('VIT-010', 'Probióticos x10 cápsulas', 'Vitaminas y suplementos', 'Venta directa', '8500', '', '25', '8', '1', '77120936-K', ''),
    ('BEB-001', 'Pañales talla M x40', 'Bebé y maternidad', 'Venta directa', '9000', '', '45', '15', '', '77120936-K', '76318920-1'),
    ('BEB-002', 'Pañales talla G x36', 'Bebé y maternidad', 'Venta directa', '9500', '', '40', '15', '', '77120936-K', '76318920-1'),
    ('BEB-003', 'Toallitas húmedas x80', 'Bebé y maternidad', 'Venta directa', '1800', '', '70', '20', '24', '77120936-K', '76550134-2'),
    ('BEB-004', 'Fórmula infantil etapa 1 800 g', 'Bebé y maternidad', 'Venta directa', '14000', '', '25', '10', '18', '77120936-K', ''),
    ('BEB-005', 'Mamadera 250 ml', 'Bebé y maternidad', 'Venta directa', '3500', '', '30', '10', '', '77120936-K', '76318920-1'),
    ('BEB-006', 'Shampoo para bebé 400 ml', 'Bebé y maternidad', 'Venta directa', '2800', '', '40', '12', '30', '77120936-K', '76550134-2'),
    ('BEB-007', 'Agua de colonia para bebé 200 ml', 'Bebé y maternidad', 'Venta directa', '3200', '', '30', '10', '30', '77120936-K', '76550134-2'),
    ('BEB-008', 'Chupete de silicona x1', 'Bebé y maternidad', 'Venta directa', '1800', '', '2', '10', '', '77120936-K', '')
) AS v(sku, nombre, categoria, condicion, costo, margen, stock, minimo, vence_meses, prov, alt);

INSERT INTO producto (sku, nombre, costo, margen_utilidad, requiere_vencimiento, requiere_lote, categoria_id, condicion_venta_id)
SELECT d.sku, d.nombre, d.costo::numeric, COALESCE(NULLIF(d.margen, '')::numeric, c.margen_probable),
       d.vence_meses <> '', TRUE, c.id, cv.id
  FROM _prod_prueba d
  JOIN categoria c ON c.nombre = d.categoria
  JOIN condicion_venta cv ON cv.nombre = d.condicion
ON CONFLICT (sku) DO NOTHING;

-- 5. Proveedor principal de cada producto y, si hay, uno alternativo (5% más caro)
INSERT INTO producto_proveedor (producto_id, proveedor_id, costo_referencial, es_principal)
SELECT p.id, pv.id, d.costo::numeric, TRUE
  FROM _prod_prueba d JOIN producto p ON p.sku = d.sku JOIN proveedor pv ON pv.rut = d.prov
ON CONFLICT DO NOTHING;
INSERT INTO producto_proveedor (producto_id, proveedor_id, costo_referencial, es_principal)
SELECT p.id, pv.id, ROUND(d.costo::numeric * 1.05, 0), FALSE
  FROM _prod_prueba d JOIN producto p ON p.sku = d.sku JOIN proveedor pv ON pv.rut = d.alt
 WHERE d.alt <> ''
ON CONFLICT DO NOTHING;

-- 6. Stock mínimo en Casa Matriz
INSERT INTO stock_minimo_sucursal (producto_id, sucursal_id, stock_minimo)
SELECT p.id, s.id, d.minimo::int
  FROM _prod_prueba d JOIN producto p ON p.sku = d.sku CROSS JOIN sucursal s
 WHERE s.nombre = 'Casa Matriz' AND d.minimo::int > 0
ON CONFLICT DO NOTHING;

-- 7. Un lote por producto en Casa Matriz (vence_meses: meses desde hoy; negativo = ya vencido; vacío = no vence)
INSERT INTO lote (numero_lote, fecha_vencimiento, fecha_ingreso, cantidad_recibida, producto_id, sucursal_id)
SELECT 'PRUEBA-' || d.sku, x.venc, LEAST(h.hoy, COALESCE((x.venc - INTERVAL '6 months')::date, h.hoy)), d.stock::int, p.id, s.id
  FROM _prod_prueba d
  CROSS JOIN (SELECT (NOW() AT TIME ZONE 'America/Santiago')::date AS hoy) h
  JOIN producto p ON p.sku = d.sku
  CROSS JOIN sucursal s
  CROSS JOIN LATERAL (SELECT CASE WHEN d.vence_meses = '' THEN NULL
                                  ELSE (h.hoy + d.vence_meses::int * INTERVAL '1 month')::date END AS venc) x
 WHERE s.nombre = 'Casa Matriz' AND d.stock::int > 0
ON CONFLICT DO NOTHING;

-- 8. Entrada de ese stock al kardex: los triggers de la base suben la cantidad del lote y el stock web.
INSERT INTO movimiento_inventario (producto_id, sucursal_id, cantidad, motivo_movimiento_id, lote_id, usuario_id)
SELECT l.producto_id, l.sucursal_id, l.cantidad_recibida, m.id, l.id, u.id
  FROM lote l
  JOIN motivo_movimiento m ON m.nombre = 'Ajuste positivo'
  JOIN usuario u ON u.correo = 'sistema@farmaclick.cl'
 WHERE l.numero_lote LIKE 'PRUEBA-%' AND l.cantidad_recibida > 0
   AND NOT EXISTS (SELECT 1 FROM movimiento_inventario mi WHERE mi.lote_id = l.id);

DROP TABLE IF EXISTS _prod_prueba;

-- Resumen de lo que quedó cargado
SELECT (SELECT COUNT(*) FROM proveedor) AS proveedores,
       (SELECT COUNT(*) FROM producto) AS productos,
       (SELECT COUNT(*) FROM lote WHERE numero_lote LIKE 'PRUEBA-%') AS lotes_de_prueba,
       (SELECT COALESCE(SUM(cantidad_actual), 0) FROM lote WHERE numero_lote LIKE 'PRUEBA-%') AS unidades_en_stock;
