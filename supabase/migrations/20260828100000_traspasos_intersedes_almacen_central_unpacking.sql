-- 20260828100000_traspasos_intersedes_almacen_central_unpacking.sql
--
-- Tres mejoras sobre el módulo de farmacias e inventario:
--
--   1. Traspasos inter-sedes: un ENCARGADO_FARMACIA puede enviar material
--      desde SU PROPIA farmacia hacia cualquier otra farmacia activa (antes
--      solo podía recibir desde Almacén Central).
--   2. Consulta de existencias de Almacén Central sin costos: vista segura
--      para que cualquier encargado verifique disponibilidad antes de pedir.
--   3. Conversión de unidad de empaque a piezas clínicas: productos.piezas_
--      por_empaque, aplicada automáticamente por fn_registrar_traspaso
--      cuando el material sale de Almacén Central (empacado) hacia una
--      farmacia (que dispensa pieza por pieza).
--
-- fn_registrar_traspaso() NUNCA se desplegó realmente: solo existía como
-- comentario de referencia al final de src/api/movimientos.ts (ver ese
-- archivo, sección "DDL DE REFERENCIA"). Esta migración la crea por primera
-- vez, ahora como SECURITY DEFINER: la lógica de autorización (quién puede
-- usar qué origen/destino) y el cálculo del factor de empaque necesitan
-- resolver datos (tipo de ubicación, piezas_por_empaque del producto) que
-- una política RLS por fila no puede expresar de forma confiable — sobre
-- todo porque las dos filas insertadas (TRASPASO_SALIDA / TRASPASO_ENTRADA)
-- ya no llevan la misma "cantidad" cuando aplica el factor de empaque.
-- Las políticas RLS de 'movimientos' se mantienen y se extienden como capa
-- adicional de defensa en profundidad (ver sección 3): protegen contra un
-- INSERT directo a la tabla que se salte el RPC, aunque el RPC ya no
-- dependa de ellas para autorizar.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS, DROP ... IF EXISTS antes de cada
-- CREATE/CREATE OR REPLACE, DROP POLICY IF EXISTS antes de cada política.

-- ----------------------------------------------------------------------
-- 0. Guarda de seguridad
-- ----------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'productos') THEN
    RAISE EXCEPTION 'La tabla public.productos no existe — esta migración asume el esquema base de DentaStock ya desplegado. Verifica que estás conectado al proyecto correcto antes de continuar.';
  END IF;
END $$;

-- ----------------------------------------------------------------------
-- 1. productos.piezas_por_empaque — factor de conversión de unidad de
--    empaque (como se surte desde Almacén Central) a piezas clínicas
--    (como se dispensa en farmacia). Default 1 = sin conversión, el
--    comportamiento actual para cualquier producto que no la necesite.
-- ----------------------------------------------------------------------
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS piezas_por_empaque integer NOT NULL DEFAULT 1;

ALTER TABLE public.productos DROP CONSTRAINT IF EXISTS productos_piezas_por_empaque_valido;
ALTER TABLE public.productos
  ADD CONSTRAINT productos_piezas_por_empaque_valido CHECK (piezas_por_empaque >= 1);

-- ----------------------------------------------------------------------
-- 2. fn_registrar_traspaso — creada por primera vez (ver nota superior).
--    SECURITY DEFINER + search_path fijo, mismo patrón que
--    trg_procesar_movimiento: corre con privilegio elevado para poder
--    insertar en 'movimientos' sin depender de que las políticas RLS
--    autoricen cada combinación posible de origen/destino, y hace toda
--    la validación de autorización explícitamente en el cuerpo de la
--    función antes de escribir nada.
--
--    Reglas de autorización:
--      - ADMIN: sin restricción de origen/destino (igual que
--        admin_insert_movimientos ya permite hoy vía INSERT directo).
--      - ENCARGADO_FARMACIA, solo dos combinaciones:
--          a) Recepción: origen = Almacén Central, destino = su propia
--             ubicación (flujo ya existente, "Recibir Traspaso").
--          b) Envío inter-sedes (NUEVO): origen = su propia ubicación,
--             destino = cualquier otra farmacia activa.
--      - Cualquier otro rol o combinación: RAISE EXCEPTION.
--
--    Conversión de unidad de empaque (NUEVA): cuando origen es tipo
--    ALMACEN_CENTRAL y destino es tipo FARMACIA, la fila TRASPASO_SALIDA
--    se registra con la cantidad tal cual la capturó quien despacha
--    (empaques), pero la fila TRASPASO_ENTRADA que suma el stock de la
--    farmacia se multiplica por productos.piezas_por_empaque. En
--    cualquier otro caso (traspaso entre farmacias, o cualquier otro par
--    de tipos de ubicación) el factor es 1 — las salidas por práctica en
--    farmacia (SALIDA_PRACTICA, fuera del alcance de esta función) ya
--    descuentan pieza por pieza sin pasar por aquí.
--
--    RETURNING sigue el mismo contrato que el DDL de referencia original
--    en movimientos.ts: json_build_array(salida, entrada).
-- ----------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.fn_registrar_traspaso(uuid, uuid, uuid, integer, uuid, uuid);

