-- Reemplaza el intento anterior (promedio ponderado de costo por
-- producto) por el cálculo correcto: valor_total se calcula lote por
-- lote — cantidad_actual del lote * costo_unitario de ESE lote — y
-- luego se suman los lotes de un mismo producto. Esto es necesario
-- porque, como se confirmó el 2026-07-22 para DS-1583 y DS-1585, un
-- mismo producto puede tener lotes con costo y unidad de medida
-- distintos (una caja completa vs. piezas sueltas), y promediar habría
-- seguido sesgando el valor. Requiere la columna lotes.cantidad_actual
-- agregada en la migración anterior
-- (20260722120000_add_lotes_cantidad_actual_y_registros_ds1583_ds1585.sql).
--
-- IMPORTANTE — igual que en el intento anterior, esta es una
-- reconstrucción de la vista a partir del esquema documentado en
-- src/types/database.types.ts, no la definición real (nunca se
-- versionó un CREATE VIEW en este repo). Antes de aplicar, compara
-- contra `SELECT pg_get_viewdef('public.v_valorizacion_inventario', true);`
-- en el SQL Editor de Supabase.
--
-- LIMITACIÓN CONOCIDA: lotes no tiene ubicacion_id (un lote no está
-- amarrado a una sola área/almacén), mientras que esta vista sigue
-- reportando "area" desde stock_ubicacion/ubicaciones. Con un solo
-- almacén activo (ALMACEN CENTRAL, que es el 100% de los datos hoy)
-- esto no distorsiona el resultado, pero si el catálogo crece a
-- múltiples ubicaciones con lotes compartidos entre ellas, el valor
-- total por lote se repetiría en cada área en vez de dividirse. Si eso
-- llega a pasar, hay que decidir cómo prorratear cantidad_actual de un
-- lote entre ubicaciones (o agregar ubicacion_id a lotes).
--
-- También: cantidad_actual y precio_unitario en esta vista son, por
-- diseño de su Row original (un escalar por producto, no por lote),
-- una cantidad física sumada entre lotes (aunque estén en unidades de
-- medida distintas, ej. 21 cajas + 4500 piezas = "4521" en esta
-- columna) y un costo unitario promedio implícito (valor_total /
-- cantidad_total). valor_total es exacto; cantidad_actual y
-- precio_unitario en esta vista son una cifra combinada de referencia,
-- no un dato preciso por unidad de medida — si se necesita el detalle
-- por lote, consultar directamente la tabla lotes.

CREATE OR REPLACE VIEW public.v_valorizacion_inventario AS
SELECT
  u.nombre AS area,
  p.codigo_barras,
  p.concepto,
  c.nombre AS categoria,
  COALESCE(lt.cantidad_total, su.cantidad_actual) AS cantidad_actual,
  CASE
    WHEN COALESCE(lt.cantidad_total, 0) > 0 THEN lt.valor_total / lt.cantidad_total
    ELSE p.precio_sin_iva
  END AS precio_unitario,
  COALESCE(lt.valor_total, su.cantidad_actual * p.precio_sin_iva) AS valor_total,
  CASE WHEN p.activo THEN 'ACTIVO' ELSE 'INACTIVO' END AS estado
FROM public.stock_ubicacion su
JOIN public.productos p ON p.id = su.producto_id
JOIN public.ubicaciones u ON u.id = su.ubicacion_id
LEFT JOIN public.categorias c ON c.id = p.categoria_id
LEFT JOIN (
  SELECT
    producto_id,
    SUM(cantidad_actual) AS cantidad_total,
    SUM(cantidad_actual * costo_unitario) AS valor_total
  FROM public.lotes
  WHERE estado = 'ACTIVO'
    AND costo_unitario IS NOT NULL
  GROUP BY producto_id
) lt ON lt.producto_id = p.id;
