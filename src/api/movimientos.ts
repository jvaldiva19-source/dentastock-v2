import { supabase } from '../lib/supabase'
import { type Result, okResult, failResult } from '../lib/result'
import type { Movimiento, TipoMovimiento } from '../types/database.types'

/**
 * src/api/movimientos.ts
 *
 * Capa de ESCRITURA de inventario. Es el módulo más delicado del
 * proyecto: cada función aquí puede disparar el trigger
 * trg_procesar_movimiento, que recalcula stock_ubicacion de forma
 * atómica y rechaza cualquier operación que dejaría stock negativo
 * (CHECK (cantidad_actual >= 0) a nivel de motor).
 *
 * Ninguna función de este archivo construye el stock manualmente —
 * todas insertan en 'movimientos' (o llaman a un RPC que lo hace en
 * una transacción) y dejan que el trigger sea la única fuente de
 * verdad sobre el stock resultante.
 */

// ------------------------------------------------------------------
// Tipos de resultado y error de este dominio
// ------------------------------------------------------------------

export type MovimientosErrorCode =
  | 'DATOS_INVALIDOS'
  | 'STOCK_INSUFICIENTE'
  | 'LOTE_NO_DISPONIBLE'
  | 'OPERACION_RECHAZADA'
  | 'ERROR_RED'
  | 'ERROR_DESCONOCIDO'

export class MovimientosApiError extends Error {
  readonly code: MovimientosErrorCode

  constructor(code: MovimientosErrorCode, message: string) {
    super(message)
    this.name = 'MovimientosApiError'
    this.code = code
  }
}

export type MovimientosResult<T> = Result<T, MovimientosApiError>

function fail(
  code: MovimientosErrorCode,
  message: string,
): MovimientosResult<never> {
  return failResult(new MovimientosApiError(code, message))
}

function ok<T>(data: T): MovimientosResult<T> {
  return okResult(data)
}

/**
 * Traduce el texto crudo de un error de Postgres/PostgREST a un código
 * y mensaje de dominio legible. El trigger trg_procesar_movimiento
 * lanza una RAISE EXCEPTION cuyo texto contiene la palabra clave
 * "insuficiente" cuando el movimiento dejaría stock negativo — este
 * es el único contrato que tenemos con la base de datos para
 * distinguir esa causa de cualquier otro fallo de Postgres.
 *
 * Si el texto exacto del mensaje cambia en una futura migración de
 * trg_procesar_movimiento, esta función debe actualizarse junto con
 * la migración para que la traducción no se desincronice en silencio.
 */
function traducirErrorMotor(mensajeCrudo: string): MovimientosApiError {
  const mensaje = mensajeCrudo.toLowerCase()

  if (mensaje.includes('insuficiente')) {
    return new MovimientosApiError(
      'STOCK_INSUFICIENTE',
      'No hay suficiente stock disponible en el origen para completar este movimiento.',
    )
  }

  if (mensaje.includes('check') || mensaje.includes('constraint')) {
    return new MovimientosApiError(
      'OPERACION_RECHAZADA',
      'La base de datos rechazó esta operación porque viola una regla de integridad del inventario.',
    )
  }

  return new MovimientosApiError(
    'ERROR_DESCONOCIDO',
    'Ocurrió un error al registrar el movimiento. Intenta de nuevo o contacta al administrador.',
  )
}

// ------------------------------------------------------------------
// 1. registrarEntradaProveedor
// ------------------------------------------------------------------

export interface DatosEntradaProveedor {
  productoId: string
  ubicacionDestinoId: string // normalmente Almacén Central
  cantidad: number
  costoUnitario: number
  numeroFactura: string
  proveedorId: string
  usuarioId: string
  /** Obligatorio si el producto tiene requiere_lote = true en el catálogo */
  numeroLote?: string
  fechaCaducidad?: string // formato 'YYYY-MM-DD'
  observacionesLote?: string
}

