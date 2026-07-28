import ExcelJS from 'exceljs'
import { type Result, okResult, failResult } from '../lib/result'
import { obtenerValorizacionInventario } from '../api/inventario'
import { obtenerUbicaciones, obtenerProductos } from '../api/catalogo'
import {
  obtenerFlujoFinancieroPorArea,
  type FilaKardex,
  type FilaConsumoPorArea,
} from '../api/reportes'

/**
 * src/services/excelService.ts
 *
 * Motor de exportación a Excel (exceljs). Reglas compartidas por TODOS
 * los reportes de este archivo, sin excepción:
 *
 *   - Cero filas vacías: cada hoja se dimensiona exactamente al número
 *     de registros reales (worksheet.getCell/addRow fila por fila,
 *     nunca un rango fijo prellenado).
 *   - Autofit de columnas (autofitColumnas()) para que ningún valor
 *     quede cortado o se muestre como "###".
 *   - 3 decimales exactos en toda cifra monetaria ('$#,##0.000') y
 *     '#,##0' en existencias/cantidades — ver REGLA DE 3 DECIMALES del
 *     encargo original.
 *
 * Este archivo es capa de "servicio": no consulta Supabase
 * directamente — siempre pasa por las funciones ya existentes de
 * src/api/ (mismo principio de separación que ya sigue el resto del
 * proyecto: api/ es la única capa que conoce a `supabase`).
 */

// ------------------------------------------------------------------
// Tipos de resultado y error de este dominio
// ------------------------------------------------------------------

export type ExcelServiceErrorCode = 'DATOS_INVALIDOS' | 'SIN_DATOS' | 'CONSULTA_FALLIDA'

export class ExcelServiceError extends Error {
  readonly code: ExcelServiceErrorCode

  constructor(code: ExcelServiceErrorCode, message: string) {
    super(message)
    this.name = 'ExcelServiceError'
    this.code = code
  }
}

export type ExcelServiceResult<T> = Result<T, ExcelServiceError>

function fail(code: ExcelServiceErrorCode, message: string): ExcelServiceResult<never> {
  return failResult(new ExcelServiceError(code, message))
}

function ok<T>(data: T): ExcelServiceResult<T> {
  return okResult(data)
}

// ------------------------------------------------------------------
// Helpers compartidos
// ------------------------------------------------------------------

const FORMATO_MONEDA_3_DECIMALES = '$#,##0.000'
const FORMATO_EXISTENCIA = '#,##0'

const NOMBRES_MES = [
  'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
  'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE',
]

function parsearIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

function fechaArchivo(): string {
  const hoy = new Date()
  const y = hoy.getFullYear()
  const m = String(hoy.getMonth() + 1).padStart(2, '0')
  const d = String(hoy.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function sanitizarNombreArchivo(texto: string): string {
  return texto.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 60)
}

/** Ajusta el ancho de cada columna a la longitud máxima de su contenido, para evitar texto cortado o celdas '###'. */
function autofitColumnas(hoja: ExcelJS.Worksheet, anchoMinimo = 10, anchoMaximo = 60) {
  hoja.columns.forEach((columna) => {
    if (!columna) return
    let maximo = anchoMinimo
    columna.eachCell?.({ includeEmpty: false }, (celda) => {
      const texto = celda.value == null ? '' : String(celda.text ?? celda.value)
      maximo = Math.max(maximo, texto.length + 2)
    })
    columna.width = Math.min(maximo, anchoMaximo)
  })
}

/** Serializa el workbook y dispara la descarga en el navegador — sin dependencias adicionales tipo file-saver. */
async function descargarWorkbook(workbook: ExcelJS.Workbook, nombreArchivo: string) {
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = nombreArchivo
  document.body.appendChild(enlace)
  enlace.click()
  enlace.remove()
  URL.revokeObjectURL(url)
}

function crearWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'DentaStock v2'
  workbook.created = new Date()
  return workbook
}

