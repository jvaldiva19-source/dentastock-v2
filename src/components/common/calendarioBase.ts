import { useEffect, useRef, useState } from 'react'
import type { ClassNames } from 'react-day-picker'

/**
 * src/components/common/calendarioBase.ts
 *
 * Piezas compartidas entre DatePicker.tsx y DateRangePicker.tsx
 * (mapeo de clases a los tokens de DentaStock + hook de popover).
 * Separado de los componentes por la misma razón que
 * src/lib/fechas.ts: mezclar exports de componente y de utilidades en
 * un mismo archivo rompe el fast refresh de Vite.
 */

/**
 * Mapeo de clases de react-day-picker a los tokens de diseño de
 * DentaStock (src/index.css) — se pasa explícitamente en vez de
 * importar 'react-day-picker/style.css' para que el calendario nazca
 * ya integrado a la paleta de la app en lugar de necesitar overrides
 * posteriores.
 */
export const CLASES_CALENDARIO: Partial<ClassNames> = {
  root: 'text-sm',
  months: 'flex gap-4',
  month: 'space-y-3',
  month_caption: 'flex items-center justify-center px-8 pt-1 text-sm font-semibold text-text-primary',
  caption_label: 'text-sm font-semibold text-text-primary',
  nav: 'flex items-center justify-between absolute inset-x-0 top-0 px-1',
  button_previous:
    'rounded-md p-1 text-text-muted hover:bg-canvas hover:text-text-primary disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
  button_next:
    'rounded-md p-1 text-text-muted hover:bg-canvas hover:text-text-primary disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
  month_grid: 'w-full border-collapse',
  weekdays: 'flex',
  weekday: 'w-9 text-center text-xs font-medium uppercase text-text-muted',
  weeks: '',
  week: 'flex w-full mt-1',
  day: 'h-9 w-9 p-0 text-center text-sm',
  day_button:
    'h-9 w-9 rounded-md text-text-primary hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
  today: 'font-semibold text-accent-strong',
  selected: '',
  range_start: '[&>button]:bg-accent [&>button]:text-text-onink [&>button]:hover:bg-accent',
  range_end: '[&>button]:bg-accent [&>button]:text-text-onink [&>button]:hover:bg-accent',
  range_middle: '[&>button]:bg-accent-soft [&>button]:rounded-none',
  outside: 'text-text-muted/50',
  disabled: 'text-text-muted/30 line-through',
}

/** Popover genérico: botón disparador + panel flotante que se cierra al hacer click afuera. */
export function usePopover<T extends HTMLElement>() {
  const [abierto, setAbierto] = useState(false)
  const contenedorRef = useRef<T>(null)

  useEffect(() => {
    if (!abierto) return

    function manejarClickAfuera(e: MouseEvent) {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target as Node)) {
        setAbierto(false)
      }
    }

    document.addEventListener('mousedown', manejarClickAfuera)
    return () => document.removeEventListener('mousedown', manejarClickAfuera)
  }, [abierto])

  return { abierto, setAbierto, contenedorRef }
}
