import type { ReactNode } from 'react'
import { useApiResult } from '../hooks/useApiResult'
import {
  obtenerAlertasCaducidad,
  obtenerAnalisisReposicion,
  type InventarioApiError,
} from '../api/inventario'
import {
  obtenerResumenAuditoria,
  type ResumenAuditoria,
  type ReportesApiError,
} from '../api/reportes'
import type { Views } from '../types/database.types'

/**
 * src/components/DashboardScreen.tsx
 *
 * Pantalla operativa de inicio: KPIs de auditoría, semáforo de
 * caducidades (trazabilidad COFEPRIS) y análisis de reposición.
 *
 * Las tres secciones se cargan en paralelo y de forma INDEPENDIENTE
 * entre sí — cada una con su propio useApiResult y su propio estado
 * de carga/error. Esto es deliberado: si la consulta de caducidades
 * falla (por ejemplo, un timeout puntual de red), el usuario debe
 * seguir viendo los KPIs y el análisis de reposición con normalidad,
 * en vez de una pantalla completa en blanco por la falla de un solo
 * panel. Es la decisión inversa a obtenerResumenAuditoria() en
 * reportes.ts, que es deliberadamente todo-o-nada porque ese reporte
 * es un único entregable de auditoría — aquí, en cambio, cada sección
 * es una unidad de información independiente para quien usa el
 * Dashboard en el día a día.
 */

// ------------------------------------------------------------------
// Formato
// ------------------------------------------------------------------

const formatoMoneda = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
})

const formatoFecha = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

function formatearFecha(fechaIso: string | null): string {
  if (!fechaIso) return '—'
  return formatoFecha.format(new Date(fechaIso))
}

function describirDiasRestantes(dias: number | null): string {
  if (dias === null) return '—'
  if (dias < 0) {
    const transcurridos = Math.abs(dias)
    return `Venció hace ${transcurridos} ${transcurridos === 1 ? 'día' : 'días'}`
  }
  if (dias === 0) return 'Vence hoy'
  return `${dias} ${dias === 1 ? 'día' : 'días'}`
}

// ------------------------------------------------------------------
// Clasificación visual del semáforo de caducidad
// ------------------------------------------------------------------

type NivelUrgencia = 'vencido' | 'critico' | 'proximo'

function nivelUrgenciaCaducidad(dias: number | null): NivelUrgencia {
  if (dias === null) return 'proximo'
  if (dias < 0) return 'vencido'
  if (dias <= 7) return 'critico'
  return 'proximo'
}

const ESTILO_URGENCIA: Record<
  NivelUrgencia,
  { fila: string; texto: string; etiqueta: string }
> = {
  vencido: {
    fila: 'bg-status-critico-soft',
    texto: 'text-status-critico',
    etiqueta: 'VENCIDO',
  },
  critico: {
    fila: 'bg-status-critico-soft',
    texto: 'text-status-critico',
    etiqueta: 'CRÍTICO',
  },
  proximo: {
    fila: 'bg-status-reorden-soft',
    texto: 'text-status-reorden',
    etiqueta: 'PRÓXIMO A VENCER',
  },
}

// ------------------------------------------------------------------
// Clasificación visual del estado logístico de reposición
// ------------------------------------------------------------------

const ESTILO_LOGISTICO: Record<string, { fila: string; texto: string; etiqueta: string }> = {
  'ROTURA DE STOCK / CRÍTICO': {
    fila: 'bg-status-critico-soft',
    texto: 'text-status-critico',
    etiqueta: 'ROTURA DE STOCK',
  },
  'REQUERIR COMPRA (PUNTO REORDEN)': {
    fila: 'bg-status-reorden-soft',
    texto: 'text-status-reorden',
    etiqueta: 'PUNTO DE REORDEN',
  },
}

const ESTILO_LOGISTICO_DEFECTO = {
  fila: '',
  texto: 'text-text-muted',
  etiqueta: '—',
}

// ------------------------------------------------------------------
// Componente principal
// ------------------------------------------------------------------

export function DashboardScreen() {
  const resumen = useApiResult(() => obtenerResumenAuditoria(), [])
  const caducidad = useApiResult(() => obtenerAlertasCaducidad(), [])
  const reposicion = useApiResult(() => obtenerAnalisisReposicion(), [])

  return (
    <div className="space-y-8">
      <SeccionKpis estado={resumen} />
      <SeccionCaducidad estado={caducidad} />
      <SeccionReposicion estado={reposicion} />
    </div>
  )
}

// ------------------------------------------------------------------
// Sección 1 — KPIs del resumen de auditoría
// ------------------------------------------------------------------

