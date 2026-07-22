import { supabase } from '../lib/supabase'
import { type Result, okResult, failResult } from '../lib/result'
import { obtenerTodasLasFilas } from '../lib/paginacion'
import type { TipoMovimiento } from '../types/database.types'

/**
 * src/api/reportes.ts
 *
 * Capa de consultas analíticas pesadas. Es de solo lectura — ninguna
 * función de este archivo inserta, actualiza ni elimina nada. Su
 * único propósito es entregar arreglos ya ordenados y listos para que
 * src/lib/excel.ts (SheetJS) los escriba directamente como filas de
 * una hoja de cálculo, sin que el componente de React tenga que
 * reordenar ni reformatear nada antes de exportar.
 *
 * Decisión de alcance importante: este módulo NO asume la existencia
 * de ninguna vista o función SQL adicional a las ya confirmadas en el
 * checkpoint (v_alertas_caducidad, v_analisis_reposicion,
 * v_valorizacion_inventario). Las agregaciones de obtenerConsumoPorAreas()
 * y obtenerResumenAuditoria() se calculan en TypeScript después de leer
 * filas crudas de 'movimientos' y de las vistas existentes, en lugar de
 * depender de un GROUP BY o una vista nueva en PostgreSQL. Si el volumen
 * de movimientos de la clínica crece lo suficiente para que esto importe
 * en rendimiento, el candidato natural de optimización es mover esa
 * agregación a una vista o función RPC — pero eso es un cambio de
 * esquema que se decide y se autoriza explícitamente, no algo que este
 * archivo debe asumir por su cuenta.
 */

// ------------------------------------------------------------------
// Tipos de resultado y error de este dominio
// ------------------------------------------------------------------

export type ReportesErrorCode =
  | 'DATOS_INVALIDOS'
  | 'CONSULTA_FALLIDA'
  | 'ERROR_RED'
  | 'ERROR_DESCONOCIDO'

export class ReportesApiError extends Error {
  readonly code: ReportesErrorCode

  constructor(code: ReportesErrorCode, message: string) {
    super(message)
    this.name = 'ReportesApiError'
    this.code = code
  }
}

export type ReportesResult<T> = Result<T, ReportesApiError>

function fail(code: ReportesErrorCode, message: string): ReportesResult<never> {
  return failResult(new ReportesApiError(code, message))
}

function ok<T>(data: T): ReportesResult<T> {
  return okResult(data)
}

// ------------------------------------------------------------------
// Helpers de fecha — mismo criterio que usaba la versión anterior del
// sistema al filtrar el historial: una fecha "desnuda" (YYYY-MM-DD) sin
// componente de hora se interpreta como el inicio o el final completo
// de ese día, para que el usuario no tenga que escribir la hora a mano
// y para que "Hasta: 2026-06-17" incluya todo ese día, no solo su
// medianoche.
// ------------------------------------------------------------------

function normalizarInicioDeDia(fecha: string): string {
  return fecha.length === 10 ? `${fecha}T00:00:00.000` : fecha
}

function normalizarFinDeDia(fecha: string): string {
  return fecha.length === 10 ? `${fecha}T23:59:59.999` : fecha
}

// ------------------------------------------------------------------
// 1. obtenerKardexProducto
// ------------------------------------------------------------------

/**
 * Determina el impacto de cada tipo de movimiento sobre el STOCK
 * TOTAL DEL SISTEMA (la suma del producto en todas las ubicaciones),
 * no sobre una ubicación individual:
 *
 *   +1  ENTRADA_PROVEEDOR, AJUSTE_POSITIVO    — el total del sistema crece
 *   -1  CONSUMO, MERMA_CADUCIDAD,
 *       AJUSTE_NEGATIVO, DEVOLUCION_PROVEEDOR — el total del sistema decrece
 *    0  TRASPASO_SALIDA, TRASPASO_ENTRADA     — solo reubica, no cambia el total
 *
 * Esta es una decisión de diseño deliberada: un traspaso entre Almacén
 * Central y una farmacia no debería hacer que el saldo acumulado del
 * kardex "caiga y se recupere" entre dos filas consecutivas, cuando en
 * los hechos el inventario total de la clínica nunca cambió en ese
 * instante — solo cambió de ubicación. Las columnas ubicacionOrigen /
 * ubicacionDestino de cada fila siguen mostrando el movimiento físico
 * completo para fines de auditoría, aunque no muevan el saldo global.
 */
