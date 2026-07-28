import { useState, type ReactNode } from 'react'

/**
 * src/components/common/Tabs.tsx
 *
 * Pestañas genéricas con subrayado de acento — generaliza el patrón
 * que ya existía duplicado a mano en ReportesScreen.tsx (selector de
 * Kardex/Consumos) para que DashboardScreen.tsx lo reutilice sin
 * repetir el mismo marcado de botones + border-b.
 *
 * No controlado por defecto: si no se pasa `activo`/`onCambiar`, el
 * componente gestiona su propio estado interno a partir de
 * `pestanaInicial`. Se acepta control externo (activo + onCambiar)
 * para el caso en que un padre necesite conocer o forzar la pestaña
 * activa.
 */

export interface DefinicionPestana {
  id: string
  etiqueta: ReactNode
  contenido: ReactNode
}

interface TabsProps {
  pestanas: DefinicionPestana[]
  pestanaInicial?: string
  activo?: string
  onCambiar?: (id: string) => void
}

export function Tabs({ pestanas, pestanaInicial, activo, onCambiar }: TabsProps) {
  const [activoInterno, setActivoInterno] = useState(
    pestanaInicial ?? pestanas[0]?.id,
  )

  const activoActual = activo ?? activoInterno

  function seleccionar(id: string) {
    if (onCambiar) {
      onCambiar(id)
    } else {
      setActivoInterno(id)
    }
  }

  const pestanaActiva = pestanas.find((p) => p.id === activoActual)

  return (
    <div>
      <div role="tablist" className="flex flex-wrap gap-4 border-b border-border pb-px">
        {pestanas.map((pestana) => {
          const esActiva = pestana.id === activoActual
          return (
            <button
              key={pestana.id}
              type="button"
              role="tab"
              aria-selected={esActiva}
              onClick={() => seleccionar(pestana.id)}
              className={`border-b-2 px-1 pb-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                esActiva
                  ? 'border-accent font-semibold text-accent'
                  : 'border-transparent text-text-muted hover:text-text-primary'
              }`}
            >
              {pestana.etiqueta}
            </button>
          )
        })}
      </div>

      <div role="tabpanel" className="mt-6">
        {pestanaActiva?.contenido}
      </div>
    </div>
  )
}
