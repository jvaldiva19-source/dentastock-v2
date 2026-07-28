import { useState } from 'react'
import { DayPicker, type DateRange } from 'react-day-picker'
import { es } from 'react-day-picker/locale'
import { fechaAIso, isoAFecha } from '../../lib/fechas'
import { CLASES_CALENDARIO, usePopover } from './calendarioBase'

/**
 * src/components/common/DateRangePicker.tsx
 *
 * Contraparte de rango de DatePicker.tsx: un solo botón disparador que
 * muestra "Desde — Hasta" y abre un calendario de dos meses en modo
 * `range`. Se usa en los reportes de Consumo por Áreas y Finanzas
 * (donde Desde/Hasta siempre se capturan juntos) y en los filtros
 * globales de la pestaña Analítica del Dashboard.
 *
 * A diferencia de DatePicker (que cierra al elegir un solo día), aquí
 * el popover permanece abierto tras elegir el primer extremo del rango
 * — el usuario necesita seguir viendo el calendario para elegir el
 * segundo — y solo se cierra con el botón "Aplicar", con "Limpiar" o
 * al hacer click afuera.
 */

const formatoCorto = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short' })
const formatoConAnio = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

interface DateRangePickerProps {
  fechaInicio: string | null
  fechaFin: string | null
  onChange: (rango: { fechaInicio: string | null; fechaFin: string | null }) => void
  placeholder?: string
  disabled?: boolean
}

export function DateRangePicker({
  fechaInicio,
  fechaFin,
  onChange,
  placeholder = 'Selecciona un rango de fechas',
  disabled,
}: DateRangePickerProps) {
  const { abierto, setAbierto, contenedorRef } = usePopover<HTMLDivElement>()

  const rangoConfirmado: DateRange | undefined =
    fechaInicio || fechaFin
      ? {
          from: fechaInicio ? isoAFecha(fechaInicio) : undefined,
          to: fechaFin ? isoAFecha(fechaFin) : undefined,
        }
      : undefined

  // Borrador local: permite elegir "desde" y "hasta" sin disparar
  // onChange (y por lo tanto refetch) en cada click — solo se
  // confirma al presionar "Aplicar".
  const [borrador, setBorrador] = useState<DateRange | undefined>(rangoConfirmado)

  function abrir() {
    setBorrador(rangoConfirmado)
    setAbierto((a) => !a)
  }

  function aplicar() {
    onChange({
      fechaInicio: borrador?.from ? fechaAIso(borrador.from) : null,
      fechaFin: borrador?.to ? fechaAIso(borrador.to) : null,
    })
    setAbierto(false)
  }

  function limpiar() {
    setBorrador(undefined)
    onChange({ fechaInicio: null, fechaFin: null })
    setAbierto(false)
  }

  const etiqueta =
    fechaInicio && fechaFin
      ? `${formatoCorto.format(isoAFecha(fechaInicio))} — ${formatoConAnio.format(isoAFecha(fechaFin))}`
      : fechaInicio
        ? `Desde ${formatoConAnio.format(isoAFecha(fechaInicio))}`
        : fechaFin
          ? `Hasta ${formatoConAnio.format(isoAFecha(fechaFin))}`
          : placeholder

  return (
    <div ref={contenedorRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={abrir}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-canvas px-3 py-2 text-left text-sm text-text-primary focus:border-accent focus:outline-none disabled:opacity-60"
      >
        <span className={fechaInicio || fechaFin ? 'text-text-primary' : 'text-text-muted'}>
          {etiqueta}
        </span>
        <IconoCalendario className="h-4 w-4 flex-shrink-0 text-text-muted" />
      </button>

      {abierto && (
        <div className="absolute z-20 mt-1 rounded-md border border-border bg-canvas-card p-3 shadow-lg">
          <DayPicker
            mode="range"
            locale={es}
            numberOfMonths={2}
            selected={borrador}
            onSelect={setBorrador}
            disabled={{ after: new Date() }}
            classNames={CLASES_CALENDARIO}
            showOutsideDays
          />
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
            <button
              type="button"
              onClick={limpiar}
              className="rounded-md px-2 py-1.5 text-xs font-medium text-text-muted hover:bg-canvas hover:text-text-primary"
            >
              Limpiar
            </button>
            <button
              type="button"
              onClick={aplicar}
              disabled={!borrador?.from || !borrador?.to}
              className="rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-text-onink hover:bg-accent-strong disabled:opacity-50"
            >
              Aplicar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function IconoCalendario({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="3" y="4.5" width="14" height="12.5" rx="1.5" />
      <path d="M3 8.5h14" />
      <path d="M6.5 2.5v4" />
      <path d="M13.5 2.5v4" />
    </svg>
  )
}
