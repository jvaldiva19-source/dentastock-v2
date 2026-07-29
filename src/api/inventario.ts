import { supabase } from '../lib/supabase'
import { type Result, okResult, failResult } from '../lib/result'
import { obtenerTodasLasFilas } from '../lib/paginacion'
import type { StockUbicacion, TipoMovimiento, Views } from '../types/database.types'

/**
 * src/api/inventario.ts
 *
 * Capa de lectura analítica. Este módulo es exclusivamente de consulta
 * (SELECT) — no contiene ninguna función que inserte o modifique datos.
 * Toda escritura de inventario (entradas, traspasos, consumos, mermas)
 * vive en src/api/movimientos.ts, nunca aquí.
 *
 * Las tres funciones de vistas (alertas de caducidad, análisis de
 * reposición y valorización) no recalculan nada en el cliente: todo el
 * trabajo de agregación y clasificación ya ocurrió en PostgreSQL al
 * definir v_alertas_caducidad, v_analisis_reposicion y
 * v_valorizacion_inventario. Este archivo solo las consulta y las tipa.
 */

// ------------------------------------------------------------------
// Tipos de resultado y error de este dominio
// ------------------------------------------------------------------

export type InventarioErrorCode =
  | 'UBICACION_INVALIDA'
  | 'CONSULTA_FALLIDA'
  | 'ERROR_RED'
  | 'ERROR_DESCONOCIDO'

/**
 * Error de dominio propio de inventario. Se nombra InventarioApiError
 * (no AuthError ni un genérico "ApiError") para que, si algún día un
 * componente captura un error sin revisar su procedencia, el nombre de
 * la clase ya delate de qué módulo vino — útil al leer logs o stack
 * traces en producción.
 */
export class InventarioApiError extends Error {
  readonly code: InventarioErrorCode

  constructor(code: InventarioErrorCode, message: string) {
    super(message)
    this.name = 'InventarioApiError'
    this.code = code
  }
}

export type InventarioResult<T> = Result<T, InventarioApiError>

function fail(
  code: InventarioErrorCode,
  message: string,
): InventarioResult<never> {
  return failResult(new InventarioApiError(code, message))
}

function ok<T>(data: T): InventarioResult<T> {
  return okResult(data)
}

// ------------------------------------------------------------------
// 1. obtenerStockPorUbicacion
// ------------------------------------------------------------------

/**
 * Consulta las existencias físicas actuales, directamente desde la
 * tabla materializada stock_ubicacion (mantenida exclusivamente por el
 * trigger trg_procesar_movimiento — esta función nunca escribe en esa
 * tabla, solo lee su estado ya calculado).
 *
 * Sin ubicacionId trae las existencias de TODAS las ubicaciones (uso:
 * columna "Stock actual" del catálogo cuando el admin no filtró por
 * ninguna área en particular), paginado con obtenerTodasLasFilas() por
 * la misma razón que obtenerProductos().
 *
 * Un arreglo vacío es un resultado válido (un área recién creada sin
 * traspasos todavía no tiene filas en stock_ubicacion) y NO se trata
 * como error.
 */
export async function obtenerStockPorUbicacion(
  ubicacionId?: string,
): Promise<InventarioResult<StockUbicacion[]>> {
  try {
    const { data, error } = await obtenerTodasLasFilas((desde, hasta) => {
      let consulta = supabase.from('stock_ubicacion').select('*')
      if (ubicacionId) {
        consulta = consulta.eq('ubicacion_id', ubicacionId)
      }
      return consulta.order('ultima_actualizacion', { ascending: false }).range(desde, hasta)
    })

    if (error) {
      console.error('[inventario] obtenerStockPorUbicacion:', error)
      return fail(
        'CONSULTA_FALLIDA',
        'No se pudo consultar el stock de esta ubicación. Intenta de nuevo.',
      )
    }

    return ok(data ?? [])
  } catch (err) {
    console.error('[inventario] obtenerStockPorUbicacion (excepción):', err)
    return fail(
      'ERROR_RED',
      'No fue posible conectar con el servidor para consultar el stock.',
    )
  }
}

// ------------------------------------------------------------------
// 2. obtenerAlertasCaducidad
// ------------------------------------------------------------------