CREATE FUNCTION public.fn_registrar_traspaso(
  p_producto_id          uuid,
  p_ubicacion_origen_id  uuid,
  p_ubicacion_destino_id uuid,
  p_cantidad             integer,
  p_usuario_id           uuid,
  p_lote_id              uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rol              text;
  v_ubicacion_actual uuid;
  v_usuario_actual   uuid;
  v_origen_tipo      text;
  v_destino_tipo     text;
  v_destino_activo   boolean;
  v_piezas_empaque   integer;
  v_cantidad_entrada integer;
  v_salida           public.movimientos;
  v_entrada          public.movimientos;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad a traspasar debe ser mayor a cero.';
  END IF;

  IF p_ubicacion_origen_id = p_ubicacion_destino_id THEN
    RAISE EXCEPTION 'El origen y el destino del traspaso no pueden ser la misma ubicación.';
  END IF;

  v_rol := public.fn_obtener_rol_actual();
  v_ubicacion_actual := public.fn_obtener_ubicacion_actual();
  v_usuario_actual := public.fn_obtener_usuario_id_actual();

  IF v_usuario_actual IS NULL OR p_usuario_id <> v_usuario_actual THEN
    RAISE EXCEPTION 'No autorizado: el usuario que registra el traspaso debe ser el usuario autenticado actual.';
  END IF;

  SELECT tipo INTO v_origen_tipo FROM public.ubicaciones WHERE id = p_ubicacion_origen_id;
  SELECT tipo, activo INTO v_destino_tipo, v_destino_activo FROM public.ubicaciones WHERE id = p_ubicacion_destino_id;

  IF v_origen_tipo IS NULL THEN
    RAISE EXCEPTION 'La ubicación de origen especificada no existe.';
  END IF;

  IF v_destino_tipo IS NULL THEN
    RAISE EXCEPTION 'La ubicación de destino especificada no existe.';
  END IF;

  IF NOT v_destino_activo THEN
    RAISE EXCEPTION 'La ubicación de destino no está activa.';
  END IF;

  IF v_rol = 'ADMIN' THEN
    NULL; -- Sin restricción adicional de origen/destino.
  ELSIF v_rol = 'ENCARGADO_FARMACIA' THEN
    IF v_origen_tipo = 'ALMACEN_CENTRAL' AND p_ubicacion_destino_id = v_ubicacion_actual THEN
      NULL; -- (a) Recepción desde Almacén Central hacia su propia farmacia.
    ELSIF p_ubicacion_origen_id = v_ubicacion_actual AND v_destino_tipo = 'FARMACIA' THEN
      NULL; -- (b) Envío inter-sedes: origen = su propia farmacia, destino = otra farmacia activa.
    ELSE
      RAISE EXCEPTION 'No tienes permiso para registrar un traspaso con este origen y destino.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Tu rol no tiene permiso para registrar traspasos.';
  END IF;

  IF v_origen_tipo = 'ALMACEN_CENTRAL' AND v_destino_tipo = 'FARMACIA' THEN
    SELECT piezas_por_empaque INTO v_piezas_empaque
    FROM public.productos WHERE id = p_producto_id;

    IF v_piezas_empaque IS NULL THEN
      RAISE EXCEPTION 'El producto especificado no existe en el catálogo.';
    END IF;
  ELSE
    v_piezas_empaque := 1;
  END IF;

  v_cantidad_entrada := p_cantidad * v_piezas_empaque;

  INSERT INTO public.movimientos (
    tipo, producto_id, lote_id, ubicacion_origen_id, cantidad, usuario_id
  ) VALUES (
    'TRASPASO_SALIDA', p_producto_id, p_lote_id, p_ubicacion_origen_id, p_cantidad, p_usuario_id
  ) RETURNING * INTO v_salida;

  INSERT INTO public.movimientos (
    tipo, producto_id, lote_id, ubicacion_destino_id, cantidad, usuario_id
  ) VALUES (
    'TRASPASO_ENTRADA', p_producto_id, p_lote_id, p_ubicacion_destino_id, v_cantidad_entrada, p_usuario_id
  ) RETURNING * INTO v_entrada;

  -- Ambos INSERT viven en la transacción implícita de esta función: si el
  -- segundo fallara (por ejemplo el trigger rechazando stock negativo en
  -- el origen), el primero se revierte automáticamente.
  RETURN json_build_array(row_to_json(v_salida), row_to_json(v_entrada));
END;
$$;

-- ----------------------------------------------------------------------
-- 3. RLS de 'movimientos' — capa adicional de defensa en profundidad.
--    fn_registrar_traspaso (SECURITY DEFINER) ya no depende de estas
--    políticas para autorizar, pero se extienden para que un INSERT
--    directo a la tabla (fuera del RPC) respete la misma regla nueva:
--    un ENCARGADO_FARMACIA puede registrar una salida cuyo origen sea
--    su propia ubicación, además del caso ya existente (origen = Almacén
--    Central). No se amplía la rama de TRASPASO_ENTRADA hacia destinos
--    que no sean la propia ubicación del usuario: permitirlo por RLS
--    habilitaría inyectar stock en la farmacia de un tercero mediante un
--    INSERT directo sin su TRASPASO_SALIDA correspondiente — ese flujo
--    solo es seguro a través de fn_registrar_traspaso, que valida origen
--    y destino en conjunto antes de escribir cualquiera de las dos filas.
-- ----------------------------------------------------------------------
DROP POLICY IF EXISTS farmacia_insert_recepcion_traspaso ON public.movimientos;
CREATE POLICY farmacia_insert_recepcion_traspaso ON public.movimientos
FOR INSERT TO authenticated
WITH CHECK (
  fn_obtener_rol_actual() = 'ENCARGADO_FARMACIA'
  AND usuario_id = fn_obtener_usuario_id_actual()
  AND (
    (tipo = 'TRASPASO_ENTRADA' AND ubicacion_destino_id = fn_obtener_ubicacion_actual())
    OR
    (tipo = 'TRASPASO_SALIDA'
      AND (
        ubicacion_origen_id IN (SELECT id FROM public.ubicaciones WHERE tipo = 'ALMACEN_CENTRAL')
        OR ubicacion_origen_id = fn_obtener_ubicacion_actual()
      )
    )
  )
);

-- ----------------------------------------------------------------------
-- 4. v_disponibilidad_almacen_central — consulta de existencias de
--    Almacén Central sin costos, para que cualquier ENCARGADO_FARMACIA
--    verifique disponibilidad antes de solicitar insumos.
--
--    Deliberadamente SIN "WITH (security_invoker = true)": la política
--    RESTRICTIVE farmacia_restringe_stock_ubicacion (migración
--    20260826100000) limita a un ENCARGADO_FARMACIA a ver solo las filas
--    de stock_ubicacion de su propia farmacia — correcto para v_stock_
--    farmacia, pero bloquearía esta vista si corriera con los privilegios
--    del invocador. Al omitir security_invoker, la vista corre con los
--    privilegios de su propietario (igual que v_valorizacion_inventario)
--    y por tanto no queda sujeta a esa restricción; la seguridad de la
--    vista está garantizada por su propia definición, no por RLS: solo
--    proyecta id/codigo_barras/concepto/categoria/cantidad_actual_central
--    — nunca precio_sin_iva, precio_con_iva ni ninguna otra columna
--    monetaria — y solo de la ubicación ALMACEN_CENTRAL, sin importar
--    quién la consulte.
-- ----------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_disponibilidad_almacen_central AS
SELECT
  p.id,
  p.codigo_barras,
  p.concepto,
  c.nombre AS categoria,
  COALESCE(su.cantidad_actual, 0) AS cantidad_actual_central
FROM public.productos p
JOIN public.ubicaciones u ON u.tipo = 'ALMACEN_CENTRAL' AND u.activo = true
LEFT JOIN public.stock_ubicacion su ON su.producto_id = p.id AND su.ubicacion_id = u.id
LEFT JOIN public.categorias c ON c.id = p.categoria_id
WHERE p.activo = true;