/**
 * Registra la recepción de mercancía de un proveedor. Esta función
 * hace DOS escrituras relacionadas cuando el producto requiere lote:
 *
 *   1. INSERT en 'lotes' — la entrada física individual, con su
 *      número de lote, costo y fecha de caducidad.
 *   2. INSERT en 'movimientos' (tipo ENTRADA_PROVEEDOR) — referenciando
 *      el lote recién creado vía lote_id, lo cual dispara el trigger
 *      que suma la cantidad a stock_ubicacion.
 *
 * Si el producto NO requiere lote (requiere_lote = false en el
 * catálogo), el paso 1 se omite y el movimiento se inserta sin
 * lote_id.
 *
 * Nota de atomicidad: estos dos INSERT no están envueltos en una
 * única transacción de base de datos desde este cliente. Si el primer
 * INSERT (lotes) se confirma y el segundo (movimientos) falla, queda
 * un lote registrado con cantidad_inicial pero sin ningún movimiento
 * que lo haya hecho visible en stock_ubicacion — un lote "fantasma"
 * que no afecta el inventario operativo pero sí aparece en el
 * catálogo de lotes. Es un riesgo menor (no genera stock incorrecto,
 * solo un registro huérfano fácil de detectar y limpiar), pero si
 * quieres atomicidad estricta también aquí, se resuelve con el mismo
 * patrón de función RPC que usa registrarTraspaso() más abajo.
 */
export async function registrarEntradaProveedor(
  datos: DatosEntradaProveedor,
): Promise<MovimientosResult<Movimiento>> {
  if (datos.cantidad <= 0) {
    return fail(
      'DATOS_INVALIDOS',
      'La cantidad recibida debe ser mayor a cero.',
    )
  }

  if (!datos.numeroFactura || datos.numeroFactura.trim().length === 0) {
    return fail(
      'DATOS_INVALIDOS',
      'El número de factura es obligatorio para registrar una entrada de proveedor.',
    )
  }

  try {
    let loteId: string | null = null

    // Paso 1: crear el lote si el producto lo requiere (numeroLote presente)
    if (datos.numeroLote) {
      const { data: lote, error: errorLote } = await supabase
        .from('lotes')
        .insert({
          producto_id: datos.productoId,
          proveedor_id: datos.proveedorId,
          numero_lote: datos.numeroLote,
          numero_factura: datos.numeroFactura,
          fecha_caducidad: datos.fechaCaducidad ?? null,
          costo_unitario: datos.costoUnitario,
          cantidad_inicial: datos.cantidad,
          estado: 'ACTIVO',
          observaciones: datos.observacionesLote ?? null,
          registrado_por: datos.usuarioId,
        })
        .select()
        .single()

      if (errorLote || !lote) {
        console.error(
          '[movimientos] registrarEntradaProveedor — error al crear lote:',
          errorLote,
        )
        return fail(
          'DATOS_INVALIDOS',
          'No se pudo registrar el lote. Verifica que el número de lote no esté duplicado para este proveedor.',
        )
      }

      loteId = lote.id
    }

    // Paso 2: registrar el movimiento de entrada — dispara el trigger
    // que suma la cantidad a stock_ubicacion.
    const { data: movimiento, error: errorMovimiento } = await supabase
      .from('movimientos')
      .insert({
        tipo: 'ENTRADA_PROVEEDOR' satisfies TipoMovimiento,
        producto_id: datos.productoId,
        lote_id: loteId,
        ubicacion_destino_id: datos.ubicacionDestinoId,
        cantidad: datos.cantidad,
        costo_snapshot: datos.costoUnitario,
        numero_factura: datos.numeroFactura,
        proveedor_id: datos.proveedorId,
        usuario_id: datos.usuarioId,
      })
      .select()
      .single()

    if (errorMovimiento || !movimiento) {
      console.error(
        '[movimientos] registrarEntradaProveedor — error en movimiento:',
        errorMovimiento,
      )
      return failResult(
        traducirErrorMotor(errorMovimiento?.message ?? ''),
      )
    }

    return ok(movimiento)
  } catch (err) {
    console.error(
      '[movimientos] registrarEntradaProveedor (excepción):',
      err,
    )
    return fail(
      'ERROR_RED',
      'No fue posible conectar con el servidor para registrar la entrada.',
    )
  }
}