interface PropsSeccionKpis {
  estado:
    | { fase: 'cargando' }
    | { fase: 'error'; error: ReportesApiError; recargar: () => void }
    | { fase: 'listo'; data: ResumenAuditoria; recargar: () => void }
}

function SeccionKpis({ estado }: PropsSeccionKpis) {
  if (estado.fase === 'cargando') {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <TarjetaKpiCargando key={i} />
        ))}
      </div>
    )
  }

  if (estado.fase === 'error') {
    return <BannerError mensaje={estado.error.message} onReintentar={estado.recargar} />
  }

  const { data } = estado

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <TarjetaKpi
        etiqueta="Valor total del inventario"
        valor={formatoMoneda.format(data.valorTotalInventario)}
      />
      <TarjetaKpi
        etiqueta="Productos activos"
        valor={data.totalProductosActivos.toLocaleString('es-MX')}
      />
      <TarjetaKpi
        etiqueta="Lotes vencidos"
        valor={data.lotesVencidos.toLocaleString('es-MX')}
        tono={data.lotesVencidos > 0 ? 'critico' : undefined}
      />
      <TarjetaKpi
        etiqueta="Lotes por vencer (30 días)"
        valor={data.lotesPorVencerEn30Dias.toLocaleString('es-MX')}
        tono={data.lotesPorVencerEn30Dias > 0 ? 'reorden' : undefined}
      />
    </div>
  )
}

function TarjetaKpi({
  etiqueta,
  valor,
  tono,
}: {
  etiqueta: string
  valor: string
  tono?: 'critico' | 'reorden'
}) {
  const colorValor =
    tono === 'critico'
      ? 'text-status-critico'
      : tono === 'reorden'
        ? 'text-status-reorden'
        : 'text-text-primary'

  return (
    <div className="rounded-lg border border-border bg-canvas-card p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
        {etiqueta}
      </p>
      <p className={`mt-2 text-2xl font-semibold ${colorValor}`}>{valor}</p>
    </div>
  )
}

function TarjetaKpiCargando() {
  return (
    <div className="rounded-lg border border-border bg-canvas-card p-5">
      <div className="h-3 w-28 animate-pulse rounded bg-border" />
      <div className="mt-3 h-7 w-20 animate-pulse rounded bg-border" />
    </div>
  )
}

// ------------------------------------------------------------------
// Sección 2 — Semáforo de caducidades
// ------------------------------------------------------------------

type FilaCaducidad = Views<'v_alertas_caducidad'>

interface PropsSeccionCaducidad {
  estado:
    | { fase: 'cargando' }
    | { fase: 'error'; error: InventarioApiError; recargar: () => void }
    | { fase: 'listo'; data: FilaCaducidad[]; recargar: () => void }
}

