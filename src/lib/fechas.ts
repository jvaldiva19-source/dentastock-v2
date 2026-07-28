/**
 * src/lib/fechas.ts
 *
 * Conversión Date <-> 'YYYY-MM-DD' compartida por DatePicker.tsx,
 * DateRangePicker.tsx y PanelAnalitica.tsx. Vive fuera de los
 * componentes (en vez de junto a DatePicker.tsx) porque un archivo que
 * exporta un componente de React y además exporta funciones sueltas
 * rompe el fast refresh de Vite — ver react-refresh/only-export-components.
 *
 * Se arma con año/mes/día locales (no `new Date(iso)`, que interpreta
 * la cadena como UTC medianoche y puede desplazar un día hacia atrás
 * en husos horarios negativos como México) para que el día mostrado
 * sea siempre el mismo que el seleccionado en el calendario.
 */

export function fechaAIso(fecha: Date): string {
  const y = fecha.getFullYear()
  const m = String(fecha.getMonth() + 1).padStart(2, '0')
  const d = String(fecha.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function isoAFecha(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}