// ------------------------------------------------------------------
// 2. registrarTraspaso
// ------------------------------------------------------------------

export interface DatosTraspaso {
  productoId: string
  ubicacionOrigenId: string
  ubicacionDestinoId: string
  cantidad: number
  usuarioId: string
  loteId?: string
}

/**
 * Registra un traspaso entre dos ubicaciones como una operación
 * atómica de dos filas (TRASPASO_SALIDA + TRASPASO_ENTRADA), usando
 * la función de PostgreSQL fn_registrar_traspaso vía RPC.
 *
 * IMPORTANTE — requiere desplegar esta función en una migración SQL
 * antes de que esta llamada funcione. El DDL completo está al final
 * de este archivo, como referencia, para copiar a
 * supabase/migrations/. No se incluye aquí como SQL embebido porque
 * el DDL no es responsabilidad de la capa TypeScript — vive en
 * supabase/migrations/, consistente con la estructura de carpetas
 * de docs/arquitectura.md.
 *
 * Por qué RPC y no dos .insert() encadenados desde el cliente: si la
 * conexión del cliente se interrumpe entre el primer y el segundo
 * INSERT, un traspaso de dos .insert() sueltos dejaría el producto
 * "desaparecido" — restado del origen pero nunca sumado al destino.
 * Envolver ambos INSERT dentro de una función de PostgreSQL garantiza
 * que la transacción los confirma o los revierte como una sola unidad,
 * sin depender de que el cliente complete dos round-trips de red.
 */
export async function registrarTraspaso(
  datos: DatosTraspaso,
): Promise<MovimientosResult<{ salida: Movimiento; entrada: Movimiento }>> {
  if (datos.cantidad <= 0) {
    return fail(
      'DATOS_INVALIDOS',
      'La cantidad a traspasar debe ser mayor a cero.',
    )
  }

  if (datos.ubicacionOrigenId === datos.ubicacionDestinoId) {
    return fail(
      'DATOS_INVALIDOS',
      'El origen y el destino del traspaso no pueden ser la misma ubicación.',
    )
  }

  try {
    const { data, error } = await supabase.rpc('fn_registrar_traspaso', {
      p_producto_id: datos.productoId,
      p_ubicacion_origen_id: datos.ubicacionOrigenId,
      p_ubicacion_destino_id: datos.ubicacionDestinoId,
      p_cantidad: datos.cantidad,
      p_usuario_id: datos.usuarioId,
      p_lote_id: datos.loteId ?? null,
    })

    if (error) {
      console.error('[movimientos] registrarTraspaso:', error)
      return failResult(traducirErrorMotor(error.message))
    }

    // fn_registrar_traspaso devuelve las dos filas insertadas como un
    // arreglo JSON [salida, entrada] — ver el contrato en el DDL al
    // final del archivo.
    const filas = data as unknown as [Movimiento, Movimiento]
    return ok({ salida: filas[0], entrada: filas[1] })
  } catch (err) {
    console.error('[movimientos] registrarTraspaso (excepción):', err)
    return fail(
      'ERROR_RED',
      'No fue posible conectar con el servidor para registrar el traspaso.',
    )
  }
}

// ------------------------------------------------------------------
// 3. registrarConsumo (con política PEPS/FIFO)
// ------------------------------------------------------------------

export interface DatosConsumo {
  productoId: string
  ubicacionId: string
  cantidad: number
  usuarioId: string
  /** Obligatorio solo para tipo MERMA_CADUCIDAD */
  comentario?: string
  /** Por defecto 'CONSUMO'; usar 'MERMA_CADUCIDAD' para bajas por vencimiento */
  tipo?: 'CONSUMO' | 'MERMA_CADUCIDAD'
}

