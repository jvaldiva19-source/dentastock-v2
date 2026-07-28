-- lotes no tenía forma de saber cuánto queda EN ESE LOTE específico:
-- cantidad_inicial es la cantidad recibida originalmente y nunca se
-- toca después (es historial de compra, no inventario vivo). El
-- consumo actual solo se descuenta de forma agregada en
-- stock_ubicacion, sin distinguir de qué lote sale cada unidad.
--
-- Esto se vuelve un problema real cuando un mismo producto tiene dos
-- lotes con presentación y costo distintos, como se confirmó el
-- 2026-07-22 para DS-1583 y DS-1585: cada uno tiene un lote comprado
-- por caja y otro por pieza suelta, a costos unitarios muy distintos
-- ($978 vs $6.751, y $854.998 vs $9.002). Sin cantidad_actual por
-- lote no hay forma correcta de calcular el valor de cada lote por
-- separado; agregarlo todo en un solo cantidad_actual (como se
-- intentó en un fix anterior, revertido) pierde esa distinción de
-- costo y de unidad de medida.
--
-- Se agrega cantidad_actual a lotes para que v_valorizacion_inventario
-- (ver la migración siguiente) pueda sumar cantidad_actual * costo_unitario
-- lote por lote, en vez de tratar cada producto como un solo costo
-- unitario uniforme.
--
-- LIMITACIÓN CONOCIDA (dejar como seguimiento, no se resuelve aquí):
-- el trigger trg_procesar_movimiento actualiza stock_ubicacion en cada
-- movimiento, pero no existe en este repo el trigger que debería
-- descontar de lotes.cantidad_actual cuando se consume de un lote
-- específico. Mientras ese trigger no exista o no se actualice para
-- mantener lotes.cantidad_actual, esta columna quedará desactualizada
-- según se registren nuevos consumos. Revisar/actualizar
-- trg_procesar_movimiento (o el flujo de fn_registrar_traspaso) para
-- que también descuente de lotes.cantidad_actual por lote consumido.

ALTER TABLE public.lotes
  ADD COLUMN IF NOT EXISTS cantidad_actual numeric NOT NULL DEFAULT 0;

-- Backfill de lotes ya existentes: sin historial de consumo por lote,
-- la única aproximación disponible es asumir que un lote AGOTADO ya no
-- tiene existencia (0) y que cualquier otro estado conserva su
-- cantidad_inicial completa. Es una aproximación, no un cálculo exacto
-- — ajustar manualmente los lotes que se sepa tienen consumo parcial.
UPDATE public.lotes
SET cantidad_actual = CASE WHEN estado = 'AGOTADO' THEN 0 ELSE cantidad_inicial END
WHERE cantidad_actual = 0;

-- Registro de los 4 lotes reales confirmados el 2026-07-22 para
-- DS-1583 y DS-1585. proveedor_id se deja NULL porque el proveedor de
-- cada lote no se especificó — actualizar en cuanto se confirme.
-- numero_lote es un identificador provisional (no hay folio real
-- capturado); reemplazar por el folio/lote físico real si existe.
DO $$
DECLARE
  v_producto_id uuid;
BEGIN
  -- DS-1583 · Radiografía Adulto Carestream
  SELECT id INTO v_producto_id FROM public.productos WHERE codigo_barras = 'DS-1583';

  IF v_producto_id IS NOT NULL THEN
    INSERT INTO public.lotes
      (producto_id, numero_lote, fecha_entrada, costo_unitario, cantidad_inicial, cantidad_actual, estado)
    SELECT v_producto_id, 'AJUSTE-DS-1583-CAJA-20260722', CURRENT_DATE, 978.000, 21, 21, 'ACTIVO'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.lotes
      WHERE producto_id = v_producto_id AND numero_lote = 'AJUSTE-DS-1583-CAJA-20260722'
    );

    INSERT INTO public.lotes
      (producto_id, numero_lote, fecha_entrada, costo_unitario, cantidad_inicial, cantidad_actual, estado)
    SELECT v_producto_id, 'AJUSTE-DS-1583-PIEZA-20260722', CURRENT_DATE, 6.751, 4500, 4500, 'ACTIVO'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.lotes
      WHERE producto_id = v_producto_id AND numero_lote = 'AJUSTE-DS-1583-PIEZA-20260722'
    );
  END IF;

  -- DS-1585 · Radiografía Infantil Carestream
  SELECT id INTO v_producto_id FROM public.productos WHERE codigo_barras = 'DS-1585';

  IF v_producto_id IS NOT NULL THEN
    INSERT INTO public.lotes
      (producto_id, numero_lote, fecha_entrada, costo_unitario, cantidad_inicial, cantidad_actual, estado)
    SELECT v_producto_id, 'AJUSTE-DS-1585-CAJA-20260722', CURRENT_DATE, 854.998, 1, 1, 'ACTIVO'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.lotes
      WHERE producto_id = v_producto_id AND numero_lote = 'AJUSTE-DS-1585-CAJA-20260722'
    );

    INSERT INTO public.lotes
      (producto_id, numero_lote, fecha_entrada, costo_unitario, cantidad_inicial, cantidad_actual, estado)
    SELECT v_producto_id, 'AJUSTE-DS-1585-PIEZA-20260722', CURRENT_DATE, 9.002, 1000, 1000, 'ACTIVO'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.lotes
      WHERE producto_id = v_producto_id AND numero_lote = 'AJUSTE-DS-1585-PIEZA-20260722'
    );
  END IF;
END $$;