function calcularSignoMovimiento(tipo: TipoMovimiento): -1 | 0 | 1 {
  switch (tipo) {
    case 'ENTRADA_PROVEEDOR':
    case 'AJUSTE_POSITIVO':
      return 1
    case 'CONSUMO':
    case 'MERMA_CADUCIDAD':
    case 'AJUSTE_NEGATIVO':
    case 'DEVOLUCION_PROVEEDOR':
      return -1
    case 'TRASPASO_SALIDA':
    case 'TRASPASO_ENTRADA':
      return 0
    default:
      return 0
  }
}

export interface FilaKardex {
  fecha: string
  tipo: TipoMovimiento
  cantidad: number
  signoImpactoGlobal: -1 | 0 | 1
  saldoAcumuladoGlobal: number
  costoUnitario: number | null
  valorMovimiento: number | null
  ubicacionOrigen: string | null
  ubicacionDestino: string | null
  usuario: string
  numeroLote: string | null
  fechaCaducidadLote: string | null
  numeroFactura: string | null
  comentario: string | null
}

/**
 * Forma cruda que devuelve PostgREST con los recursos embebidos antes
 * de mapearla a FilaKardex. Se declara explícitamente (en vez de usar
 * 'any') porque las relaciones anidadas con alias personalizado —
 * origen / destino apuntando ambas a 'ubicaciones' mediante FKs
 * distintas — no siempre se infieren con precisión total desde los
 * tipos genéricos de supabase-js, igual que en
 * catalogo.ts/ProductoConCategoria.
 */
interface FilaMovimientoCrudo {
  id: string
  tipo: TipoMovimiento
  cantidad: number
  costo_snapshot: number | null
  numero_factura: string | null
  comentario: string | null
  created_at: string
  usuario: { nombre_usuario: string } | null
  origen: { nombre: string } | null
  destino: { nombre: string } | null
  lote: { numero_lote: string; fecha_caducidad: string | null } | null
}

/**
 * Kardex cronológico de un producto: el historial completo de
 * movimientos que lo afectaron, con saldo acumulado a nivel sistema
 * calculado fila por fila. Pensado para responder, en una auditoría,
 * exactamente cómo se llegó al stock actual de un insumo.
 *
 * fechaInicio / fechaFin son opcionales — sin ellas, se devuelve el
 * historial completo del producto desde su primer movimiento.
 */
export async function obtenerKardexProducto(
  productoId: string,
  fechaInicio?: string,
  fechaFin?: string,
): Promise<ReportesResult<FilaKardex[]>> {
  if (!productoId || productoId.trim().length === 0) {
    return fail(
      'DATOS_INVALIDOS',
      'Debes especificar un producto para generar su kardex.',
    )
  }

  try {
    let consulta = supabase
      .from('movimientos')
      .select(
        `id, tipo, cantidad, costo_snapshot, numero_factura, comentario, created_at,
         usuario:usuarios(nombre_usuario),
         origen:ubicaciones!movimientos_ubicacion_origen_id_fkey(nombre),
         destino:ubicaciones!movimientos_ubicacion_destino_id_fkey(nombre),
         lote:lotes(numero_lote, fecha_caducidad)`,
      )
      .eq('producto_id', productoId)
      .order('created_at', { ascending: true })

    if (fechaInicio) {
      consulta = consulta.gte('created_at', normalizarInicioDeDia(fechaInicio))
    }
    if (fechaFin) {
      consulta = consulta.lte('created_at', normalizarFinDeDia(fechaFin))
    }

    const { data, error } = await consulta

    if (error) {
      console.error('[reportes] obtenerKardexProducto:', error)
      return fail(
        'CONSULTA_FALLIDA',
        'No se pudo generar el kardex de este producto. Intenta de nuevo.',
      )
    }

    const filasCrudas = (data ?? []) as unknown as FilaMovimientoCrudo[]

    let saldoAcumulado = 0
    const filas: FilaKardex[] = filasCrudas.map((mov) => {
      const signo = calcularSignoMovimiento(mov.tipo)
      saldoAcumulado += signo * mov.cantidad

      return {
        fecha: mov.created_at,
        tipo: mov.tipo,
        cantidad: mov.cantidad,
        signoImpactoGlobal: signo,
        saldoAcumuladoGlobal: saldoAcumulado,
        costoUnitario: mov.costo_snapshot,
        valorMovimiento:
          mov.costo_snapshot != null ? mov.costo_snapshot * mov.cantidad : null,
        ubicacionOrigen: mov.origen?.nombre ?? null,
        ubicacionDestino: mov.destino?.nombre ?? null,
        usuario: mov.usuario?.nombre_usuario ?? 'Usuario desconocido',
        numeroLote: mov.lote?.numero_lote ?? null,
        fechaCaducidadLote: mov.lote?.fecha_caducidad ?? null,
        numeroFactura: mov.numero_factura,
        comentario: mov.comentario,
      }
    })

    return ok(filas)
  } catch (err) {
    console.error('[reportes] obtenerKardexProducto (excepción):', err)
    return fail(
      'ERROR_RED',
      'No fue posible conectar con el servidor para generar el kardex.',
    )
  }
}