interface LoteDisponible {
  id: string
  fecha_caducidad: string | null
}

/**
 * Registra una baja de inventario aplicando PEPS/FIFO: si el producto
 * requiere lote, primero se determina cuál lote consumir (el de
 * fecha_caducidad más próxima entre los que aún tienen existencia),
 * y el movimiento se registra contra ese lote específico.
 *
 * Si el producto no requiere lote, se omite la selección de lote y el
 * movimiento se inserta directamente con lote_id = null.
 *
 * NOTA SOBRE CONDICIÓN DE CARRERA: la selección de lote (paso 1) y el
 * registro del movimiento (paso 2) son dos operaciones separadas, no
 * una transacción atómica. En el volumen de operación actual de una
 * clínica universitaria (consumos espaciados, no decenas por segundo
 * sobre el mismo producto) el riesgo de que dos consumos simultáneos
 * elijan el mismo lote y lo sobre-consuman es bajo, pero existe. El
 * CHECK (cantidad_actual >= 0) en stock_ubicacion sigue protegiendo el
 * agregado total del producto incluso en ese escenario — lo que no
 * garantiza es que el lote_id elegido sea siempre el matemáticamente
 * correcto al milisegundo. Si el volumen de la clínica crece al punto
 * de que esto importe, la solución es mover este SELECT + INSERT
 * dentro de una función RPC equivalente a fn_registrar_traspaso, con
 * un SELECT ... FOR UPDATE sobre la fila del lote para bloquearla
 * durante la transacción.
 */
export async function registrarConsumo(
  datos: DatosConsumo,
): Promise<MovimientosResult<Movimiento>> {
  if (datos.cantidad <= 0) {
    return fail('DATOS_INVALIDOS', 'La cantidad a consumir debe ser mayor a cero.')
  }

  const tipo: TipoMovimiento = datos.tipo ?? 'CONSUMO'

  if (
    tipo === 'MERMA_CADUCIDAD' &&
    (!datos.comentario || datos.comentario.trim().length === 0)
  ) {
    return fail(
      'DATOS_INVALIDOS',
      'Una baja por merma de caducidad requiere un comentario de justificación.',
    )
  }

  try {
    // Paso 1: determinar si el producto requiere lote, y de ser así,
    // seleccionar el lote más próximo a vencer con stock disponible
    // (política PEPS — ver docs/arquitectura.md, sección 3.4).
    const { data: producto, error: errorProducto } = await supabase
      .from('productos')
      .select('requiere_lote')
      .eq('id', datos.productoId)
      .single()

    if (errorProducto || !producto) {
      console.error(
        '[movimientos] registrarConsumo — producto no encontrado:',
        errorProducto,
      )
      return fail('DATOS_INVALIDOS', 'El producto especificado no existe en el catálogo.')
    }

    let loteId: string | null = null

    if (producto.requiere_lote) {
      const lote = await seleccionarLotePeps(datos.productoId)

      if (!lote) {
        return fail(
          'LOTE_NO_DISPONIBLE',
          'No hay lotes activos con existencia disponible para este producto.',
        )
      }

      loteId = lote.id
    }

    // Paso 2: registrar el movimiento — dispara el trigger que resta
    // de stock_ubicacion y rechaza la operación si dejaría stock
    // negativo en esa ubicación.
    const { data: movimiento, error: errorMovimiento } = await supabase
      .from('movimientos')
      .insert({
        tipo,
        producto_id: datos.productoId,
        lote_id: loteId,
        ubicacion_origen_id: datos.ubicacionId,
        cantidad: datos.cantidad,
        comentario: datos.comentario ?? null,
        usuario_id: datos.usuarioId,
      })
      .select()
      .single()

    if (errorMovimiento || !movimiento) {
      console.error('[movimientos] registrarConsumo:', errorMovimiento)
      return failResult(traducirErrorMotor(errorMovimiento?.message ?? ''))
    }

    return ok(movimiento)
  } catch (err) {
    console.error('[movimientos] registrarConsumo (excepción):', err)
    return fail(
      'ERROR_RED',
      'No fue posible conectar con el servidor para registrar el consumo.',
    )
  }
}

