import { useState, type FormEvent } from 'react'
import { useApiResult } from '../hooks/useApiResult'
import { obtenerProductos, type ProductoConCategoria } from '../api/catalogo'
import {
  obtenerKardexProducto,
  obtenerConsumoPorAreas,
  type FilaKardex,
  type FilaConsumoPorArea,
  type ReportesApiError,
} from '../api/reportes'
import {
  generarReporteContraloria,
  generarReporteFinanzas,
  exportarKardexAExcel,
  exportarConsumoPorAreasAExcel,
} from '../services/excelService'
import { Tabs } from './common/Tabs'
import { DatePicker } from './common/DatePicker'
import { DateRangePicker } from './common/DateRangePicker'

const formatoMoneda = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
})

const formatoFecha = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export function ReportesScreen() {
  const productosRes = useApiResult(() => obtenerProductos(), [])

  return (
    <div className="space-y-6">
      {/* Encabezado del Módulo */}
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Reportes de Auditoría y Contraloría</h1>
        <p className="mt-0.5 text-sm text-text-muted">Consolidación financiera, rastreabilidad cronológica y control presupuestal de insumos.</p>
      </div>

      {/* Contenedor del Reporte Activo */}
      <div className="rounded-lg border border-border bg-canvas-card p-6 shadow-sm">
        {productosRes.fase === 'cargando' ? (
          <div className="py-8 text-center text-sm text-text-muted animate-pulse">Cargando catálogos analíticos...</div>
        ) : (
          <Tabs
            pestanas={[
              {
                id: 'kardex',
                etiqueta: '📈 Kardex Global Histórico',
                contenido: (
                  <PanelKardex productos={productosRes.fase === 'listo' ? productosRes.data : []} />
                ),
              },
              {
                id: 'consumos',
                etiqueta: '📊 Consumo por Áreas Clínicas',
                contenido: <PanelConsumoPorAreas />,
              },
              {
                id: 'contraloria',
                etiqueta: '🏛️ Contraloría',
                contenido: <PanelContraloria />,
              },
              {
                id: 'finanzas',
                etiqueta: '💰 Finanzas',
                contenido: <PanelFinanzas />,
              },
            ]}
          />
        )}
      </div>
    </div>
  )
}