// ------------------------------------------------------------------
// 2. obtenerConsumoPorAreas
// ------------------------------------------------------------------

export interface FilaConsumoPorArea {
  ubicacion: string
  tipo: 'CONSUMO' | 'MERMA_CADUCIDAD'
  cantidadTotal: number
  valorTotal: number
}

interface FilaConsumoCruda {
  tipo: 'CONSUMO' | 'MERMA_CADUCIDAD'
  cantidad: number
  costo_snapshot: number | null
  origen: { nombre: string } | null
}

/**
 * Agrega mermas y consumos por ubicación de origen dentro de un rango
 * de fechas, separando ambos tipos de movimiento en filas distintas
 * (un mismo área puede tener, por ejemplo, $1,200 en consumo normal y
 * $300 en merma por caducidad — mezclar ambos números ocultaría
 * precisamente la métrica que el control de costos necesita ver por
 * separado: cuánto se perdió por mal manejo de caducidades frente a
 * cuánto se usó legítimamente en atención clínica).
 *
 * El arreglo final se ordena por valorTotal descendente, para que el
 * área/tipo de mayor impacto económico aparezca primero — el criterio
 * más útil para una revisión mensual de costos.
 */
export async function obtenerConsumoPorAreas(
  fechaInicio: string,
  fechaFin: string,
): Promise<ReportesResult<FilaConsumoPorArea[]>> {
  if (!fechaInicio || !fechaFin) {
    return fail(
      'DATOS_INVALIDOS',
      'Debes especificar el rango de fechas (inicio y fin) a consultar.',
    )
  }

  try {
    const { data, error } = await supabase
      .from('movimientos')
      .select(
        `tipo, cantidad, costo_snapshot,
         origen:ubicaciones!movimientos_ubicacion_origen_id_fkey(nombre)`,
      )
      .in('tipo', ['CONSUMO', 'MERMA_CADUCIDAD'])
      .gte('created_at', normalizarInicioDeDia(fechaInicio))
      .lte('created_at', normalizarFinDeDia(fechaFin))

    if (error) {
      console.error('[reportes] obtenerConsumoPorAreas:', error)
      return fail(
        'CONSULTA_FALLIDA',
        'No se pudo generar el reporte de consumo por áreas. Intenta de nuevo.',
      )
    }

    const filasCrudas = (data ?? []) as unknown as FilaConsumoCruda[]
    const acumulador = new Map<string, FilaConsumoPorArea>()

    for (const fila of filasCrudas) {
      const ubicacion = fila.origen?.nombre ?? 'Ubicación desconocida'
      const llave = `${ubicacion}|${fila.tipo}`
      const valorFila = fila.cantidad * (fila.costo_snapshot ?? 0)

      const existente = acumulador.get(llave)
      if (existente) {
        existente.cantidadTotal += fila.cantidad
        existente.valorTotal += valorFila
      } else {
        acumulador.set(llave, {
          ubicacion,
          tipo: fila.tipo,
          cantidadTotal: fila.cantidad,
          valorTotal: valorFila,
        })
      }
    }

    const resultado = Array.from(acumulador.values()).sort(
      (a, b) => b.valorTotal - a.valorTotal,
    )

    return ok(resultado)
  } catch (err) {
    console.error('[reportes] obtenerConsumoPorAreas (excepción):', err)
    return fail(
      'ERROR_RED',
      'No fue posible conectar con el servidor para generar el reporte de consumo.',
    )
  }
}

// ------------------------------------------------------------------
// 3. obtenerResumenAuditoria
// ------------------------------------------------------------------

