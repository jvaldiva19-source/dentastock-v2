import { useMemo, useState } from 'react'
import { useApiResult } from '../hooks/useApiResult'
import { obtenerUbicaciones } from '../api/catalogo'
import {
  obtenerValorizacionInventario,
  obtenerAnalisisReposicion,
  obtenerConsumoPracticas,
  type InventarioApiError,
} from '../api/inventario'
import { DateRangePicker } from './common/DateRangePicker'
import { fechaAIso } from '../lib/fechas'
import type { Views, ConsumoPractica } from '../types/database.types'

type FilaValorizacion = Views<'v_valorizacion_inventario'>

type EstadoValorizacion =
  | { fase: 'cargando' }
  | { fase: 'error'; error: InventarioApiError; recargar: () => void }
  | { fase: 'listo'; data: FilaValorizacion[]; recargar: () => void }

type EstadoConsumo =
  | { fase: 'cargando' }
  | { fase: 'error'; error: InventarioApiError; recargar: () => void }
  | { fase: 'listo'; data: ConsumoPractica[]; recargar: () => void }

/**
 * src/components/GestionFarmaciasScreen.tsx
 *
 * Pantalla ADMIN-only: "Gestión y Analítica de Farmacias". Selector de
 * farmacia + 4 tarjetas KPI + tabla de existencias valorizadas +
 * historial de consumo por alumno/práctica, todo acotado a la farmacia
 * seleccionada. A diferencia de MiFarmaciaScreen, aquí SÍ se muestran
 * precios/costos — es exclusiva de ADMIN (ver VISTAS_POR_ROL en
 * App.tsx), así que reutiliza directamente obtenerValorizacionInventario()
 * en vez de v_stock_farmacia.
 */

const formatoMoneda = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const formatoEntero = new Intl.NumberFormat('es-MX')

const formatoFechaHora = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

function hoyIso(): string {
  return fechaAIso(new Date())
}

function fechaHaceNDias(n: number): string {
  const fecha = new Date()
  fecha.setDate(fecha.getDate() - n)
  return fechaAIso(fecha)
}

export function GestionFarmaciasScreen() {
  const ubicacionesRes = useApiResult(() => obtenerUbicaciones(), [])
  const [farmaciaId, setFarmaciaId] = useState('')

  const farmacias = ubicacionesRes.fase === 'listo' ? ubicacionesRes.data.filter((u) => u.tipo === 'FARMACIA') : []
  const farmaciaSeleccionada = farmacias.find((f) => f.id === farmaciaId) ?? farmacias[0]
  const idEfectivo = farmaciaSeleccionada?.id ?? ''

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Gestión y Analítica de Farmacias</h1>
          <p className="mt-0.5 text-sm text-text-muted">
            Audita el subinventario, valorización y consumo de cada farmacia de forma individual.
          </p>
        </div>

        {ubicacionesRes.fase === 'listo' && (
          <select
            value={idEfectivo}
            onChange={(e) => setFarmaciaId(e.target.value)}
            className="w-full max-w-xs rounded-md border border-border bg-canvas-card px-3 py-2 text-sm focus:border-accent focus:outline-none sm:w-auto"
          >
            {farmacias.length === 0 && <option value="">Sin farmacias registradas</option>}
            {farmacias.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nombre}
              </option>
            ))}
          </select>
        )}
      </div>

      {ubicacionesRes.fase === 'cargando' && (
        <div className="py-8 text-center text-sm text-text-muted animate-pulse">Cargando farmacias...</div>
      )}

      {ubicacionesRes.fase === 'error' && (
        <div className="rounded-md bg-status-critico-soft p-4 text-sm text-status-critico">
          {ubicacionesRes.error.message}
        </div>
      )}

      {ubicacionesRes.fase === 'listo' && farmacias.length === 0 && (
        <div className="rounded-md bg-status-ok-soft px-4 py-6 text-center text-sm text-status-ok">
          Todavía no hay ubicaciones marcadas como farmacia (tipo = 'FARMACIA').
        </div>
      )}

      {ubicacionesRes.fase === 'listo' && farmaciaSeleccionada && (
        <PanelFarmacia key={idEfectivo} ubicacionId={idEfectivo} codigoUbicacion={farmaciaSeleccionada.codigo} />
      )}
    </div>
  )
}