// ------------------------------------------------------------------
// 1. generarReporteContraloria
// ------------------------------------------------------------------

/**
 * Replica la estructura confirmada de public/templates/plantilla_contraloria.xlsx:
 * cada fila corresponde 1:1 a un renglón de v_valorizacion_inventario
 * (una combinación producto×área — el mismo producto puede aparecer
 * más de una vez si tiene existencia en más de un área, cada una con
 * su propio costo unitario), filtrado a existencia física activa
 * (cantidad_actual > 0) y ordenado por concepto.
 */
export async function generarReporteContraloria(): Promise<ExcelServiceResult<void>> {
  const valorizacionRes = await obtenerValorizacionInventario()
  if (!valorizacionRes.success) {
    return fail('CONSULTA_FALLIDA', valorizacionRes.error.message)
  }

  const filas = valorizacionRes.data
    .filter((f) => (f.cantidad_actual ?? 0) > 0)
    .sort((a, b) => (a.concepto ?? '').localeCompare(b.concepto ?? ''))

  if (filas.length === 0) {
    return fail(
      'SIN_DATOS',
      'No hay productos con existencia física activa para incluir en el reporte de Contraloría.',
    )
  }

  const workbook = crearWorkbook()
  const hoja = workbook.addWorksheet('CONTRALORÍA')

  const filaEncabezado = hoja.addRow([
    'N°', 'ARTÍCULO', 'DESCRIPCIÓN', 'COSTO', 'COSTO CON IVA', 'EXISTENCIA FINAL', 'TOTAL FINAL',
  ])
  filaEncabezado.font = { bold: true }
  filaEncabezado.eachCell((celda) => {
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F1F0' } }
    celda.alignment = { vertical: 'middle', horizontal: 'center' }
  })

  filas.forEach((f, indice) => {
    const numeroFila = indice + 2
    hoja.addRow([
      indice + 1,
      f.codigo_barras ?? '',
      f.concepto ?? '',
      f.precio_unitario ?? 0,
      { formula: `D${numeroFila}*1.16` },
      f.cantidad_actual ?? 0,
      { formula: `E${numeroFila}*F${numeroFila}` },
    ])
  })

  const ultimaFilaDatos = filas.length + 1
  const filaTotalesNum = ultimaFilaDatos + 1
  hoja.mergeCells(`A${filaTotalesNum}:F${filaTotalesNum}`)
  const celdaEtiquetaTotal = hoja.getCell(`A${filaTotalesNum}`)
  celdaEtiquetaTotal.value = 'TOTAL GENERAL'
  celdaEtiquetaTotal.font = { bold: true }
  celdaEtiquetaTotal.alignment = { horizontal: 'center' }
  const celdaTotal = hoja.getCell(`G${filaTotalesNum}`)
  celdaTotal.value = { formula: `SUM(G2:G${ultimaFilaDatos})` }
  celdaTotal.font = { bold: true }

  hoja.getColumn(4).numFmt = FORMATO_MONEDA_3_DECIMALES
  hoja.getColumn(5).numFmt = FORMATO_MONEDA_3_DECIMALES
  hoja.getColumn(6).numFmt = FORMATO_EXISTENCIA
  hoja.getColumn(7).numFmt = FORMATO_MONEDA_3_DECIMALES

  autofitColumnas(hoja)

  await descargarWorkbook(workbook, `Reporte_Contraloria_${fechaArchivo()}.xlsx`)
  return ok(undefined)
}

// ------------------------------------------------------------------
// 2. generarReporteFinanzas
// ------------------------------------------------------------------