/**
 * Consulta v_alertas_caducidad: el semáforo de días restantes para
 * vencimiento de lotes activos, base del control de trazabilidad
 * COFEPRIS descrito en docs/arquitectura.md (sección 3.3).
 *
 * Se ordena por dias_restantes ascendente para que el panel siempre
 * muestre primero los lotes más urgentes — incluyendo los que ya
 * vencieron, donde dias_restantes es negativo y por tanto quedan al
 * principio de la lista de forma natural.
 */
export async function obtenerAlertasCaducidad(): Promise<
  InventarioResult<Views<'v_alertas_caducidad'>[]>
> {
  try {
    const { data, error } = await obtenerTodasLasFilas((desde, hasta) =>
      supabase
        .from('v_alertas_caducidad')
        .select('*')
        .order('dias_restantes', { ascending: true })
        .range(desde, hasta),
    )

    if (error) {
      console.error('[inventario] obtenerAlertasCaducidad:', error)
      return fail(
        'CONSULTA_FALLIDA',
        'No se pudo consultar las alertas de caducidad. Intenta de nuevo.',
      )
    }

    return ok(data ?? [])
  } catch (err) {
    console.error('[inventario] obtenerAlertasCaducidad (excepción):', err)
    return fail(
      'ERROR_RED',
      'No fue posible conectar con el servidor para consultar caducidades.',
    )
  }
}

// ------------------------------------------------------------------
// 3. obtenerAnalisisReposicion
// ------------------------------------------------------------------

/**
 * Consulta v_analisis_reposicion para identificar qué productos ya
 * alcanzaron su punto de reorden o están en rotura de stock.
 *
 * Nombre de columna y literales confirmados contra la vista real
 * desplegada en Supabase: la columna es 'estado_logistico', no
 * 'estado_alerta', y sus valores de alerta son las cadenas exactas
 * 'REQUERIR COMPRA (PUNTO REORDEN)' y 'ROTURA DE STOCK / CRÍTICO'
 * (con tilde y diagonal incluidos — deben coincidir carácter por
 * carácter con lo que devuelve PostgreSQL, o el filtro .in() de abajo
 * no encontrará ninguna coincidencia).
 */
export async function obtenerAnalisisReposicion(): Promise<
  InventarioResult<Views<'v_analisis_reposicion'>[]>
> {
  try {
    const { data, error } = await obtenerTodasLasFilas((desde, hasta) =>
      supabase
        .from('v_analisis_reposicion')
        .select('*')
        .in('estado_logistico', [
          'REQUERIR COMPRA (PUNTO REORDEN)',
          'ROTURA DE STOCK / CRÍTICO',
        ])
        .order('cantidad_actual', { ascending: true })
        .range(desde, hasta),
    )

    if (error) {
      console.error('[inventario] obtenerAnalisisReposicion:', error)
      return fail(
        'CONSULTA_FALLIDA',
        'No se pudo consultar el análisis de reposición. Intenta de nuevo.',
      )
    }

    return ok(data ?? [])
  } catch (err) {
    console.error('[inventario] obtenerAnalisisReposicion (excepción):', err)
    return fail(
      'ERROR_RED',
      'No fue posible conectar con el servidor para consultar reposición.',
    )
  }
}

// ------------------------------------------------------------------
// 4. obtenerValorizacionInventario
// ------------------------------------------------------------------

/**
 * Consulta v_valorizacion_inventario: el valor financiero del stock
 * actual, calculado lote por lote (cantidad_actual × costo_unitario de
 * CADA lote del producto, sumado entre lotes) y con precio_sin_iva
 * como respaldo solo si el producto no tiene ningún lote activo con
 * costo registrado. Desglosado por ubicación. Es la fuente directa
 * para las conciliaciones contables mensuales y para el Reporte de
 * Contraloría.
 *
 * Corregido el 2026-07-22 en dos pasos (ver supabase/migrations/
 * 20260722120000_add_lotes_cantidad_actual_y_registros_ds1583_ds1585.sql
 * y 20260722120100_fix_valorizacion_inventario_por_lote.sql): la vista
 * valoraba antes al precio de venta con IVA (precio_con_iva), y un
 * primer intento de corrección promedió el costo por producto en vez
 * de respetar que un mismo producto puede tener lotes con costo y
 * unidad de medida distintos (caja completa vs. pieza suelta).
 *
 * cantidad_actual y precio_unitario en esta vista quedan como una
 * cifra combinada entre lotes (útil para mostrar en una sola fila por
 * producto), no como un dato preciso por unidad de medida cuando un
 * producto mezcla lotes en distintas presentaciones — valor_total sí
 * es exacto. Para el detalle por lote, consultar la tabla lotes
 * directamente.
 *
 * Se ordena por área y luego por concepto para que el resultado sea
 * directamente exportable a Excel sin necesidad de reordenar en el
 * cliente.
 */
