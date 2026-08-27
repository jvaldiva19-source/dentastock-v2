-- 20260826110000_valorizacion_con_iva.sql
--
-- Cambia v_valorizacion_inventario para valuar con PRECIO CON IVA en vez de
-- precio_sin_iva, a petición explícita de Administración: el valor total del
-- inventario debe reflejar el precio de reposición real (con impuestos), no
-- el costo antes de IVA.
--
-- Solo cambia la columna de precio usada en dos lugares (mismo patrón que
-- 20260722120100_fix_valorizacion_inventario_por_lote.sql, del cual esta es
-- una revisión mínima):
--   1. precio_unitario de respaldo cuando el producto no tiene lotes con
--      costo_unitario (CASE ... ELSE p.precio_sin_iva -> p.precio_con_iva).
--   2. valor_total de respaldo en el mismo caso (COALESCE(lt.valor_total,
--      su.cantidad_actual * p.precio_sin_iva) -> ... * p.precio_con_iva).
--
-- El filtro de productos activos NO se agrega dentro de la vista: ya se
-- resuelve en la capa de consulta (src/api/reportes.ts filtra
-- .eq('estado', 'ACTIVO'), y estado ya es CASE WHEN p.activo THEN 'ACTIVO' ...
-- ELSE 'INACTIVO' END) — agregar un WHERE p.activo aquí además removería la
-- columna 'estado' de utilidad para quien sí necesita ver inactivos, sin
-- cambiar el resultado que consume el Dashboard.
--
-- Cuando un producto tiene lotes activos con costo_unitario, valor_total
-- sigue viniendo de esos lotes (costo real de compra), no de precio_con_iva
-- — este cambio solo afecta el respaldo para productos sin lotes costeados.
--
-- Reproduce la definición real vigente (obtenida con
-- pg_get_viewdef('public.v_valorizacion_inventario', true) antes de aplicar
-- esta migración) tal cual, incluida la columna ubicacion_id agregada por
-- 20260826100000_modulo_farmacias_consolidado.sql — CREATE OR REPLACE VIEW
-- no permite quitar columnas existentes, solo agregar o cambiar su
-- expresión, así que hay que partir de la forma exacta que ya está en
-- producción.

CREATE OR REPLACE VIEW public.v_valorizacion_inventario AS
SELECT
  u.nombre AS area,
  p.codigo_barras,
  p.concepto,
  c.nombre AS categoria,
  COALESCE(lt.cantidad_total, su.cantidad_actual) AS cantidad_actual,
  CASE
    WHEN COALESCE(lt.cantidad_total, 0) > 0 THEN lt.valor_total / lt.cantidad_total
    ELSE p.precio_con_iva
  END AS precio_unitario,
  COALESCE(lt.valor_total, su.cantidad_actual * p.precio_con_iva) AS valor_total,
  CASE WHEN p.activo THEN 'ACTIVO' ELSE 'INACTIVO' END AS estado,
  u.id AS ubicacion_id
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
