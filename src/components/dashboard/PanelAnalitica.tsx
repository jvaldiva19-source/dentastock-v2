import { useMemo, useState, type ReactNode } from 'react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LabelList,
} from 'recharts'
import { useApiResult } from '../../hooks/useApiResult'
import { obtenerProductos, obtenerUbicaciones } from '../../api/catalogo'
import { obtenerUsuarios } from '../../api/usuarios'
import {
  obtenerFlujoMovimientos,
  obtenerConsumoPorAreas,
  obtenerMetricasPorUsuario,
  type FiltroAnalitico,
  type FilaConsumoPorArea,
} from '../../api/reportes'
import { ComboboxProducto } from '../common/ComboboxProducto'
import { DateRangePicker } from '../common/DateRangePicker'
import { fechaAIso } from '../../lib/fechas'

/**
 * src/components/dashboard/PanelAnalitica.tsx
 *
 * Pestaña "Analítica" del Dashboard: filtros globales (rango de
 * fecha, producto, área, usuario) que alimentan tres gráficas
 * recharts en paralelo. Paleta categórica y reglas de accesibilidad
 * siguiendo la skill dataviz del entorno — azul/naranja (slots 1-2 de
 * la paleta validada) para pares de dos series, ambos con ΔE de CVD
 * por encima del piso de 8 contra el fondo blanco de DentaStock
 * (validado con scripts/validate_palette.js antes de escribir este
 * archivo). Cada gráfica incluye una alternancia a tabla, para no
 * depender únicamente del color como canal de información.
 */

const COLOR_SERIE_1 = '#2a78d6' // Entradas / Consumo clínico / serie única
const COLOR_SERIE_2 = '#eb6834' // Salidas / Merma por caducidad

const formatoMoneda = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const formatoEntero = new Intl.NumberFormat('es-MX')

function hoyIso(): string {
  return fechaAIso(new Date())
}

function fechaHaceNDias(n: number): string {
  const fecha = new Date()
  fecha.setDate(fecha.getDate() - n)
  return fechaAIso(fecha)
}

function formatearPeriodo(periodo: string): string {
  // 'YYYY-MM-DD' (bucket diario) o 'YYYY-MM' (bucket mensual, rangos largos)
  if (periodo.length === 10) {
    const [, m, d] = periodo.split('-')
    return `${d}/${m}`
  }
  const [y, m] = periodo.split('-')
  const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  return `${MESES_CORTOS[Number(m) - 1]} ${y}`
}