function listaMeses(fechaInicio: string, fechaFin: string): { anio: number; mes: number }[] {
  const inicio = parsearIso(fechaInicio)
  const fin = parsearIso(fechaFin)
  const meses: { anio: number; mes: number }[] = []

  let anio = inicio.getFullYear()
  let mes = inicio.getMonth() + 1
  const anioFin = fin.getFullYear()
  const mesFin = fin.getMonth() + 1

  while (anio < anioFin || (anio === anioFin && mes <= mesFin)) {
    meses.push({ anio, mes })
    mes += 1
    if (mes > 12) {
      mes = 1
      anio += 1
    }
  }

  return meses
}

function etiquetaHojaFinanzas(fechaInicio: string, fechaFin: string): string {
  const inicio = parsearIso(fechaInicio)
  const fin = parsearIso(fechaFin)
  const etiqueta = `FINANZAS ${NOMBRES_MES[inicio.getMonth()].slice(0, 3)}${String(inicio.getFullYear()).slice(2)}-${NOMBRES_MES[fin.getMonth()].slice(0, 3)}${String(fin.getFullYear()).slice(2)}`
  // Excel limita el nombre de hoja a 31 caracteres.
  return etiqueta.slice(0, 31)
}

/**
 * Replica la estructura confirmada de public/templates/plantilla_finanzas.xlsx:
 * encabezado institucional fijo, bloque de Existencia Inicial (según lo
 * acordado, la valorización ACTUAL del inventario — no una
 * reconstrucción histórica — desglosada en MATERIAL DENTAL / MAT.
 * LIMPIEZA vía categorias.grupo_financiero), tabla dinámica área×mes
 * con saldo acumulado, fila de totales, saldo final y firmas.
 *
 * `fechaInicio`/`fechaFin` definen el rango libre de meses a reportar
 * (acordado con el usuario en vez de un año calendario fijo).
 */