/**
 * Selecciona el lote a consumir bajo política PEPS: el de fecha de
 * caducidad más próxima entre los lotes activos de este producto.
 * Los lotes sin fecha de caducidad declarada (NULL) quedan al final
 * mediante NULLS LAST, ya que no representan un riesgo de vencimiento
 * inminente frente a uno que sí la tiene.
 *
 * Esta función NO valida que el lote tenga stock numéricamente —
 * stock_ubicacion no está desglosado por lote en el esquema actual,
 * solo por ubicación. La selección PEPS aquí opera sobre el campo
 * 'estado' del lote (ACTIVO vs AGOTADO), que debe mantenerse
 * actualizado por un proceso separado (Edge Function o trigger
 * adicional) que marca un lote como AGOTADO cuando su
 * cantidad_inicial ya fue consumida en su totalidad a través del
 * historial de movimientos. Si ese mecanismo todavía no existe en tu
 * despliegue, este es el primer candidato a revisar antes de
 * confiar en producción en la selección automática de lote.
 */
async function seleccionarLotePeps(
  productoId: string,
): Promise<LoteDisponible | null> {
  const { data, error } = await supabase
    .from('lotes')
    .select('id, fecha_caducidad')
    .eq('producto_id', productoId)
    .eq('estado', 'ACTIVO')
    .order('fecha_caducidad', { ascending: true, nullsFirst: false })
    .order('fecha_entrada', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error || !data) {
    console.error('[movimientos] seleccionarLotePeps:', error)
    return null
  }

  return data
}

// ------------------------------------------------------------------
// 4. registrarSalidaPractica
// ------------------------------------------------------------------

export interface DatosSalidaPractica {
  productoId: string
  ubicacionId: string
  cantidad: number
  usuarioId: string
  /** Nombre/matrícula del alumno o referencia de bitácora — obligatorio. */
  alumnoReferencia: string
  comentario?: string
}

/**
 * Registra una baja SALIDA_PRACTICA en una farmacia (consumo de
 * alumnos/prácticas clínicas), hermana de registrarConsumo() pero como
 * función separada en vez de extender esa: registrarConsumo() ya cubre
 * CONSUMO y MERMA_CADUCIDAD con su propio contrato de validación, y no
 * queríamos arriesgar esos flujos existentes al añadirle un tercer tipo
 * con una regla de obligatoriedad distinta (alumno_referencia en vez de
 * comentario). Reutiliza la misma selección PEPS/FIFO de lote vía
 * seleccionarLotePeps() cuando el producto requiere lote — con la
 * política RLS farmacia_restringe_lotes (ver migración
 * 20260826100500), ese SELECT ya queda acotado a lotes que
 * efectivamente llegaron a la ubicación del ENCARGADO_FARMACIA que
 * llama a esta función.
 */