function PanelFarmacia({ ubicacionId, codigoUbicacion }: { ubicacionId: string; codigoUbicacion: string }) {
  const [fechaInicio, setFechaInicio] = useState(fechaHaceNDias(30))
  const [fechaFin, setFechaFin] = useState(hoyIso())

  const valorizacion = useApiResult(() => obtenerValorizacionInventario(ubicacionId), [ubicacionId])
  const reposicion = useApiResult(() => obtenerAnalisisReposicion(), [])
  const consumo = useApiResult(
    () => obtenerConsumoPracticas({ ubicacionId, fechaInicio, fechaFin }),
    [ubicacionId, fechaInicio, fechaFin],
  )

  const alertasLocales = useMemo(() => {
    if (reposicion.fase !== 'listo') return 0
    return reposicion.data.filter((f) => f.codigo_ubicacion === codigoUbicacion).length
  }, [reposicion, codigoUbicacion])

  return (
    <div className="space-y-6">
      <SeccionKpis valorizacion={valorizacion} alertasLocales={alertasLocales} reposicionFase={reposicion.fase} />

      <section className="rounded-lg border border-border bg-canvas-card p-5">
        <h2 className="mb-4 text-base font-semibold text-text-primary">Existencias valorizadas</h2>
        <TablaValorizacion estado={valorizacion} />
      </section>

      <section className="rounded-lg border border-border bg-canvas-card p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-text-primary">Historial de consumo por práctica</h2>
            <p className="mt-1 text-sm text-text-muted">Bajas registradas por alumno/matrícula o bitácora.</p>
          </div>
          <DateRangePicker
            fechaInicio={fechaInicio}
            fechaFin={fechaFin}
            onChange={(rango) => {
              setFechaInicio(rango.fechaInicio ?? fechaHaceNDias(30))
              setFechaFin(rango.fechaFin ?? hoyIso())
            }}
          />
        </div>
        <TablaConsumoPracticas estado={consumo} />
      </section>
    </div>
  )
}

// ------------------------------------------------------------------
// KPIs
// ------------------------------------------------------------------

function SeccionKpis({
  valorizacion,
  alertasLocales,
  reposicionFase,
}: {
  valorizacion: EstadoValorizacion
  alertasLocales: number
  reposicionFase: 'cargando' | 'error' | 'listo'
}) {
  if (valorizacion.fase === 'cargando') {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border border-border bg-canvas-card p-5">
            <div className="h-3 w-28 animate-pulse rounded bg-border" />
            <div className="mt-3 h-7 w-20 animate-pulse rounded bg-border" />
          </div>
        ))}
      </div>
    )
  }

  if (valorizacion.fase === 'error') {
    return (
      <div className="rounded-md bg-status-critico-soft p-4 text-sm text-status-critico">
        {valorizacion.error.message}
      </div>
    )
  }

  const filas = valorizacion.data
  const valorTotal = filas.reduce((acc, f) => acc + (f.valor_total ?? 0), 0)
  const productosActivos = filas.filter((f) => f.estado === 'ACTIVO').length
  const piezasTotales = filas.reduce((acc, f) => acc + (f.cantidad_actual ?? 0), 0)

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <TarjetaKpi etiqueta="Valor total del subinventario" valor={formatoMoneda.format(valorTotal)} />
      <TarjetaKpi etiqueta="Productos activos" valor={formatoEntero.format(productosActivos)} />
      <TarjetaKpi etiqueta="Piezas totales" valor={formatoEntero.format(piezasTotales)} />
      <TarjetaKpi
        etiqueta="Alertas de stock mínimo local"
        valor={reposicionFase === 'listo' ? formatoEntero.format(alertasLocales) : '—'}
        tono={alertasLocales > 0 ? 'critico' : undefined}
      />
    </div>
  )
}

function TarjetaKpi({ etiqueta, valor, tono }: { etiqueta: string; valor: string; tono?: 'critico' }) {
  return (
    <div className="rounded-lg border border-border bg-canvas-card p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{etiqueta}</p>
      <p className={`mt-2 text-2xl font-semibold ${tono === 'critico' ? 'text-status-critico' : 'text-text-primary'}`}>
        {valor}
      </p>
    </div>
  )
}