export async function generarReporteFinanzas(
  fechaInicio: string,
  fechaFin: string,
): Promise<ExcelServiceResult<void>> {
  if (!fechaInicio || !fechaFin) {
    return fail('DATOS_INVALIDOS', 'Debes especificar el rango de fechas (inicio y fin) del reporte.')
  }

  const [ubicacionesRes, flujoRes, valorizacionRes, productosRes] = await Promise.all([
    obtenerUbicaciones(),
    obtenerFlujoFinancieroPorArea(fechaInicio, fechaFin),
    obtenerValorizacionInventario(),
    obtenerProductos(),
  ])

  if (!ubicacionesRes.success) return fail('CONSULTA_FALLIDA', ubicacionesRes.error.message)
  if (!flujoRes.success) return fail('CONSULTA_FALLIDA', flujoRes.error.message)
  if (!valorizacionRes.success) return fail('CONSULTA_FALLIDA', valorizacionRes.error.message)
  if (!productosRes.success) return fail('CONSULTA_FALLIDA', productosRes.error.message)

  const areas = ubicacionesRes.data
    .filter((u) => u.es_destino_final)
    .sort((a, b) => a.nombre.localeCompare(b.nombre))

  if (areas.length === 0) {
    return fail(
      'SIN_DATOS',
      'No hay áreas clínicas (destino final) configuradas para generar el reporte de Finanzas.',
    )
  }

  // Mapa codigo_barras -> grupo_financiero, para desglosar la Existencia
  // Inicial de v_valorizacion_inventario (que no trae ese campo) contra
  // la categoría de cada producto.
  const grupoPorCodigo = new Map<string, 'MATERIAL_DENTAL' | 'MATERIAL_LIMPIEZA'>()
  for (const p of productosRes.data) {
    grupoPorCodigo.set(p.codigo_barras, p.categoria?.grupo_financiero ?? 'MATERIAL_DENTAL')
  }

  let materialDentalValor = 0
  let materialLimpiezaValor = 0
  for (const fila of valorizacionRes.data) {
    const grupo = (fila.codigo_barras && grupoPorCodigo.get(fila.codigo_barras)) || 'MATERIAL_DENTAL'
    if (grupo === 'MATERIAL_LIMPIEZA') {
      materialLimpiezaValor += fila.valor_total ?? 0
    } else {
      materialDentalValor += fila.valor_total ?? 0
    }
  }

  const workbook = crearWorkbook()
  const hoja = workbook.addWorksheet(etiquetaHojaFinanzas(fechaInicio, fechaFin))

  // ---- Bloque institucional (filas 2-6) ----
  hoja.mergeCells('A2:C2')
  hoja.getCell('A2').value = 'EXISTENCIA INICIAL (VALORIZACIÓN ACTUAL)'
  hoja.getCell('A2').font = { bold: true }
  hoja.mergeCells('D2:D3')
  hoja.getCell('D2').value = materialDentalValor + materialLimpiezaValor
  hoja.getCell('D2').numFmt = FORMATO_MONEDA_3_DECIMALES
  hoja.getCell('D2').alignment = { vertical: 'middle', horizontal: 'center' }
  hoja.getCell('E2').value = 'URE:'
  hoja.getCell('E2').font = { bold: true }
  hoja.getCell('F2').value = 1207

  hoja.mergeCells('A3:C3')
  hoja.getCell('A3').value = 'ALMACÉN CLÍNICA ODONTOLÓGICA "DR. BENJAMÍN MORENO PÉREZ"'
  hoja.getCell('A3').font = { bold: true }
  hoja.getCell('E3').value = 'PROGRAMA:'
  hoja.getCell('E3').font = { bold: true }
  hoja.getCell('F3').value = 1080283

  hoja.getCell('A4').value = 'EXISTENCIA INICIAL (VALORIZACIÓN ACTUAL) MATERIAL DENTAL'
  hoja.getCell('C4').value = materialDentalValor
  hoja.getCell('C4').numFmt = FORMATO_MONEDA_3_DECIMALES
  hoja.getCell('E4').value = 'CUENTAS CONTABLES:'
  hoja.getCell('E4').font = { bold: true }
  hoja.getCell('F4').value = '512.5.0.004.0000001'

  hoja.getCell('A5').value = 'EXISTENCIA INICIAL (VALORIZACIÓN ACTUAL) MAT. LIMPIEZA'
  hoja.getCell('C5').value = materialLimpiezaValor
  hoja.getCell('C5').numFmt = FORMATO_MONEDA_3_DECIMALES
  hoja.getCell('F5').value = '512.1.0.006.0000001'

  hoja.getCell('C6').value = { formula: 'SUM(C4:C5)' }
  hoja.getCell('C6').numFmt = FORMATO_MONEDA_3_DECIMALES
  hoja.getCell('C6').font = { bold: true }

  // ---- Tabla dinámica (desde fila 8) ----
  const filaEncabezadoTabla = hoja.getRow(8)
  filaEncabezadoTabla.getCell(1).value = 'CONCEPTO'
  filaEncabezadoTabla.getCell(2).value = 'MES'
  filaEncabezadoTabla.getCell(3).value = 'ENTRADA'
  filaEncabezadoTabla.getCell(4).value = 'SALIDA'
  filaEncabezadoTabla.getCell(5).value = 'EXISTENCIA FINAL'
  filaEncabezadoTabla.font = { bold: true }
  filaEncabezadoTabla.eachCell((celda) => {
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F1F0' } }
  })

  const meses = listaMeses(fechaInicio, fechaFin)
  const primeraFilaDatos = 9
  let fila = primeraFilaDatos

  for (const { anio, mes } of meses) {
    for (const area of areas) {
      const encontrado = flujoRes.data.find(
        (f) => f.ubicacionId === area.id && f.anio === anio && f.mes === mes,
      )
      const entrada = encontrado?.entrada ?? 0
      const salida = encontrado?.salida ?? 0

      hoja.getCell(fila, 1).value = area.nombre
      hoja.getCell(fila, 2).value = NOMBRES_MES[mes - 1]
      hoja.getCell(fila, 3).value = entrada
      hoja.getCell(fila, 4).value = salida
      hoja.getCell(fila, 5).value = {
        formula:
          fila === primeraFilaDatos
            ? `D2+C${fila}-D${fila}`
            : `E${fila - 1}+C${fila}-D${fila}`,
      }
      hoja.getCell(fila, 3).numFmt = FORMATO_MONEDA_3_DECIMALES
      hoja.getCell(fila, 4).numFmt = FORMATO_MONEDA_3_DECIMALES
      hoja.getCell(fila, 5).numFmt = FORMATO_MONEDA_3_DECIMALES

      fila += 1
    }
  }

  const ultimaFilaDatos = fila - 1

  // ---- Totales y saldo final ----
  const filaTotales = fila
  hoja.mergeCells(`A${filaTotales}:B${filaTotales}`)
  hoja.getCell(filaTotales, 1).value = 'TOTALES'
  hoja.getCell(filaTotales, 3).value = { formula: `SUM(C${primeraFilaDatos}:C${ultimaFilaDatos})` }
  hoja.getCell(filaTotales, 4).value = { formula: `SUM(D${primeraFilaDatos}:D${ultimaFilaDatos})` }
  hoja.getCell(filaTotales, 5).value = { formula: `C6+C${filaTotales}-D${filaTotales}` }
  hoja.getRow(filaTotales).font = { bold: true }
  hoja.getRow(filaTotales).alignment = { horizontal: 'center' }
  hoja.getCell(filaTotales, 3).numFmt = FORMATO_MONEDA_3_DECIMALES
  hoja.getCell(filaTotales, 4).numFmt = FORMATO_MONEDA_3_DECIMALES
  hoja.getCell(filaTotales, 5).numFmt = FORMATO_MONEDA_3_DECIMALES

  const filaSaldoFinal = filaTotales + 1
  hoja.mergeCells(`A${filaSaldoFinal}:D${filaSaldoFinal}`)
  hoja.getCell(filaSaldoFinal, 1).value = 'SALDO FINAL'
  hoja.getCell(filaSaldoFinal, 5).value = { formula: `E${filaTotales}` }
  hoja.getRow(filaSaldoFinal).font = { bold: true }
  hoja.getCell(filaSaldoFinal, 1).alignment = { horizontal: 'center' }
  hoja.getCell(filaSaldoFinal, 5).numFmt = FORMATO_MONEDA_3_DECIMALES

  // ---- Firmas, 3 filas de distancia del renglón de Totales ----
  const filaFirma = filaTotales + 3
  hoja.mergeCells(`A${filaFirma}:B${filaFirma}`)
  hoja.getCell(filaFirma, 1).value = 'L.A.V. MÓNICA RICO GUTIÉRREZ'
  hoja.mergeCells(`D${filaFirma}:F${filaFirma}`)
  hoja.getCell(filaFirma, 4).value = 'L.O.E.E. KARLA PAMELA SÁNCHEZ MENDIETA'
  hoja.getRow(filaFirma).font = { bold: true }
  hoja.getRow(filaFirma).alignment = { horizontal: 'center' }

  const filaFirmaEtiqueta = filaFirma + 1
  hoja.mergeCells(`A${filaFirmaEtiqueta}:B${filaFirmaEtiqueta}`)
  hoja.getCell(filaFirmaEtiqueta, 1).value = 'ELABORÓ'
  hoja.mergeCells(`D${filaFirmaEtiqueta}:F${filaFirmaEtiqueta}`)
  hoja.getCell(filaFirmaEtiqueta, 4).value = 'AUTORIZÓ'
  hoja.getRow(filaFirmaEtiqueta).font = { bold: true }
  hoja.getRow(filaFirmaEtiqueta).alignment = { horizontal: 'center' }

  autofitColumnas(hoja)

  await descargarWorkbook(workbook, `Reporte_Finanzas_${fechaInicio}_a_${fechaFin}.xlsx`)
  return ok(undefined)
}