export async function registrarSalidaPractica(
  datos: DatosSalidaPractica,
): Promise<MovimientosResult<Movimiento>> {
  if (datos.cantidad <= 0) {
    return fail('DATOS_INVALIDOS', 'La cantidad a registrar debe ser mayor a cero.')
  }

  if (!datos.alumnoReferencia || datos.alumnoReferencia.trim().length === 0) {
    return fail(
      'DATOS_INVALIDOS',
      'Debes capturar el nombre/matrícula del alumno o una referencia de bitácora.',
    )
  }

  try {
    const { data: producto, error: errorProducto } = await supabase
      .from('productos')
      .select('requiere_lote')
      .eq('id', datos.productoId)
      .single()

    if (errorProducto || !producto) {
      console.error(
        '[movimientos] registrarSalidaPractica — producto no encontrado:',
        errorProducto,
      )
      return fail('DATOS_INVALIDOS', 'El producto especificado no existe en el catálogo.')
    }

    let loteId: string | null = null

    if (producto.requiere_lote) {
      const lote = await seleccionarLotePeps(datos.productoId)

      if (!lote) {
        return fail(
          'LOTE_NO_DISPONIBLE',
          'No hay lotes activos con existencia disponible para este producto en tu farmacia.',
        )
      }

      loteId = lote.id
    }

    const { data: movimiento, error: errorMovimiento } = await supabase
      .from('movimientos')
      .insert({
        tipo: 'SALIDA_PRACTICA' satisfies TipoMovimiento,
        producto_id: datos.productoId,
        lote_id: loteId,
        ubicacion_origen_id: datos.ubicacionId,
        cantidad: datos.cantidad,
        alumno_referencia: datos.alumnoReferencia.trim(),
        comentario: datos.comentario?.trim() || null,
        usuario_id: datos.usuarioId,
      })
      .select()
      .single()

    if (errorMovimiento || !movimiento) {
      console.error('[movimientos] registrarSalidaPractica:', errorMovimiento)
      return failResult(traducirErrorMotor(errorMovimiento?.message ?? ''))
    }

    return ok(movimiento)
  } catch (err) {
    console.error('[movimientos] registrarSalidaPractica (excepción):', err)
    return fail(
      'ERROR_RED',
      'No fue posible conectar con el servidor para registrar la salida por práctica.',
    )
  }
}

/* ====================================================================
 * DDL DE REFERENCIA — fn_registrar_traspaso
 * ====================================================================
 *
 * Esta función NO es TypeScript: es el contrato de PostgreSQL que
 * registrarTraspaso() invoca vía supabase.rpc(). Cópiala a una nueva
 * migración (ej. supabase/migrations/20240102_001_fn_registrar_traspaso.sql)
 * y despliégala antes de probar registrarTraspaso() en el frontend.
 *
 * CREATE OR REPLACE FUNCTION fn_registrar_traspaso(
 *     p_producto_id          UUID,
 *     p_ubicacion_origen_id  UUID,
 *     p_ubicacion_destino_id UUID,
 *     p_cantidad             INTEGER,
 *     p_usuario_id           UUID,
 *     p_lote_id              UUID DEFAULT NULL
 * )
 * RETURNS JSON AS $$
 * DECLARE
 *     v_salida  movimientos;
 *     v_entrada movimientos;
 * BEGIN
 *     INSERT INTO movimientos (
 *         tipo, producto_id, lote_id, ubicacion_origen_id,
 *         cantidad, usuario_id
 *     ) VALUES (
 *         'TRASPASO_SALIDA', p_producto_id, p_lote_id, p_ubicacion_origen_id,
 *         p_cantidad, p_usuario_id
 *     ) RETURNING * INTO v_salida;
 *
 *     INSERT INTO movimientos (
 *         tipo, producto_id, lote_id, ubicacion_destino_id,
 *         cantidad, usuario_id
 *     ) VALUES (
 *         'TRASPASO_ENTRADA', p_producto_id, p_lote_id, p_ubicacion_destino_id,
 *         p_cantidad, p_usuario_id
 *     ) RETURNING * INTO v_entrada;
 *
 *     -- Ambos INSERT viven en la misma transacción de PostgreSQL que
 *     -- envuelve a esta función: si el segundo INSERT falla (por
 *     -- ejemplo, por un trigger que rechace stock negativo en un
 *     -- escenario de autoconsumo en el propio origen), el primero se
 *     -- revierte automáticamente. No se requiere BEGIN/COMMIT manual.
 *
 *     RETURN json_build_array(row_to_json(v_salida), row_to_json(v_entrada));
 * END;
 * $$ LANGUAGE plpgsql SECURITY INVOKER;
 *
 * SECURITY INVOKER (no DEFINER) es deliberado: la función debe ejecutarse
 * con los privilegios del usuario que la invoca, para que las políticas
 * RLS de 'movimientos' (movimientos_insert_admin, etc.) sigan aplicándose
 * normalmente dentro de la función, en lugar de saltárselas.
 * ==================================================================== */