export async function obtenerValorizacionInventario(): Promise<
  InventarioResult<Views<'v_valorizacion_inventario'>[]>
> {
  try {
    const { data, error } = await obtenerTodasLasFilas((desde, hasta) =>
      supabase
        .from('v_valorizacion_inventario')
        .select('*')
        .order('area', { ascending: true })
        .order('concepto', { ascending: true })
        .range(desde, hasta),
    )

    if (error) {
      console.error('[inventario] obtenerValorizacionInventario:', error)
      return fail(
        'CONSULTA_FALLIDA',
        'No se pudo consultar la valorización del inventario. Intenta de nuevo.',
      )
    }

    return ok(data ?? [])
  } catch (err) {
    console.error(
      '[inventario] obtenerValorizacionInventario (excepción):',
      err,
    )
    return fail(
      'ERROR_RED',
      'No fue posible conectar con el servidor para consultar la valorización.',
    )
  }
}

// ------------------------------------------------------------------
// 5. obtenerMovimientosRecientes
// ------------------------------------------------------------------

export interface MovimientoReciente {
  id: string
  tipo: TipoMovimiento
  cantidad: number
  fecha: string
  producto: string
  codigoBarras: string | null
  ubicacionOrigen: string | null
  ubicacionDestino: string | null
  usuario: string
}

/**
 * Forma cruda que devuelve PostgREST con los recursos embebidos, igual
 * que FilaMovimientoCrudo en reportes.ts — se declara explícitamente en
 * vez de usar 'any' porque los alias personalizados de las FKs de
 * ubicacion_origen_id / ubicacion_destino_id no siempre se infieren con
 * precisión desde los tipos genéricos de supabase-js.
 */
interface FilaMovimientoRecienteCruda {
  id: string
  tipo: TipoMovimiento
  cantidad: number
  created_at: string
  producto: { concepto: string; codigo_barras: string } | null
  origen: { nombre: string } | null
  destino: { nombre: string } | null
  usuario: { nombre_usuario: string } | null
}

/**
 * Trae los movimientos más recientes de todo el sistema (entradas,
 * traspasos y consumos/mermas mezclados, sin filtrar por tipo), en
 * orden cronológico descendente. Es la fuente inicial del historial en
 * vivo del Dashboard: DashboardScreen la vuelve a invocar cada vez que
 * la suscripción postgres_changes sobre 'movimientos' recibe un INSERT,
 * para mantener el listado sincronizado con la base de datos en tiempo
 * real.
 */
export async function obtenerMovimientosRecientes(
  limite = 15,
): Promise<InventarioResult<MovimientoReciente[]>> {
  try {
    const { data, error } = await supabase
      .from('movimientos')
      .select(
        `id, tipo, cantidad, created_at,
         producto:productos(concepto, codigo_barras),
         origen:ubicaciones!movimientos_ubicacion_origen_id_fkey(nombre),
         destino:ubicaciones!movimientos_ubicacion_destino_id_fkey(nombre),
         usuario:usuarios(nombre_usuario)`,
      )
      .order('created_at', { ascending: false })
      .limit(limite)

    if (error) {
      console.error('[inventario] obtenerMovimientosRecientes:', error)
      return fail(
        'CONSULTA_FALLIDA',
        'No se pudo consultar el historial reciente de movimientos. Intenta de nuevo.',
      )
    }

    const filasCrudas = (data ?? []) as unknown as FilaMovimientoRecienteCruda[]

    const filas: MovimientoReciente[] = filasCrudas.map((mov) => ({
      id: mov.id,
      tipo: mov.tipo,
      cantidad: mov.cantidad,
      fecha: mov.created_at,
      producto: mov.producto?.concepto ?? 'Producto desconocido',
      codigoBarras: mov.producto?.codigo_barras ?? null,
      ubicacionOrigen: mov.origen?.nombre ?? null,
      ubicacionDestino: mov.destino?.nombre ?? null,
      usuario: mov.usuario?.nombre_usuario ?? 'Usuario desconocido',
    }))

    return ok(filas)
  } catch (err) {
    console.error('[inventario] obtenerMovimientosRecientes (excepción):', err)
    return fail(
      'ERROR_RED',
      'No fue posible conectar con el servidor para consultar el historial de movimientos.',
    )
  }
}