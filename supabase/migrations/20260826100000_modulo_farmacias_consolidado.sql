-- 20260826100000_modulo_farmacias_consolidado.sql
--
-- Módulo de Subinventarios / Perfil de Farmacias y Analítica Administrativa.
-- Migración única y consolidada — reemplaza el intento original dividido en
-- 8 archivos (20260826100000..20260826100700), que asumían tipos ENUM
-- nativos de Postgres (rol_usuario, tipo_movimiento) que NUNCA existieron en
-- este proyecto. Verificado por introspección directa contra la base real
-- antes de escribir esta versión: 'usuarios.rol', 'movimientos.tipo' y
-- 'ubicaciones.tipo' son columnas TEXT con CHECK constraint, no enums.
--
-- La introspección también reveló que faltaban piezas base anteriores al
-- módulo de farmacias, indispensables para que CUALQUIER movimiento
-- funcione: 'movimientos' tenía RLS habilitado con cero políticas (bloqueo
-- total), no existía ningún trigger en todo el schema 'public' (el
-- documentado 'trg_procesar_movimiento' que mantiene 'stock_ubicacion'
-- nunca se creó), y 'fn_obtener_rol_actual()' tampoco existía. Esta
-- migración reconstruye esa base ADEMÁS de agregar el módulo de farmacias,
-- porque una depende de la otra.
--
-- Ya se aplicó exitosamente contra el proyecto real (ref
-- ejoebkbkplvunqesiilh, "Denta Stock") vía `supabase db query --linked`, y
-- se verificó con pruebas funcionales en transacciones con ROLLBACK (una
-- entrada de proveedor subió el stock correctamente; un consumo mayor al
-- disponible fue rechazado con "Stock insuficiente..."). Este archivo deja
-- registrado en el repositorio el DDL exacto que quedó vigente, para que
-- `supabase db push` no intente reaplicarlo (idempotente si lo hiciera) ni
-- lo marque como pendiente.
--
-- Idempotencia: cada sección puede volver a correr sin error si ya se
-- aplicó antes (DROP ... IF EXISTS, ADD COLUMN IF NOT EXISTS, bloques
-- DO $$ guardados con EXISTS antes de crear constraints).

-- ----------------------------------------------------------------------
-- 0. Guardas de seguridad: si el esquema base no existe, detener con un
--    mensaje claro en vez de fallar más adelante con un error críptico.
-- ----------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'movimientos') THEN
    RAISE EXCEPTION 'La tabla public.movimientos no existe — esta migración asume el esquema base de DentaStock ya desplegado (productos, ubicaciones, usuarios, lotes, stock_ubicacion, movimientos). Verifica que estás conectado al proyecto correcto antes de continuar.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stock_ubicacion') THEN
    RAISE EXCEPTION 'La tabla public.stock_ubicacion no existe — mismo caso que arriba.';
  END IF;
END $$;

-- ----------------------------------------------------------------------
-- 1. usuarios.rol — normalizar datos y CHECK constraint
--    (antes: CHECK IN ('ADMINISTRADOR','PERSONAL_CLINICA'), texto plano)
-- ----------------------------------------------------------------------
ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_valido;

UPDATE public.usuarios SET rol = 'ADMIN' WHERE rol = 'ADMINISTRADOR';
UPDATE public.usuarios SET rol = 'ENCARGADO_FARMACIA' WHERE rol = 'PERSONAL_CLINICA';

ALTER TABLE public.usuarios
  ADD CONSTRAINT usuarios_rol_valido CHECK (rol IN ('ADMIN', 'ENCARGADO_FARMACIA'));

-- ----------------------------------------------------------------------
-- 2. ubicaciones.tipo — ya tenía el CHECK correcto (ubicaciones_tipo_check,
--    IN ('ALMACEN_CENTRAL','FARMACIA')) verificado por introspección; este
--    bloque es solo defensivo por si esta migración corre contra otro
--    entorno donde todavía no exista (ej. un ambiente local nuevo).
-- ----------------------------------------------------------------------
UPDATE public.ubicaciones SET tipo = 'ALMACEN_CENTRAL' WHERE codigo = 'ALM-CEN' AND tipo <> 'ALMACEN_CENTRAL';
UPDATE public.ubicaciones SET tipo = 'FARMACIA' WHERE codigo <> 'ALM-CEN' AND tipo <> 'FARMACIA';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ubicaciones'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%ALMACEN_CENTRAL%' AND pg_get_constraintdef(oid) ILIKE '%FARMACIA%'
  ) THEN
    ALTER TABLE public.ubicaciones ADD CONSTRAINT ubicaciones_tipo_valido CHECK (tipo IN ('ALMACEN_CENTRAL', 'FARMACIA'));
  END IF;
