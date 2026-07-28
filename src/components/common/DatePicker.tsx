import { DayPicker } from 'react-day-picker'
import { es } from 'react-day-picker/locale'
import { fechaAIso, isoAFecha } from '../../lib/fechas'
import { CLASES_CALENDARIO, usePopover } from './calendarioBase'

/**
 * src/components/common/DatePicker.tsx
 *
 * Reemplazo estandarizado de <input type="date">, en toda la app: un
 * botón con la fecha formateada que abre un calendario emergente
 * (react-day-picker) al hacer click. El valor viaja como string
 * 'YYYY-MM-DD' | null — el mismo formato que ya esperan
 * normalizarInicioDeDia()/normalizarFinDeDia() en src/api/reportes.ts
 * y los <input type="date"> que reemplaza, así que ReportesScreen no
 * necesita tocar su lógica de filtrado, solo el control visual.
 */

const formatoFecha = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

interface DatePickerProps {
  value: string | null
  onChange: (iso: string | null) => void
  placeholder?: string
  disabled?: boolean
  /** Deshabilita fechas posteriores a hoy — útil en filtros de "hasta". */
  maxHoy?: boolean
}

export function DatePicker({
  value,
  onChange,
  placeholder = 'Selecciona una fecha',
  disabled,
  maxHoy,
}: DatePickerProps) {
  const { abierto, setAbierto, contenedorRef } = usePopover<HTMLDivElement>()
  const seleccionado = value ? isoAFecha(value) : undefined

  return (
    <div ref={contenedorRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setAbierto((a) => !a)}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-canvas px-3 py-2 text-left text-sm text-text-primary focus:border-accent focus:outline-none disabled:opacity-60"
      >
        <span className={seleccionado ? 'text-text-primary' : 'text-text-muted'}>
          {seleccionado ? formatoFecha.format(seleccionado) : placeholder}
        </span>
        <IconoCalendario className="h-4 w-4 flex-shrink-0 text-text-muted" />
      </button>

      {abierto && (
        <div className="absolute z-20 mt-1 rounded-md border border-border bg-canvas-card p-3 shadow-lg">
          <DayPicker
            mode="single"
            locale={es}
            selected={seleccionado}
            onSelect={(fecha) => {
              onChange(fecha ? fechaAIso(fecha) : null)
              setAbierto(false)
            }}
            disabled={maxHoy ? { after: new Date() } : undefined}
            classNames={CLASES_CALENDARIO}
            showOutsideDays
          />
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange(null)
                setAbierto(false)
              }}
              className="mt-1 w-full rounded-md px-2 py-1.5 text-center text-xs font-medium text-text-muted hover:bg-canvas hover:text-text-primary"
            >
              Limpiar fecha
            </button>
          )}
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