// =================================────────────────=================
// 📈 SUB-PANEL: KARDEX HISTÓRICO GLOBAL
// =================================────────────────=================
function PanelKardex({ productos }: { productos: ProductoConCategoria[] }) {
  const [productoId, setProductoId] = useState('')
  const [fechaInicio, setFechaInicio] = useState<string | null>(null)
  const [fechaFin, setFechaFin] = useState<string | null>(null)
  const [ejecutarTrigger, setEjecutarTrigger] = useState(0)
  const [exportando, setExportando] = useState(false)
  const [errorExportar, setErrorExportar] = useState<string | null>(null)

  // Consulta perezosa diferida: solo se dispara cuando el usuario hace clic explícito en "Consultar"
  const kardexData = useApiResult<FilaKardex[], ReportesApiError>(
    () => (productoId ? obtenerKardexProducto(productoId, fechaInicio ?? undefined, fechaFin ?? undefined) : Promise.resolve({ success: true, data: [] as FilaKardex[] })),
    [ejecutarTrigger]
  )

  function manejarConsulta(e: FormEvent) {
    e.preventDefault()
    if (!productoId) return
    setEjecutarTrigger((prev) => prev + 1)
  }

  async function exportarAExcel() {
    if (kardexData.fase !== 'listo') return
    setErrorExportar(null)
    setExportando(true)
    const nombreProducto = productos.find((p) => p.id === productoId)?.concepto ?? 'Producto'
    const resultado = await exportarKardexAExcel(kardexData.data, nombreProducto)
    setExportando(false)
    if (!resultado.success) {
      setErrorExportar(resultado.error.message)
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={manejarConsulta} className="grid grid-cols-1 gap-4 sm:grid-cols-4 items-end bg-canvas p-4 rounded-lg border border-border">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-text-muted mb-1">Insumo a Auditar</label>
          <select required value={productoId} onChange={(e) => setProductoId(e.target.value)} className="w-full rounded-md border border-border bg-canvas-card px-3 py-2 text-sm focus:border-accent focus:outline-none">
            <option value="">Selecciona un material dental...</option>
            {productos.map((p) => <option key={p.id} value={p.id}>{p.concepto} ({p.codigo_barras})</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Desde (Opcional)</label>
          <DatePicker value={fechaInicio} onChange={setFechaInicio} placeholder="Sin límite inferior" />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Hasta (Opcional)</label>
          <DatePicker value={fechaFin} onChange={setFechaFin} placeholder="Sin límite superior" maxHoy />
        </div>
        <div className="sm:col-span-4 flex justify-end">
          <button type="submit" className="rounded-md bg-ink-900 px-5 py-2 text-sm font-medium text-text-onink hover:bg-ink-700 transition-colors">
            🔍 Consultar Historial
          </button>
        </div>
      </form>

      {kardexData.fase === 'cargando' && <div className="py-8 text-center text-sm text-text-muted animate-pulse">Calculando saldos acumulados...</div>}

      {kardexData.fase === 'error' && (
        <div className="rounded-md bg-status-critico-soft p-4 text-sm text-status-critico">{kardexData.error.message}</div>
      )}

      {kardexData.fase === 'listo' && ejecutarTrigger > 0 && (
        <div className="space-y-4">
          {errorExportar && (
            <div className="rounded-md bg-status-critico-soft p-3 text-sm text-status-critico">{errorExportar}</div>
          )}
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider">Libro Auxiliar de Movimientos</h3>
            {kardexData.data.length > 0 && (
              <button
                type="button"
                onClick={exportarAExcel}
                disabled={exportando}
                className="rounded-md border border-accent bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent-strong hover:bg-accent hover:text-text-onink transition-colors disabled:opacity-60"
              >
                {exportando ? 'Generando…' : '📥 Exportar Kardex a Excel'}
              </button>
            )}
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-canvas text-xs uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-2.5 font-medium">Fecha de Registro</th>
                  <th className="px-4 py-2.5 font-medium">Operación</th>
                  <th className="px-4 py-2.5 font-medium">Lote / Factura</th>
                  <th className="px-4 py-2.5 font-medium">Origen / Destino</th>
                  <th className="px-4 py-2.5 font-right text-right">Cantidad</th>
                  <th className="px-4 py-2.5 font-right text-right">Saldo Global</th>
                  <th className="px-4 py-2.5 font-right text-right">Valorizado (c/IVA)</th>
                </tr>
              </thead>
              <tbody>
                {kardexData.data.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-text-muted">No se encontraron movimientos registrados en el rango seleccionado.</td></tr>
                ) : (
                  kardexData.data.map((fila, i) => (
                    <tr key={i} className="border-b border-border last:border-0 hover:bg-canvas transition-colors">
                      <td className="px-4 py-3 text-xs font-mono text-text-muted">{formatoFecha.format(new Date(fila.fecha))}</td>
                      <td className="px-4 py-3">
                        <span className="font-medium text-text-primary">{fila.tipo.replace('_', ' ')}</span>
                        {fila.comentario && <p className="text-xs text-text-muted italic mt-0.5">"{fila.comentario}"</p>}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <p className="text-text-primary font-medium">Lt: {fila.numeroLote ?? '—'}</p>
                        <p className="text-text-muted">Fac: {fila.numeroFactura ?? '—'}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-text-muted">
                        <p>Ori: {fila.ubicacionOrigen ?? '—'}</p>
                        <p>Des: {fila.ubicacionDestino ?? '—'}</p>
                      </td>
                      <td className={`px-4 py-3 text-right font-semibold ${fila.signoImpactoGlobal > 0 ? 'text-status-ok' : fila.signoImpactoGlobal < 0 ? 'text-status-critico' : 'text-text-muted'}`}>
                        {fila.signoImpactoGlobal > 0 ? `+${fila.cantidad}` : fila.signoImpactoGlobal < 0 ? `-${fila.cantidad}` : `${fila.cantidad}`}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-text-primary">{fila.saldoAcumuladoGlobal}</td>
                      <td className="px-4 py-3 text-right font-mono text-text-muted">{fila.valorMovimiento ? formatoMoneda.format(fila.valorMovimiento) : '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// =================================────────────────=================
// 📊 SUB-PANEL: CONSUMO AGRUPADO POR ÁREAS CLINICAS
// =================================────────────────=================
function PanelConsumoPorAreas() {
  const [fechaInicio, setFechaInicio] = useState<string | null>(null)
  const [fechaFin, setFechaFin] = useState<string | null>(null)
  const [ejecutarTrigger, setEjecutarTrigger] = useState(0)
  const [exportando, setExportando] = useState(false)
  const [errorExportar, setErrorExportar] = useState<string | null>(null)

  const consumosData = useApiResult<FilaConsumoPorArea[], ReportesApiError>(
    () => (fechaInicio && fechaFin ? obtenerConsumoPorAreas(fechaInicio, fechaFin) : Promise.resolve({ success: true, data: [] as FilaConsumoPorArea[] })),
    [ejecutarTrigger]
  )

  function manejarConsulta(e: FormEvent) {
    e.preventDefault()
    if (!fechaInicio || !fechaFin) return
    setEjecutarTrigger((prev) => prev + 1)
  }

  async function exportarAExcel() {
    if (consumosData.fase !== 'listo' || !fechaInicio || !fechaFin) return
    setErrorExportar(null)
    setExportando(true)
    const resultado = await exportarConsumoPorAreasAExcel(consumosData.data, fechaInicio, fechaFin)
    setExportando(false)
    if (!resultado.success) {
      setErrorExportar(resultado.error.message)
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={manejarConsulta} className="grid grid-cols-1 gap-4 sm:grid-cols-3 items-end bg-canvas p-4 rounded-lg border border-border">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-text-muted mb-1">Rango de fechas (Obligatorio)</label>
          <DateRangePicker
            fechaInicio={fechaInicio}
            fechaFin={fechaFin}
            onChange={(rango) => {
              setFechaInicio(rango.fechaInicio)
              setFechaFin(rango.fechaFin)
            }}
          />
        </div>
        <button
          type="submit"
          disabled={!fechaInicio || !fechaFin}
          className="rounded-md bg-ink-900 px-5 py-2 text-sm font-medium text-text-onink hover:bg-ink-700 transition-colors h-10 disabled:opacity-50"
        >
          📈 Consolidar Costos
        </button>
      </form>

      {consumosData.fase === 'cargando' && <div className="py-8 text-center text-sm text-text-muted animate-pulse">Agrupando mermas y egresos clínicos...</div>}

      {consumosData.fase === 'error' && (
        <div className="rounded-md bg-status-critico-soft p-4 text-sm text-status-critico">{consumosData.error.message}</div>
      )}

      {consumosData.fase === 'listo' && ejecutarTrigger > 0 && (
        <div className="space-y-4">
          {errorExportar && (
            <div className="rounded-md bg-status-critico-soft p-3 text-sm text-status-critico">{errorExportar}</div>
          )}
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider">Centro de Costos por Distribución</h3>
            {consumosData.data.length > 0 && (
              <button
                type="button"
                onClick={exportarAExcel}
                disabled={exportando}
                className="rounded-md border border-accent bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent-strong hover:bg-accent hover:text-text-onink transition-colors disabled:opacity-60"
              >
                {exportando ? 'Generando…' : '📥 Exportar Costos a Excel'}
              </button>
            )}
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-canvas text-xs uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-2.5 font-medium">Ubicación / Facultad Satélite</th>
                  <th className="px-4 py-2.5 font-medium">Tipo de Egreso</th>
                  <th className="px-4 py-2.5 font-right text-right">Cantidad de Insumos</th>
                  <th className="px-4 py-2.5 font-right text-right">Impacto Financiero Total</th>
                </tr>
              </thead>
              <tbody>
                {consumosData.data.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-text-muted">No se registraron bajas legítimas ni mermas en este periodo de tiempo.</td></tr>
                ) : (
                  consumosData.data.map((fila, i) => (
                    <tr key={i} className="border-b border-border last:border-0 hover:bg-canvas transition-colors">
                      <td className="px-4 py-3 font-medium text-text-primary">{fila.ubicacion}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide ${
                          fila.tipo === 'CONSUMO' ? 'bg-status-ok-soft text-status-ok' : 'bg-status-critico-soft text-status-critico'
                        }`}>
                          {fila.tipo === 'CONSUMO' ? 'CONSUMO CLÍNICO' : 'MERMA POR CADUCIDAD'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-text-primary">{fila.cantidadTotal.toLocaleString('es-MX')}</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-text-primary">{formatoMoneda.format(fila.valorTotal)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// =================================────────────────=================
// 🏛️ SUB-PANEL: REPORTE DE CONTRALORÍA
// =================================────────────────=================
function PanelContraloria() {
  const [generando, setGenerando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState(false)

  async function generar() {
    setGenerando(true)
    setError(null)
    setExito(false)
    const resultado = await generarReporteContraloria()
    setGenerando(false)
    if (!resultado.success) {
      setError(resultado.error.message)
      return
    }
    setExito(true)
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-canvas p-5">
        <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider">Reporte de Contraloría</h3>
        <p className="mt-2 text-sm text-text-muted">
          Genera el reporte institucional de existencia física activa: solo incluye productos con
          existencia final mayor a cero, con COSTO, COSTO CON IVA y TOTAL FINAL calculados por
          fórmula dentro del propio archivo Excel, exactamente con la estructura de columnas
          exigida por Contraloría (N°, Artículo, Descripción, Costo, Costo con IVA, Existencia
          Final, Total Final).
        </p>
      </div>

      {error && <div className="rounded-md bg-status-critico-soft p-3 text-sm text-status-critico">{error}</div>}
      {exito && (
        <div className="rounded-md bg-status-ok-soft p-3 text-sm text-status-ok">
          Reporte generado y descargado correctamente.
        </div>
      )}

      <button
        type="button"
        onClick={generar}
        disabled={generando}
        className="rounded-md bg-ink-900 px-5 py-2.5 text-sm font-medium text-text-onink hover:bg-ink-700 transition-colors disabled:opacity-60"
      >
        {generando ? 'Generando…' : '📥 Generar Reporte de Contraloría'}
      </button>
    </div>
  )
}

// =================================────────────────=================
// 💰 SUB-PANEL: REPORTE DE FINANZAS
// =================================────────────────=================
function PanelFinanzas() {
  const [fechaInicio, setFechaInicio] = useState<string | null>(null)
  const [fechaFin, setFechaFin] = useState<string | null>(null)
  const [generando, setGenerando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState(false)

  async function generar() {
    if (!fechaInicio || !fechaFin) return
    setGenerando(true)
    setError(null)
    setExito(false)
    const resultado = await generarReporteFinanzas(fechaInicio, fechaFin)
    setGenerando(false)
    if (!resultado.success) {
      setError(resultado.error.message)
      return
    }
    setExito(true)
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-canvas p-5">
        <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider">Reporte de Finanzas</h3>
        <p className="mt-2 text-sm text-text-muted">
          Genera el reporte institucional Concepto/Área · Mes · Entrada · Salida · Existencia Final,
          con el bloque de Existencia Inicial (valorización actual del inventario, desglosada en
          Material Dental / Mat. Limpieza), saldo acumulado por fórmula, totales y firmas. Elige el
          rango de meses a incluir.
        </p>
      </div>

      <div className="max-w-sm">
        <label className="block text-xs font-medium text-text-muted mb-1">Rango de fechas del reporte</label>
        <DateRangePicker
          fechaInicio={fechaInicio}
          fechaFin={fechaFin}
          onChange={(rango) => {
            setFechaInicio(rango.fechaInicio)
            setFechaFin(rango.fechaFin)
          }}
        />
      </div>

      {error && <div className="rounded-md bg-status-critico-soft p-3 text-sm text-status-critico">{error}</div>}
      {exito && (
        <div className="rounded-md bg-status-ok-soft p-3 text-sm text-status-ok">
          Reporte generado y descargado correctamente.
        </div>
      )}

      <button
        type="button"
        onClick={generar}
        disabled={generando || !fechaInicio || !fechaFin}
        className="rounded-md bg-ink-900 px-5 py-2.5 text-sm font-medium text-text-onink hover:bg-ink-700 transition-colors disabled:opacity-60"
      >
        {generando ? 'Generando…' : '📥 Generar Reporte de Finanzas'}
      </button>
    </div>
  )
}