END $$;

ALTER TABLE public.ubicaciones ALTER COLUMN tipo SET DEFAULT 'FARMACIA';

-- ----------------------------------------------------------------------
-- 3. movimientos.tipo — CHECK constraint. Preserva TODOS los valores
--    reales que ya usa el código de la app (src/api/movimientos.ts,
--    DashboardScreen.tsx) y agrega únicamente 'SALIDA_PRACTICA'.
-- ----------------------------------------------------------------------
ALTER TABLE public.movimientos DROP CONSTRAINT IF EXISTS movimientos_tipo_check;
ALTER TABLE public.movimientos DROP CONSTRAINT IF EXISTS movimientos_tipo_valido;
ALTER TABLE public.movimientos
  ADD CONSTRAINT movimientos_tipo_valido CHECK (
    tipo IN (
      'ENTRADA_PROVEEDOR', 'TRASPASO_SALIDA', 'TRASPASO_ENTRADA', 'CONSUMO',
      'MERMA_CADUCIDAD', 'AJUSTE_POSITIVO', 'AJUSTE_NEGATIVO', 'DEVOLUCION_PROVEEDOR',
      'SALIDA_PRACTICA'
    )
  );

-- ----------------------------------------------------------------------
-- 4. movimientos.alumno_referencia — columna nueva para SALIDA_PRACTICA
-- ----------------------------------------------------------------------
ALTER TABLE public.movimientos ADD COLUMN IF NOT EXISTS alumno_referencia text NULL;

ALTER TABLE public.movimientos DROP CONSTRAINT IF EXISTS movimientos_salida_practica_requiere_alumno;
ALTER TABLE public.movimientos
  ADD CONSTRAINT movimientos_salida_practica_requiere_alumno
  CHECK (
    tipo <> 'SALIDA_PRACTICA'
    OR (alumno_referencia IS NOT NULL AND length(trim(alumno_referencia)) > 0)
  );

CREATE INDEX IF NOT EXISTS idx_movimientos_alumno_referencia
  ON public.movimientos (alumno_referencia)
  WHERE tipo = 'SALIDA_PRACTICA';

-- ----------------------------------------------------------------------
-- 5. Funciones helper de rol/ubicación/usuario actual
--    fn_obtener_rol_actual() NO EXISTÍA — solo se conocía por comentarios
--    en src/api/auth.ts, nunca verificada. Se crea aquí por primera vez.
-- ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_obtener_rol_actual()
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT rol FROM public.usuarios WHERE auth_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.fn_obtener_ubicacion_actual()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT ubicacion_id FROM public.usuarios WHERE auth_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.fn_obtener_usuario_id_actual()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT id FROM public.usuarios WHERE auth_id = auth.uid();
$$;