// ------------------------------------------------------------------
// 3. exportarKardexAExcel — export real para el Kardex de ReportesScreen
// ------------------------------------------------------------------

export async function exportarKardexAExcel(
  filas: FilaKardex[],
  nombreProducto: string,
): Promise<ExcelServiceResult<void>> {
  if (filas.length === 0) {
    return fail('SIN_DATOS', 'No hay movimientos para exportar en el rango seleccionado.')
  }

  const workbook = crearWorkbook()
  const hoja = workbook.addWorksheet('KARDEX')

  const filaEncabezado = hoja.addRow([
    'Fecha', 'Tipo', 'Cantidad', 'Saldo Global', 'Costo Unitario', 'Valor Movimiento',
    'Lote', 'Caducidad Lote', 'Factura', 'Origen', 'Destino', 'Usuario', 'Comentario',
  ])
  filaEncabezado.font = { bold: true }

  filas.forEach((f) => {
    const cantidadConSigno =
      f.signoImpactoGlobal > 0 ? f.cantidad : f.signoImpactoGlobal < 0 ? -f.cantidad : f.cantidad

    hoja.addRow([
      new Date(f.fecha),
      f.tipo.replace(/_/g, ' '),
      cantidadConSigno,
      f.saldoAcumuladoGlobal,
      f.costoUnitario ?? 0,
      f.valorMovimiento ?? 0,
      f.numeroLote ?? '',
      f.fechaCaducidadLote ? new Date(f.fechaCaducidadLote) : '',
      f.numeroFactura ?? '',
      f.ubicacionOrigen ?? '',
      f.ubicacionDestino ?? '',
      f.usuario,
      f.comentario ?? '',
    ])
  })

  hoja.getColumn(1).numFmt = 'dd/mm/yyyy hh:mm'
  hoja.getColumn(3).numFmt = FORMATO_EXISTENCIA
  hoja.getColumn(4).numFmt = FORMATO_EXISTENCIA
  hoja.getColumn(5).numFmt = FORMATO_MONEDA_3_DECIMALES
  hoja.getColumn(6).numFmt = FORMATO_MONEDA_3_DECIMALES
  hoja.getColumn(8).numFmt = 'dd/mm/yyyy'

  autofitColumnas(hoja)

  await descargarWorkbook(
    workbook,
    `Kardex_${sanitizarNombreArchivo(nombreProducto)}_${fechaArchivo()}.xlsx`,
  )
  return ok(undefined)
}