export function PanelAnalitica() {
  const [fechaInicio, setFechaInicio] = useState(fechaHaceNDias(30))
  const [fechaFin, setFechaFin] = useState(hoyIso())
  const [productoId, setProductoId] = useState('')
  const [ubicacionId, setUbicacionId] = useState('')
  const [usuarioId, setUsuarioId] = useState('')

  const productosRes = useApiResult(() => obtenerProductos(), [])
  const ubicacionesRes = useApiResult(() => obtenerUbicaciones(), [])
  const usuariosRes = useApiResult(() => obtenerUsuarios(), [])

  const filtro: FiltroAnalitico = {
    fechaInicio,
    fechaFin,
    productoId: productoId || undefined,
    ubicacionId: ubicacionId || undefined,
    usuarioId: usuarioId || undefined,
  }

  const deps = [fechaInicio, fechaFin, productoId, ubicacionId, usuarioId]

  const flujo = useApiResult(() => obtenerFlujoMovimientos(filtro), deps)
  const consumo = useApiResult(
    () =>
      obtenerConsumoPorAreas(fechaInicio, fechaFin, {
        productoId: productoId || undefined,
        usuarioId: usuarioId || undefined,
        ubicacionId: ubicacionId || undefined,
      }),
    deps,
  )
  const metricas = useApiResult(() => obtenerMetricasPorUsuario(filtro), deps)

  return (
    <div className="space-y-6">
      {/* ---- Filtros globales — una sola fila encima de las gráficas ---- */}
      <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-canvas-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-muted">Rango de fecha</label>
          <DateRangePicker
            fechaInicio={fechaInicio}
            fechaFin={fechaFin}
            onChange={(rango) => {
              setFechaInicio(rango.fechaInicio ?? fechaHaceNDias(30))
              setFechaFin(rango.fechaFin ?? hoyIso())
            }}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-muted">Producto</label>
          <ComboboxProducto
            productos={productosRes.fase === 'listo' ? productosRes.data : []}
            value={productoId}
            onChange={setProductoId}
            placeholder="Todos los productos"
          />
        </div>
        <div>
          <label htmlFor="analitica-area" className="mb-1 block text-xs font-medium text-text-muted">
            Área
          </label>
          <select
            id="analitica-area"
            value={ubicacionId}
            onChange={(e) => setUbicacionId(e.target.value)}
            className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm focus:border-accent focus:outline-none"
          >
            <option value="">Todas las áreas</option>
            {(ubicacionesRes.fase === 'listo' ? ubicacionesRes.data : []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="analitica-usuario" className="mb-1 block text-xs font-medium text-text-muted">
            Usuario
          </label>
          <select
            id="analitica-usuario"
            value={usuarioId}
            onChange={(e) => setUsuarioId(e.target.value)}
            className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm focus:border-accent focus:outline-none"
          >
            <option value="">Todos los usuarios</option>
            {(usuariosRes.fase === 'listo' ? usuariosRes.data.filter((u) => u.activo) : []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre_completo ?? u.nombre_usuario}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ---- 1. Flujo de Movimientos ---- */}
      <PanelGrafica titulo="Flujo de Movimientos" subtitulo="Entradas vs. salidas del sistema en el tiempo.">
        {flujo.fase === 'cargando' && <CargandoGrafica />}
        {flujo.fase === 'error' && <ErrorGrafica mensaje={flujo.error.message} onReintentar={flujo.recargar} />}
        {flujo.fase === 'listo' && flujo.data.length === 0 && (
          <SinDatos mensaje="No hay movimientos en el rango y filtros seleccionados." />
        )}
        {flujo.fase === 'listo' && flujo.data.length > 0 && (
          <VistaGraficaOTabla
            tabla={
              <TablaSimple
                columnas={['Periodo', 'Entradas', 'Salidas']}
                filas={flujo.data.map((f) => [
                  formatearPeriodo(f.periodo),
                  formatoEntero.format(f.entradas),
                  formatoEntero.format(f.salidas),
                ])}
              />
            }
          >
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={flujo.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e3e1d8" vertical={false} />
                <XAxis
                  dataKey="periodo"
                  tickFormatter={formatearPeriodo}
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  axisLine={{ stroke: '#e3e1d8' }}
                  tickLine={false}
                />
                <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} width={40} />
                <Tooltip
                  labelFormatter={(v: unknown) => formatearPeriodo(String(v))}
                  formatter={(valor) => formatoEntero.format(Number(valor))}
                  contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: '#e3e1d8' }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area
                  type="monotone"
                  dataKey="entradas"
                  name="Entradas"
                  stroke={COLOR_SERIE_1}
                  fill={COLOR_SERIE_1}
                  fillOpacity={0.15}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="salidas"
                  name="Salidas"
                  stroke={COLOR_SERIE_2}
                  fill={COLOR_SERIE_2}
                  fillOpacity={0.15}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </VistaGraficaOTabla>
        )}
      </PanelGrafica>

      {/* ---- 2. Consumo por Áreas Clínicas ---- */}
      <PanelGrafica
        titulo="Consumo por Áreas Clínicas"
        subtitulo="Consumo clínico vs. merma por caducidad, valorizado por área."
      >
        {consumo.fase === 'cargando' && <CargandoGrafica />}
        {consumo.fase === 'error' && <ErrorGrafica mensaje={consumo.error.message} onReintentar={consumo.recargar} />}
        {consumo.fase === 'listo' && consumo.data.length === 0 && (
          <SinDatos mensaje="No hay consumo ni merma registrados en el rango y filtros seleccionados." />
        )}
        {consumo.fase === 'listo' && consumo.data.length > 0 && (
          <PanelConsumoPorAreasGrafica filas={consumo.data} />
        )}
      </PanelGrafica>

      {/* ---- 3. Métricas por Personal ---- */}
      <PanelGrafica
        titulo="Métricas por Personal"
        subtitulo="Volumen de movimientos registrados por usuario/operador."
      >
        {metricas.fase === 'cargando' && <CargandoGrafica />}
        {metricas.fase === 'error' && (
          <ErrorGrafica mensaje={metricas.error.message} onReintentar={metricas.recargar} />
        )}
        {metricas.fase === 'listo' && metricas.data.length === 0 && (
          <SinDatos mensaje="No hay actividad registrada en el rango y filtros seleccionados." />
        )}
        {metricas.fase === 'listo' && metricas.data.length > 0 && (
          <VistaGraficaOTabla
            tabla={
              <TablaSimple
                columnas={['Usuario', 'Movimientos', 'Valor total']}
                filas={metricas.data.map((f) => [
                  f.usuario,
                  formatoEntero.format(f.totalMovimientos),
                  formatoMoneda.format(f.valorTotal),
                ])}
              />
            }
          >
            <ResponsiveContainer width="100%" height={Math.max(220, metricas.data.slice(0, 10).length * 42)}>
              <BarChart
                data={metricas.data.slice(0, 10)}
                layout="vertical"
                margin={{ top: 8, right: 36, left: 8, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e3e1d8" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="usuario"
                  width={110}
                  tick={{ fontSize: 11, fill: '#1b2430' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(valor) => formatoEntero.format(Number(valor))}
                  contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: '#e3e1d8' }}
                />
                <Bar dataKey="totalMovimientos" name="Movimientos" fill={COLOR_SERIE_1} radius={[0, 4, 4, 0]}>
                  <LabelList
                    dataKey="totalMovimientos"
                    position="right"
                    style={{ fontSize: 11, fill: '#1b2430' }}
                    formatter={(v) => formatoEntero.format(Number(v))}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </VistaGraficaOTabla>
        )}
      </PanelGrafica>
    </div>
  )
}

// ------------------------------------------------------------------
// Sub-gráfica de Consumo por Áreas — pivotea FilaConsumoPorArea[]
// (una fila por área×tipo) a una fila por área con dos series.
// ------------------------------------------------------------------

function PanelConsumoPorAreasGrafica({ filas }: { filas: FilaConsumoPorArea[] }) {
  const datos = useMemo(() => {
    const mapa = new Map<string, { area: string; consumo: number; merma: number }>()
    for (const fila of filas) {
      const existente = mapa.get(fila.ubicacion) ?? { area: fila.ubicacion, consumo: 0, merma: 0 }
      if (fila.tipo === 'CONSUMO') {
        existente.consumo += fila.valorTotal
      } else {
        existente.merma += fila.valorTotal
      }
      mapa.set(fila.ubicacion, existente)
    }
    return Array.from(mapa.values()).sort((a, b) => b.consumo + b.merma - (a.consumo + a.merma))
  }, [filas])

  return (
    <VistaGraficaOTabla
      tabla={
        <TablaSimple
          columnas={['Área', 'Consumo clínico', 'Merma por caducidad']}
          filas={datos.map((d) => [d.area, formatoMoneda.format(d.consumo), formatoMoneda.format(d.merma)])}
        />
      }
    >
      <ResponsiveContainer width="100%" height={Math.max(240, datos.length * 48)}>
        <BarChart data={datos} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e3e1d8" horizontal={false} />
          <XAxis
            type="number"
            tickFormatter={(v) => formatoMoneda.format(v)}
            tick={{ fontSize: 11, fill: '#6b7280' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="area"
            width={130}
            tick={{ fontSize: 11, fill: '#1b2430' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(valor) => formatoMoneda.format(Number(valor))}
            contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: '#e3e1d8' }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="consumo" name="Consumo clínico" fill={COLOR_SERIE_1} radius={[0, 4, 4, 0]} />
          <Bar dataKey="merma" name="Merma por caducidad" fill={COLOR_SERIE_2} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </VistaGraficaOTabla>
  )
}

// ------------------------------------------------------------------
// Bloques de presentación compartidos
// ------------------------------------------------------------------

function PanelGrafica({
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
        <h3 className="text-base font-semibold text-text-primary">{titulo}</h3>
        <p className="mt-1 text-sm text-text-muted">{subtitulo}</p>
      </div>
      {children}
    </section>
  )
}

/** Alterna entre la gráfica y una tabla equivalente — el canal accesible que no depende del color. */
function VistaGraficaOTabla({ children, tabla }: { children: ReactNode; tabla: ReactNode }) {
  const [comoTabla, setComoTabla] = useState(false)

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          onClick={() => setComoTabla((v) => !v)}
          className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text-muted hover:border-accent hover:text-accent"
        >
          {comoTabla ? 'Ver gráfica' : 'Ver tabla'}
        </button>
      </div>
      {comoTabla ? tabla : children}
    </div>
  )
}

function TablaSimple({ columnas, filas }: { columnas: string[]; filas: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wide text-text-muted">
            {columnas.map((c) => (
              <th key={c} className="px-3 py-2 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((fila, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              {fila.map((celda, j) => (
                <td key={j} className="px-3 py-2 text-text-primary">
                  {celda}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CargandoGrafica() {
  return <div className="h-64 animate-pulse rounded-md bg-canvas" />
}

function SinDatos({ mensaje }: { mensaje: string }) {
  return (
    <div className="rounded-md bg-status-ok-soft px-4 py-6 text-center text-sm text-status-ok">{mensaje}</div>
  )
}

function ErrorGrafica({ mensaje, onReintentar }: { mensaje: string; onReintentar: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-status-critico-soft px-4 py-3 text-sm text-status-critico">
      <span>{mensaje}</span>
      <button
        type="button"
        onClick={onReintentar}
        className="ml-4 flex-shrink-0 rounded-md border border-status-critico px-3 py-1 text-xs font-medium hover:bg-status-critico hover:text-text-onink"
      >
        Reintentar
      </button>
    </div>
  )
}