-- ----------------------------------------------------------------------
-- 6. Trigger trg_procesar_movimiento — NO EXISTÍA EN ABSOLUTO (verificado:
--    cero triggers de usuario en todo el schema public). Es la pieza
--    central documentada en todo el código (src/api/movimientos.ts) como
--    "la única fuente de verdad que mantiene stock_ubicacion", pero nunca
--    se desplegó. Reconstruida aquí a partir de la especificación
--    documentada en el código (no había DDL original que copiar):
--
--    Regla genérica (cubre los 9 tipos de movimiento sin necesitar un
--    CASE por cada uno, y automáticamente soporta SALIDA_PRACTICA):
--      - Si la fila tiene ubicacion_origen_id: RESTA cantidad del stock
--        de esa ubicación. Si dejaría el stock negativo, RAISE EXCEPTION
--        con la palabra "insuficiente" en el mensaje — traducirErrorMotor()
--        en src/api/movimientos.ts depende literalmente de esa palabra
--        para traducir el error a un código de dominio.
--      - Si la fila tiene ubicacion_destino_id: SUMA cantidad al stock de
--        esa ubicación (UPSERT vía ON CONFLICT, ya existe la restricción
--        UNIQUE (producto_id, ubicacion_id) en stock_ubicacion, verificada
--        por introspección).
--
--    SECURITY DEFINER (con search_path fijo, práctica recomendada para
--    evitar secuestro de search_path) para que el trigger pueda escribir
--    en stock_ubicacion sin necesitar políticas de INSERT/UPDATE propias
--    para el rol 'authenticated' — 'stock_ubicacion' sigue siendo de solo
--    lectura para cualquier rol de aplicación, tal como está documentado
--    ("nunca se escribe a mano"), y solo este trigger, con privilegio
--    elevado, la modifica.
--
--    Fuera de alcance deliberado (documentado como límite preexistente en
--    los comentarios originales del proyecto): este trigger NO descuenta
--    lotes.cantidad_actual por lote — ese descuento por lote nunca se
--    implementó y no es parte de esta reconstrucción.
--
--    Probado en producción en transacciones con ROLLBACK antes de dejarlo
--    confirmado: una ENTRADA_PROVEEDOR de 5 unidades subió el stock de 15
--    a 20; un CONSUMO de 99999 unidades fue rechazado con "Stock
--    insuficiente..." sin alterar el stock existente.
-- ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_procesar_movimiento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actual numeric;
BEGIN
  IF NEW.ubicacion_origen_id IS NOT NULL THEN
    SELECT cantidad_actual INTO v_actual
    FROM public.stock_ubicacion
    WHERE producto_id = NEW.producto_id AND ubicacion_id = NEW.ubicacion_origen_id
    FOR UPDATE;

    IF v_actual IS NULL OR v_actual < NEW.cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente en la ubicación de origen para completar este movimiento (disponible: %, requerido: %)',
        COALESCE(v_actual, 0), NEW.cantidad;
    END IF;

    UPDATE public.stock_ubicacion
    SET cantidad_actual = cantidad_actual - NEW.cantidad,
        ultima_actualizacion = now()
    WHERE producto_id = NEW.producto_id AND ubicacion_id = NEW.ubicacion_origen_id;
  END IF;

  IF NEW.ubicacion_destino_id IS NOT NULL THEN
    INSERT INTO public.stock_ubicacion (producto_id, ubicacion_id, cantidad_actual, ultima_actualizacion)
    VALUES (NEW.producto_id, NEW.ubicacion_destino_id, NEW.cantidad, now())
    ON CONFLICT (producto_id, ubicacion_id) DO UPDATE
    SET cantidad_actual = public.stock_ubicacion.cantidad_actual + EXCLUDED.cantidad_actual,
        ultima_actualizacion = now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_procesar_movimiento ON public.movimientos;
CREATE TRIGGER trg_procesar_movimiento
  AFTER INSERT ON public.movimientos
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_procesar_movimiento();

-- ----------------------------------------------------------------------
-- 7. Políticas RLS base de 'movimientos' — TAMBIÉN FALTABAN POR COMPLETO
--    (RLS habilitado, cero políticas = bloqueo total). Lectura abierta a
--    cualquier autenticado (mismo patrón usado en el resto del esquema:
--    categorias/lotes/productos/proveedores/stock_ubicacion/ubicaciones
--    ya usan qual=true). Escritura restringida por rol: ADMIN sin
--    restricciones; ENCARGADO_FARMACIA solo sus dos flujos permitidos
--    (políticas 8-9 abajo). No se agregan políticas de UPDATE/DELETE:
--    el kardex es de solo-inserción por diseño (nadie corrige ni borra
--    un movimiento ya registrado), así que quedan bloqueadas por
--    defecto para todos los roles de aplicación — comportamiento
--    correcto para un libro de auditoría inmutable.
-- ----------------------------------------------------------------------
DROP POLICY IF EXISTS movimientos_select_autenticado ON public.movimientos;
CREATE POLICY movimientos_select_autenticado ON public.movimientos
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS admin_insert_movimientos ON public.movimientos;
CREATE POLICY admin_insert_movimientos ON public.movimientos
FOR INSERT TO authenticated
WITH CHECK (fn_obtener_rol_actual() = 'ADMIN');

-- ----------------------------------------------------------------------
-- 8-9. Políticas RLS específicas de farmacias — aditivas, no tocan nada
--    de lo anterior.
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
      AND ubicacion_origen_id IN (SELECT id FROM public.ubicaciones WHERE tipo = 'ALMACEN_CENTRAL'))
  )
);

DROP POLICY IF EXISTS farmacia_insert_salida_practica ON public.movimientos;
CREATE POLICY farmacia_insert_salida_practica ON public.movimientos
FOR INSERT TO authenticated
WITH CHECK (
  fn_obtener_rol_actual() = 'ENCARGADO_FARMACIA'
  AND usuario_id = fn_obtener_usuario_id_actual()
  AND tipo = 'SALIDA_PRACTICA'
  AND ubicacion_origen_id = fn_obtener_ubicacion_actual()
  AND ubicacion_destino_id IS NULL
);