// ------------------------------------------------------------------
// Tabla de existencias valorizadas
// ------------------------------------------------------------------

function TablaValorizacion({ estado }: { estado: EstadoValorizacion }) {
  if (estado.fase === 'cargando') {
    return <div className="h-40 animate-pulse rounded-md bg-canvas" />
  }

  if (estado.fase === 'error') {
    return (
      <div className="rounded-md bg-status-critico-soft p-4 text-sm text-status-critico">
        {estado.error.message}
      </div>
    )
  }

  if (estado.data.length === 0) {
    return (
      <div className="rounded-md bg-status-ok-soft px-4 py-6 text-center text-sm text-status-ok">
        Esta farmacia todavía no tiene existencias registradas.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wide text-text-muted">
            <th className="px-3 py-2 font-medium">Insumo</th>
            <th className="px-3 py-2 font-medium">Categoría</th>
            <th className="px-3 py-2 font-medium">Existencia</th>
            <th className="px-3 py-2 font-medium">Precio unitario</th>
            <th className="px-3 py-2 font-medium">Valor total</th>
            <th className="px-3 py-2 font-medium">Estado</th>
          </tr>
        </thead>
        <tbody>
          {estado.data.map((fila, i) => (
            <tr key={fila.codigo_barras ?? i} className="border-b border-border last:border-0">
              <td className="px-3 py-2.5">
                <p className="font-medium text-text-primary">{fila.concepto}</p>
                <p className="text-xs text-text-muted">{fila.codigo_barras}</p>
              </td>
              <td className="px-3 py-2.5 text-text-muted">{fila.categoria ?? '—'}</td>
              <td className="px-3 py-2.5 text-text-primary">{fila.cantidad_actual ?? 0}</td>
              <td className="px-3 py-2.5 text-text-muted">
                {fila.precio_unitario != null ? formatoMoneda.format(fila.precio_unitario) : '—'}
              </td>
              <td className="px-3 py-2.5 font-semibold text-text-primary">
                {formatoMoneda.format(fila.valor_total ?? 0)}
              </td>
              <td className="px-3 py-2.5">
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide ${
                    fila.estado === 'ACTIVO' ? 'text-status-ok' : 'text-text-muted'
                  }`}
                >
                  {fila.estado}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ------------------------------------------------------------------
// Tabla de consumo por práctica
// ------------------------------------------------------------------

function TablaConsumoPracticas({ estado }: { estado: EstadoConsumo }) {
  if (estado.fase === 'cargando') {
    return <div className="h-40 animate-pulse rounded-md bg-canvas" />
  }

  if (estado.fase === 'error') {
    return (
      <div className="rounded-md bg-status-critico-soft p-4 text-sm text-status-critico">
        {estado.error.message}
      </div>
    )
  }

  if (estado.data.length === 0) {
    return (
      <div className="rounded-md bg-status-ok-soft px-4 py-6 text-center text-sm text-status-ok">
        No hay bajas por práctica registradas en el rango seleccionado.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wide text-text-muted">
            <th className="px-3 py-2 font-medium">Fecha</th>
            <th className="px-3 py-2 font-medium">Insumo</th>
            <th className="px-3 py-2 font-medium">Cantidad</th>
            <th className="px-3 py-2 font-medium">Alumno / Bitácora</th>
            <th className="px-3 py-2 font-medium">Registrado por</th>
          </tr>
        </thead>
        <tbody>
          {estado.data.map((fila) => (
            <tr key={fila.id} className="border-b border-border last:border-0">
              <td className="px-3 py-2.5 text-text-muted">
                {fila.created_at ? formatoFechaHora.format(new Date(fila.created_at)) : '—'}
              </td>
              <td className="px-3 py-2.5">
                <p className="font-medium text-text-primary">{fila.concepto}</p>
                <p className="text-xs text-text-muted">{fila.codigo_barras}</p>
              </td>
              <td className="px-3 py-2.5 text-text-primary">{fila.cantidad}</td>
              <td className="px-3 py-2.5 text-text-primary">{fila.alumno_referencia ?? '—'}</td>
              <td className="px-3 py-2.5 text-text-muted">{fila.registrado_por ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