function SeccionCaducidad({ estado }: PropsSeccionCaducidad) {
  return (
    <PanelSeccion
      titulo="Semáforo de caducidades"
      subtitulo="Lotes activos con vencimiento en los próximos 30 días, ordenados por urgencia. Control de trazabilidad COFEPRIS."
    >
      {estado.fase === 'cargando' && <CargandoTabla columnas={5} />}

      {estado.fase === 'error' && (
        <BannerError mensaje={estado.error.message} onReintentar={estado.recargar} />
      )}

      {estado.fase === 'listo' && estado.data.length === 0 && (
        <EstadoVacio mensaje="No hay lotes próximos a vencer en los siguientes 30 días." />
      )}

      {estado.fase === 'listo' && estado.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-text-muted">
                <th className="px-3 py-2 font-medium">Producto</th>
                <th className="px-3 py-2 font-medium">Lote</th>
                <th className="px-3 py-2 font-medium">Caducidad</th>
                <th className="px-3 py-2 font-medium">Días restantes</th>
                <th className="px-3 py-2 font-medium">Proveedor</th>
              </tr>
            </thead>
            <tbody>
              {estado.data.map((fila) => {
                const nivel = nivelUrgenciaCaducidad(fila.dias_restantes)
                const estilo = ESTILO_URGENCIA[nivel]

                return (
                  <tr key={fila.id} className={`border-b border-border last:border-0 ${estilo.fila}`}>
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-text-primary">{fila.producto}</p>
                      <p className="text-xs text-text-muted">{fila.codigo_barras}</p>
                    </td>
                    <td className="px-3 py-2.5 text-text-primary">{fila.numero_lote}</td>
                    <td className="px-3 py-2.5 text-text-primary">
                      {formatearFecha(fila.fecha_caducidad)}
                    </td>
                    <td className={`px-3 py-2.5 font-medium ${estilo.texto}`}>
                      <span className="mr-2 rounded-full bg-canvas-card px-2 py-0.5 text-[10px] font-semibold tracking-wide">
                        {estilo.etiqueta}
                      </span>
                      {describirDiasRestantes(fila.dias_restantes)}
                    </td>
                    <td className="px-3 py-2.5 text-text-muted">
                      {fila.proveedor ?? '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </PanelSeccion>
  )
}

// ------------------------------------------------------------------
// Sección 3 — Análisis de reposición
// ------------------------------------------------------------------

type FilaReposicion = Views<'v_analisis_reposicion'>

interface PropsSeccionReposicion {
  estado:
    | { fase: 'cargando' }
    | { fase: 'error'; error: InventarioApiError; recargar: () => void }
    | { fase: 'listo'; data: FilaReposicion[]; recargar: () => void }
}

function SeccionReposicion({ estado }: PropsSeccionReposicion) {
  return (
    <PanelSeccion
      titulo="Análisis de reposición"
      subtitulo="Insumos que ya alcanzaron su punto de reorden o están en rotura de stock. Prioriza estos para la próxima orden de compra."
    >
      {estado.fase === 'cargando' && <CargandoTabla columnas={5} />}

      {estado.fase === 'error' && (
        <BannerError mensaje={estado.error.message} onReintentar={estado.recargar} />
      )}

      {estado.fase === 'listo' && estado.data.length === 0 && (
        <EstadoVacio mensaje="Todo el inventario está en niveles saludables. No hay productos en punto de reorden ni en rotura de stock." />
      )}

      {estado.fase === 'listo' && estado.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-text-muted">
                <th className="px-3 py-2 font-medium">Producto</th>
                <th className="px-3 py-2 font-medium">Ubicación</th>
                <th className="px-3 py-2 font-medium">Stock actual</th>
                <th className="px-3 py-2 font-medium">Mínimo / Reorden</th>
                <th className="px-3 py-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {estado.data.map((fila, indice) => {
                const estilo =
                  ESTILO_LOGISTICO[fila.estado_logistico ?? ''] ??
                  ESTILO_LOGISTICO_DEFECTO

                return (
                  <tr
                    key={fila.producto_id ?? indice}
                    className={`border-b border-border last:border-0 ${estilo.fila}`}
                  >
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-text-primary">{fila.concepto}</p>
                      <p className="text-xs text-text-muted">{fila.codigo_barras}</p>
                    </td>
                    <td className="px-3 py-2.5 text-text-primary">{fila.ubicacion}</td>
                    <td className={`px-3 py-2.5 font-semibold ${estilo.texto}`}>
                      {fila.cantidad_actual ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 text-text-muted">
                      {fila.stock_minimo ?? '—'} / {fila.punto_reorden ?? '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide ${estilo.texto}`}
                      >
                        {estilo.etiqueta}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </PanelSeccion>
  )
}

// ------------------------------------------------------------------
// Bloques de presentación compartidos por las secciones
// ------------------------------------------------------------------

function PanelSeccion({
  titulo,
  subtitulo,
  children,
}: {
  titulo: string
  subtitulo: string
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border border-border bg-canvas-card p-5">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-text-primary">{titulo}</h2>
        <p className="mt-1 text-sm text-text-muted">{subtitulo}</p>
      </div>
      {children}
    </section>
  )
}

function CargandoTabla({ columnas }: { columnas: number }) {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((fila) => (
        <div key={fila} className="flex gap-3">
          {Array.from({ length: columnas }).map((_, col) => (
            <div key={col} className="h-8 flex-1 animate-pulse rounded bg-canvas" />
          ))}
        </div>
      ))}
    </div>
  )
}

function EstadoVacio({ mensaje }: { mensaje: string }) {
  return (
    <div className="rounded-md bg-status-ok-soft px-4 py-6 text-center text-sm text-status-ok">
      {mensaje}
    </div>
  )
}

function BannerError({
  mensaje,
  onReintentar,
}: {
  mensaje: string
  onReintentar: () => void
}) {
  return (
    <div className="flex items-center justify-between rounded-md bg-status-critico-soft px-4 py-3 text-sm text-status-critico">
      <span>{mensaje}</span>
      <button
        type="button"
        onClick={onReintentar}
        className="ml-4 flex-shrink-0 rounded-md border border-status-critico px-3 py-1 text-xs font-medium hover:bg-status-critico hover:text-text-onink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Reintentar
      </button>
    </div>
  )
}