-- SELECT restrictiva: acota lo que ENCARGADO_FARMACIA puede VER dentro de
-- lo que la política abierta de arriba ya permite (las RESTRICTIVE se
-- combinan con AND contra todas las PERMISSIVE). El "OR usuario_id = ..."
-- es necesario para que RETURNING dentro de fn_registrar_traspaso siga
-- devolviendo la fila TRASPASO_SALIDA (origen=Almacén Central,
-- destino=NULL) al farmacéutico que la generó — sin esto, esa fila no
-- coincide con su propia ubicación y RETURNING la filtraría, dejando
-- v_salida en NULL dentro del RPC.
DROP POLICY IF EXISTS farmacia_restringe_movimientos ON public.movimientos;
CREATE POLICY farmacia_restringe_movimientos
ON public.movimientos AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  fn_obtener_rol_actual() <> 'ENCARGADO_FARMACIA'
  OR ubicacion_origen_id = fn_obtener_ubicacion_actual()
  OR ubicacion_destino_id = fn_obtener_ubicacion_actual()
  OR usuario_id = fn_obtener_usuario_id_actual()
);

DROP POLICY IF EXISTS farmacia_restringe_stock_ubicacion ON public.stock_ubicacion;
CREATE POLICY farmacia_restringe_stock_ubicacion
ON public.stock_ubicacion AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  fn_obtener_rol_actual() <> 'ENCARGADO_FARMACIA'
  OR ubicacion_id = fn_obtener_ubicacion_actual()
);

DROP POLICY IF EXISTS farmacia_restringe_lotes ON public.lotes;
CREATE POLICY farmacia_restringe_lotes
ON public.lotes AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  fn_obtener_rol_actual() <> 'ENCARGADO_FARMACIA'
  OR EXISTS (
    SELECT 1 FROM public.movimientos m
    WHERE m.lote_id = lotes.id AND m.ubicacion_destino_id = fn_obtener_ubicacion_actual()
  )
);

-- ----------------------------------------------------------------------
-- 10. v_valorizacion_inventario — se agrega ubicacion_id al final.
--     Definición real verificada por introspección (pg_views) antes de
--     escribir este CREATE OR REPLACE: coincide exactamente con la
--     asumida, así que el REPLACE es seguro (Postgres exige que las
--     columnas existentes no cambien de nombre/orden/tipo; solo se
--     puede agregar al final, que es justo lo que hace este bloque).
--     Sin DROP VIEW CASCADE (innecesario y arriesga tirar objetos
--     dependientes) y sin filtro adicional de "activos" — el Dashboard y
--     Reportes siguen viendo exactamente los mismos números que antes.
-- ----------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_valorizacion_inventario AS
SELECT
  u.nombre AS area,
  p.codigo_barras,
  p.concepto,
  c.nombre AS categoria,
  COALESCE(lt.cantidad_total, su.cantidad_actual::numeric) AS cantidad_actual,
  CASE
    WHEN COALESCE(lt.cantidad_total, 0) > 0 THEN lt.valor_total / lt.cantidad_total
    ELSE p.precio_sin_iva
  END AS precio_unitario,
  COALESCE(lt.valor_total, su.cantidad_actual::numeric * p.precio_sin_iva) AS valor_total,
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
  WHERE estado = 'ACTIVO' AND costo_unitario IS NOT NULL
  GROUP BY producto_id
) lt ON lt.producto_id = p.id;

-- ----------------------------------------------------------------------
-- 11. Vistas nuevas de farmacias
-- ----------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_stock_farmacia
WITH (security_invoker = true) AS
SELECT
  su.id,
  su.ubicacion_id,
  u.nombre AS ubicacion_nombre,
  u.codigo AS ubicacion_codigo,
  su.producto_id,
  p.codigo_barras,
  p.concepto,
  p.unidad_medida,
  p.requiere_lote,
  p.stock_minimo,
  p.punto_reorden,
  su.cantidad_actual,
  su.ultima_actualizacion,
  c.nombre AS categoria
FROM public.stock_ubicacion su
JOIN public.productos p ON p.id = su.producto_id
JOIN public.ubicaciones u ON u.id = su.ubicacion_id
LEFT JOIN public.categorias c ON c.id = p.categoria_id;

CREATE OR REPLACE VIEW public.v_consumo_practicas
WITH (security_invoker = true) AS
SELECT
  m.id,
  m.created_at,
  m.ubicacion_origen_id,
  u.nombre AS farmacia,
  m.producto_id,
  p.concepto,
  p.codigo_barras,
  m.cantidad,
  m.alumno_referencia,
  m.comentario,
  us.nombre_completo AS registrado_por
FROM public.movimientos m
JOIN public.ubicaciones u ON u.id = m.ubicacion_origen_id
JOIN public.productos p ON p.id = m.producto_id
JOIN public.usuarios us ON us.id = m.usuario_id
WHERE m.tipo = 'SALIDA_PRACTICA';