// ------------------------------------------------------------------
// 4. exportarConsumoPorAreasAExcel — export real para el reporte de Consumo por Áreas
// ------------------------------------------------------------------

export async function exportarConsumoPorAreasAExcel(
  filas: FilaConsumoPorArea[],
  fechaInicio: string,
  fechaFin: string,
): Promise<ExcelServiceResult<void>> {
  if (filas.length === 0) {
    return fail('SIN_DATOS', 'No hay datos de consumo para exportar en el rango seleccionado.')
  }

  const workbook = crearWorkbook()
  const hoja = workbook.addWorksheet('CONSUMO POR ÁREAS')

  const filaEncabezado = hoja.addRow(['Ubicación', 'Tipo de Egreso', 'Cantidad Total', 'Valor Total'])
  filaEncabezado.font = { bold: true }

  filas.forEach((f) => {
    hoja.addRow([
      f.ubicacion,
      f.tipo === 'CONSUMO' ? 'Consumo clínico' : 'Merma por caducidad',
      f.cantidadTotal,
      f.valorTotal,
    ])
  })

  hoja.getColumn(3).numFmt = FORMATO_EXISTENCIA
  hoja.getColumn(4).numFmt = FORMATO_MONEDA_3_DECIMALES

  autofitColumnas(hoja)

  await descargarWorkbook(workbook, `Consumo_Por_Areas_${fechaInicio}_a_${fechaFin}.xlsx`)
  return ok(undefined)
}