export interface ResumenAuditoria {
  totalProductosActivos: number
  valorTotalInventario: number
  lotesVencidos: number
  lotesPorVencerEn30Dias: number
  productosEnPuntoReorden: number
  productosEnRoturaStock: number
  fechaGeneracion: string
}

/**
 * Consolida las métricas clave de salud del inventario en una sola
 * lectura, combinando las tres vistas analíticas confirmadas más un
 * conteo directo de productos activos. Las cuatro consultas se
 * disparan en paralelo con Promise.all — no dependen entre sí — para
 * minimizar la latencia total de este reporte.
 *
 * Es deliberadamente todo-o-nada: si cualquiera de las cuatro
 * consultas falla, la función completa retorna error en vez de un
 * resumen parcial. Un resumen de auditoría con un número faltante
 * (por ejemplo, sin poder confirmar el valor total del inventario) es
 * peor que no tener resumen — podría leerse como "$0 en riesgo" en
 * lugar de "dato no disponible".
 *
 * Las tres consultas de vistas se paginan con obtenerTodasLasFilas()
 * porque PostgREST trunca a 1000 filas por defecto: con 1,778 productos
 * en catálogo, sumar valorTotalInventario sobre una respuesta truncada
 * subestimaría el valor real del almacén en vez de reflejar el total
 * completo. El conteo de productosRes no necesita paginarse porque usa
 * { count: 'exact', head: true } — Postgres calcula el conteo exacto
 * en el servidor sin devolver filas, así que nunca queda sujeto al
 * límite de 1000 que sí aplica a las respuestas con datos.
 */
export async function obtenerResumenAuditoria(): Promise<
  ReportesResult<ResumenAuditoria>
> {
  try {
    const [productosRes, valorizacionRes, caducidadRes, reposicionRes] =
      await Promise.all([
        supabase
          .from('productos')
          .select('id', { count: 'exact', head: true })
          .eq('activo', true),
        obtenerTodasLasFilas((desde, hasta) =>
          supabase
            .from('v_valorizacion_inventario')
            .select('valor_total')
            .range(desde, hasta),
        ),
        obtenerTodasLasFilas((desde, hasta) =>
          supabase
            .from('v_alertas_caducidad')
            .select('dias_restantes')
            .range(desde, hasta),
        ),
        obtenerTodasLasFilas((desde, hasta) =>
          supabase
            .from('v_analisis_reposicion')
            .select('estado_logistico')
            .range(desde, hasta),
        ),
      ])

    if (
      productosRes.error ||
      valorizacionRes.error ||
      caducidadRes.error ||
      reposicionRes.error
    ) {
      console.error('[reportes] obtenerResumenAuditoria:', {
        productos: productosRes.error,
        valorizacion: valorizacionRes.error,
        caducidad: caducidadRes.error,
        reposicion: reposicionRes.error,
      })
      return fail(
        'CONSULTA_FALLIDA',
        'No se pudo generar el resumen de auditoría completo. Intenta de nuevo.',
      )
    }

    const valorTotalInventario = (valorizacionRes.data ?? []).reduce(
      (acumulado, fila) => acumulado + (fila.valor_total ?? 0),
      0,
    )

    const lotesVencidos = (caducidadRes.data ?? []).filter(
      (fila) => (fila.dias_restantes ?? 0) < 0,
    ).length

    const lotesPorVencerEn30Dias = (caducidadRes.data ?? []).filter(
      (fila) =>
        (fila.dias_restantes ?? -1) >= 0 && (fila.dias_restantes ?? -1) <= 30,
    ).length

    const productosEnPuntoReorden = (reposicionRes.data ?? []).filter(
      (fila) => fila.estado_logistico === 'REQUERIR COMPRA (PUNTO REORDEN)',
    ).length

    const productosEnRoturaStock = (reposicionRes.data ?? []).filter(
      (fila) => fila.estado_logistico === 'ROTURA DE STOCK / CRÍTICO',
    ).length

    return ok({
      totalProductosActivos: productosRes.count ?? 0,
      valorTotalInventario,
      lotesVencidos,
      lotesPorVencerEn30Dias,
      productosEnPuntoReorden,
      productosEnRoturaStock,
      fechaGeneracion: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[reportes] obtenerResumenAuditoria (excepción):', err)
    return fail(
      'ERROR_RED',
      'No fue posible conectar con el servidor para generar el resumen de auditoría.',
    )
  }
}