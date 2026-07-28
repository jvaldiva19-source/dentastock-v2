import { supabase } from '../lib/supabase'
import { type Result, okResult, failResult } from '../lib/result'
import { obtenerTodasLasFilas } from '../lib/paginacion'
import { obtenerUbicaciones } from './catalogo'
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
// Filtros compartidos de la pestaña Analítica del Dashboard
// ------------------------------------------------------------------

/**
 * Forma común de filtro para las tres consultas que alimentan
 * PanelAnalitica (flujo de movimientos, consumo por áreas y métricas
 * por personal). productoId / ubicacionId / usuarioId son opcionales:
 * ausentes u undefined significa "todos" — el mismo criterio que ya
 * usa ComboboxProducto (value === '' equivale a sin selección).
 *
 * ubicacionId filtra movimientos donde el área participa como ORIGEN
 * O como DESTINO (un traspaso hacia una farmacia y un consumo hecho
 * desde ella son ambos "actividad de esa ubicación"), a diferencia de
 * obtenerConsumoPorAreas() en su forma original, que solo miraba el
 * origen porque su alcance era estrictamente salidas.
 */
export interface FiltroAnalitico {
  fechaInicio: string
  fechaFin: string
  productoId?: string
  ubicacionId?: string
  usuarioId?: string
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
 *
 * `filtros` es opcional y aditivo: productoId/usuarioId/ubicacionId
 * (sobre el origen) acotan más la misma consulta — se agregó para que
 * PanelAnalitica pueda reutilizar esta función bajo sus filtros
 * globales sin duplicar la lógica de agregación.
 */
export async function obtenerConsumoPorAreas(
  fechaInicio: string,
  fechaFin: string,
  filtros?: Pick<FiltroAnalitico, 'productoId' | 'usuarioId' | 'ubicacionId'>,
): Promise<ReportesResult<FilaConsumoPorArea[]>> {
  if (!fechaInicio || !fechaFin) {
    return fail(
      'DATOS_INVALIDOS',
      'Debes especificar el rango de fechas (inicio y fin) a consultar.',
    )
  }

  try {
    let consulta = supabase
      .from('movimientos')
      .select(
        `tipo, cantidad, costo_snapshot,
         origen:ubicaciones!movimientos_ubicacion_origen_id_fkey(nombre)`,
      )
      .in('tipo', ['CONSUMO', 'MERMA_CADUCIDAD'])
      .gte('created_at', normalizarInicioDeDia(fechaInicio))
      .lte('created_at', normalizarFinDeDia(fechaFin))

    if (filtros?.productoId) {
      consulta = consulta.eq('producto_id', filtros.productoId)
    }
    if (filtros?.usuarioId) {
      consulta = consulta.eq('usuario_id', filtros.usuarioId)
    }
    if (filtros?.ubicacionId) {
      consulta = consulta.eq('ubicacion_origen_id', filtros.ubicacionId)
    }

    const { data, error } = await consulta

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
// 3. obtenerFlujoFinancieroPorArea
// ------------------------------------------------------------------

export interface FilaFlujoFinancieroArea {
  ubicacionId: string
  area: string
  anio: number
  /** 1-12 */
  mes: number
  entrada: number
  salida: number
}

interface FilaFlujoFinancieroCruda {
  tipo: TipoMovimiento
  cantidad: number
  costo_snapshot: number | null
  ubicacion_origen_id: string | null
  ubicacion_destino_id: string | null
  created_at: string
}

const TIPOS_ENTRADA_AREA: TipoMovimiento[] = [
  'TRASPASO_ENTRADA',
  'AJUSTE_POSITIVO',
  'ENTRADA_PROVEEDOR',
]
const TIPOS_SALIDA_AREA: TipoMovimiento[] = [
  'CONSUMO',
  'MERMA_CADUCIDAD',
  'AJUSTE_NEGATIVO',
  'DEVOLUCION_PROVEEDOR',
  'TRASPASO_SALIDA',
]

/**
 * Alimenta la tabla dinámica CONCEPTO/ÁREA · MES · ENTRADA · SALIDA
 * del Reporte de Finanzas (src/services/excelService.ts). Solo
 * considera 'ubicaciones' con es_destino_final = true — el campo ya
 * existente en el esquema que distingue un área clínica de consumo
 * (Endodoncia, Ortodoncia, etc.) de Almacén Central o una farmacia
 * intermedia, exactamente el mismo universo de "áreas" que aparece en
 * la plantilla de referencia.
 *
 * ENTRADA de un área = valor de lo que llegó a ella (traspasos
 * recibidos o ajustes positivos registrados ahí). SALIDA = valor de lo
 * que salió de ella (consumo clínico, merma, ajuste negativo,
 * devolución a proveedor o traspaso de regreso a otra ubicación). Esto
 * siempre cuadra en el sistema completo: el traspaso que es "salida"
 * para el área origen es "entrada" para el área destino.
 *
 * Devuelve solo las combinaciones (área, año, mes) con movimientos
 * reales — excelService.ts es responsable de rellenar con ceros los
 * meses/áreas sin actividad dentro del rango, para que la tabla final
 * tenga una fila por cada combinación exigida por el reporte
 * institucional, no solo las que tuvieron movimiento.
 */
export async function obtenerFlujoFinancieroPorArea(
  fechaInicio: string,
  fechaFin: string,
): Promise<ReportesResult<FilaFlujoFinancieroArea[]>> {
  if (!fechaInicio || !fechaFin) {
    return fail(
      'DATOS_INVALIDOS',
      'Debes especificar el rango de fechas (inicio y fin) a consultar.',
    )
  }

  try {
    const ubicacionesRes = await obtenerUbicaciones()
    if (!ubicacionesRes.success) {
      console.error('[reportes] obtenerFlujoFinancieroPorArea (ubicaciones):', ubicacionesRes.error)
      return fail(
        'CONSULTA_FALLIDA',
        'No se pudo consultar las áreas activas para el reporte de finanzas.',
      )
    }

    const areasDestinoFinal = new Map(
      ubicacionesRes.data
        .filter((u) => u.es_destino_final)
        .map((u) => [u.id, u.nombre] as const),
    )

    if (areasDestinoFinal.size === 0) {
      return ok([])
    }

    const { data, error } = await supabase
      .from('movimientos')
      .select('tipo, cantidad, costo_snapshot, ubicacion_origen_id, ubicacion_destino_id, created_at')
      .in('tipo', [...TIPOS_ENTRADA_AREA, ...TIPOS_SALIDA_AREA])
      .gte('created_at', normalizarInicioDeDia(fechaInicio))
      .lte('created_at', normalizarFinDeDia(fechaFin))

    if (error) {
      console.error('[reportes] obtenerFlujoFinancieroPorArea:', error)
      return fail(
        'CONSULTA_FALLIDA',
        'No se pudo generar el flujo financiero por área. Intenta de nuevo.',
      )
    }

    const filasCrudas = (data ?? []) as unknown as FilaFlujoFinancieroCruda[]
    const acumulador = new Map<string, FilaFlujoFinancieroArea>()

    function acumular(ubicacionId: string, anio: number, mes: number, entrada: number, salida: number) {
      const area = areasDestinoFinal.get(ubicacionId)
      if (!area) return // La ubicación no es un área de destino final (ej. Almacén Central)

      const llave = `${ubicacionId}|${anio}|${mes}`
      const existente = acumulador.get(llave) ?? { ubicacionId, area, anio, mes, entrada: 0, salida: 0 }
      existente.entrada += entrada
      existente.salida += salida
      acumulador.set(llave, existente)
    }

    for (const fila of filasCrudas) {
      const fecha = new Date(fila.created_at)
      const anio = fecha.getFullYear()
      const mes = fecha.getMonth() + 1
      const valor = fila.cantidad * (fila.costo_snapshot ?? 0)

      if (TIPOS_ENTRADA_AREA.includes(fila.tipo) && fila.ubicacion_destino_id) {
        acumular(fila.ubicacion_destino_id, anio, mes, valor, 0)
      }
      if (TIPOS_SALIDA_AREA.includes(fila.tipo) && fila.ubicacion_origen_id) {
        acumular(fila.ubicacion_origen_id, anio, mes, 0, valor)
      }
    }

    const resultado = Array.from(acumulador.values()).sort((a, b) =>
      a.anio !== b.anio ? a.anio - b.anio : a.mes !== b.mes ? a.mes - b.mes : a.area.localeCompare(b.area),
    )

    return ok(resultado)
  } catch (err) {
    console.error('[reportes] obtenerFlujoFinancieroPorArea (excepción):', err)
    return fail(
      'ERROR_RED',
      'No fue posible conectar con el servidor para generar el flujo financiero por área.',
    )
  }
}

// ------------------------------------------------------------------
// 4. obtenerFlujoMovimientos
// ------------------------------------------------------------------

export interface FilaFlujoMovimiento {
  /** 'YYYY-MM-DD' si el rango es corto, 'YYYY-MM' si excede ~60 días */
  periodo: string
  entradas: number
  salidas: number
}

interface FilaFlujoCruda {
  tipo: TipoMovimiento
  cantidad: number
  producto_id: string
  usuario_id: string
  ubicacion_origen_id: string | null
  ubicacion_destino_id: string | null
  created_at: string
}

const TIPOS_ENTRADA_SISTEMA: TipoMovimiento[] = ['ENTRADA_PROVEEDOR', 'AJUSTE_POSITIVO']
const TIPOS_SALIDA_SISTEMA: TipoMovimiento[] = [
  'CONSUMO',
  'MERMA_CADUCIDAD',
  'AJUSTE_NEGATIVO',
  'DEVOLUCION_PROVEEDOR',
]

/** Milisegundos en un día, usado para decidir el tamaño del bucket de agregación. */
const UN_DIA_MS = 24 * 60 * 60 * 1000
const UMBRAL_BUCKET_MENSUAL_DIAS = 60

/**
 * Compara entradas contra salidas del sistema día a día (o mes a mes,
 * si el rango elegido excede 60 días — de lo contrario un año completo
 * dibujaría 365 puntos ilegibles en la gráfica). Usa exactamente el
 * mismo criterio de qué tipo de movimiento "entra" o "sale" del total
 * del sistema que ya usa calcularSignoMovimiento() para el kardex más
 * abajo — los traspasos quedan fuera a propósito porque no cambian el
 * total, solo reubican inventario entre áreas.
 */
export async function obtenerFlujoMovimientos(
  filtros: FiltroAnalitico,
): Promise<ReportesResult<FilaFlujoMovimiento[]>> {
  if (!filtros.fechaInicio || !filtros.fechaFin) {
    return fail(
      'DATOS_INVALIDOS',
      'Debes especificar el rango de fechas (inicio y fin) a consultar.',
    )
  }

  try {
    let consulta = supabase
      .from('movimientos')
      .select('tipo, cantidad, producto_id, usuario_id, ubicacion_origen_id, ubicacion_destino_id, created_at')
      .in('tipo', [...TIPOS_ENTRADA_SISTEMA, ...TIPOS_SALIDA_SISTEMA])
      .gte('created_at', normalizarInicioDeDia(filtros.fechaInicio))
      .lte('created_at', normalizarFinDeDia(filtros.fechaFin))

    if (filtros.productoId) {
      consulta = consulta.eq('producto_id', filtros.productoId)
    }
    if (filtros.usuarioId) {
      consulta = consulta.eq('usuario_id', filtros.usuarioId)
    }
    if (filtros.ubicacionId) {
      consulta = consulta.or(
        `ubicacion_origen_id.eq.${filtros.ubicacionId},ubicacion_destino_id.eq.${filtros.ubicacionId}`,
      )
    }

    const { data, error } = await consulta

    if (error) {
      console.error('[reportes] obtenerFlujoMovimientos:', error)
      return fail(
        'CONSULTA_FALLIDA',
        'No se pudo generar el flujo de movimientos. Intenta de nuevo.',
      )
    }

    const filasCrudas = (data ?? []) as unknown as FilaFlujoCruda[]

    const inicio = new Date(normalizarInicioDeDia(filtros.fechaInicio))
    const fin = new Date(normalizarFinDeDia(filtros.fechaFin))
    const diasDeRango = Math.max(1, (fin.getTime() - inicio.getTime()) / UN_DIA_MS)
    const bucketMensual = diasDeRango > UMBRAL_BUCKET_MENSUAL_DIAS

    const acumulador = new Map<string, FilaFlujoMovimiento>()

    for (const fila of filasCrudas) {
      const periodo = bucketMensual
        ? fila.created_at.slice(0, 7)
        : fila.created_at.slice(0, 10)

      const existente = acumulador.get(periodo) ?? {
        periodo,
        entradas: 0,
        salidas: 0,
      }

      if (TIPOS_ENTRADA_SISTEMA.includes(fila.tipo)) {
        existente.entradas += fila.cantidad
      } else if (TIPOS_SALIDA_SISTEMA.includes(fila.tipo)) {
        existente.salidas += fila.cantidad
      }

      acumulador.set(periodo, existente)
    }

    const resultado = Array.from(acumulador.values()).sort((a, b) =>
      a.periodo.localeCompare(b.periodo),
    )

    return ok(resultado)
  } catch (err) {
    console.error('[reportes] obtenerFlujoMovimientos (excepción):', err)
    return fail(
      'ERROR_RED',
      'No fue posible conectar con el servidor para generar el flujo de movimientos.',
    )
  }
}

// ------------------------------------------------------------------
// 5. obtenerMetricasPorUsuario
// ------------------------------------------------------------------

export interface FilaMetricaUsuario {
  usuario: string
  totalMovimientos: number
  valorTotal: number
}

interface FilaMetricaUsuarioCruda {
  cantidad: number
  costo_snapshot: number | null
  usuario: { nombre_usuario: string } | null
}

/**
 * Desglose operacional de movimientos por usuario/operador dentro del
 * rango elegido — cuenta TODOS los tipos de movimiento (no solo
 * entradas/salidas del sistema), porque el propósito aquí es medir
 * actividad operativa de cada persona, no el impacto neto en el
 * inventario total.
 *
 * Se ordena por totalMovimientos descendente para que el operador con
 * mayor volumen de actividad aparezca primero en la gráfica.
 */
export async function obtenerMetricasPorUsuario(
  filtros: FiltroAnalitico,
): Promise<ReportesResult<FilaMetricaUsuario[]>> {
  if (!filtros.fechaInicio || !filtros.fechaFin) {
    return fail(
      'DATOS_INVALIDOS',
      'Debes especificar el rango de fechas (inicio y fin) a consultar.',
    )
  }

  try {
    let consulta = supabase
      .from('movimientos')
      .select('cantidad, costo_snapshot, usuario:usuarios(nombre_usuario), usuario_id, producto_id, ubicacion_origen_id, ubicacion_destino_id')
      .gte('created_at', normalizarInicioDeDia(filtros.fechaInicio))
      .lte('created_at', normalizarFinDeDia(filtros.fechaFin))

    if (filtros.productoId) {
      consulta = consulta.eq('producto_id', filtros.productoId)
    }
    if (filtros.usuarioId) {
      consulta = consulta.eq('usuario_id', filtros.usuarioId)
    }
    if (filtros.ubicacionId) {
      consulta = consulta.or(
        `ubicacion_origen_id.eq.${filtros.ubicacionId},ubicacion_destino_id.eq.${filtros.ubicacionId}`,
      )
    }

    const { data, error } = await consulta

    if (error) {
      console.error('[reportes] obtenerMetricasPorUsuario:', error)
      return fail(
        'CONSULTA_FALLIDA',
        'No se pudo generar las métricas por usuario. Intenta de nuevo.',
      )
    }

    const filasCrudas = (data ?? []) as unknown as FilaMetricaUsuarioCruda[]
    const acumulador = new Map<string, FilaMetricaUsuario>()

    for (const fila of filasCrudas) {
      const usuario = fila.usuario?.nombre_usuario ?? 'Usuario desconocido'
      const valorFila = fila.cantidad * (fila.costo_snapshot ?? 0)

      const existente = acumulador.get(usuario)
      if (existente) {
        existente.totalMovimientos += 1
        existente.valorTotal += valorFila
      } else {
        acumulador.set(usuario, {
          usuario,
          totalMovimientos: 1,
          valorTotal: valorFila,
        })
      }
    }

    const resultado = Array.from(acumulador.values()).sort(
      (a, b) => b.totalMovimientos - a.totalMovimientos,
    )

    return ok(resultado)
  } catch (err) {
    console.error('[reportes] obtenerMetricasPorUsuario (excepción):', err)
    return fail(
      'ERROR_RED',
      'No fue posible conectar con el servidor para generar las métricas por usuario.',
    )
  }
}

// ------------------------------------------------------------------
// 6. obtenerResumenAuditoria
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
            .order('area', { ascending: true })
            .order('codigo_barras', { ascending: true })
            .range(desde, hasta),
        ),
        obtenerTodasLasFilas((desde, hasta) =>
          supabase
            .from('v_alertas_caducidad')
            .select('dias_restantes')
            .order('id', { ascending: true })
            .range(desde, hasta),
        ),
        obtenerTodasLasFilas((desde, hasta) =>
          supabase
            .from('v_analisis_reposicion')
            .select('estado_logistico')
            .order('producto_id', { ascending: true })
            .order('codigo_ubicacion', { ascending: true })
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