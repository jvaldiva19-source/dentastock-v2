import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProductoConCategoria } from '../../api/catalogo'

/**
 * src/components/common/ComboboxProducto.tsx
 *
 * Selector de producto con búsqueda incorporada, pensado para
 * reemplazar un <select> nativo cuando el catálogo tiene 1,778
 * insumos: desplazarse manualmente por un <select> de esa longitud no
 * es viable, así que este componente filtra en el cliente por nombre
 * (concepto) o código de barras a medida que se escribe, y limita la
 * lista visible a MAX_RESULTADOS para no montar miles de nodos DOM de
 * una sola vez.
 *
 * Es un combobox controlado por `value` (el id del producto) +
 * `onChange`, igual que un <select> normal, para que sea un reemplazo
 * directo en los formularios de MovimientosScreen.tsx sin tocar el
 * resto de la lógica del formulario.
 */

const MAX_RESULTADOS = 50

function etiquetaProducto(producto: ProductoConCategoria): string {
  return producto.codigo_barras
    ? `${producto.concepto} (${producto.codigo_barras})`
    : producto.concepto
}

interface ComboboxProductoProps {
  productos: ProductoConCategoria[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  required?: boolean
}

export function ComboboxProducto({
  productos,
  value,
  onChange,
  placeholder = 'Escribe para buscar por nombre o código...',
  required,
}: ComboboxProductoProps) {
  const [texto, setTexto] = useState('')
  const [abierto, setAbierto] = useState(false)
  const [indiceActivo, setIndiceActivo] = useState(0)
  const contenedorRef = useRef<HTMLDivElement>(null)
  const cierreDiferidoRef = useRef<number | null>(null)

  // Mantiene el texto visible sincronizado con la selección real
  // (por id) cada vez que cambia desde afuera — incluyendo el reset a
  // '' que hacen los formularios tras un submit exitoso.
  useEffect(() => {
    const seleccionado = productos.find((p) => p.id === value)
    setTexto(seleccionado ? etiquetaProducto(seleccionado) : '')
  }, [value, productos])

  useEffect(() => {
    return () => {
      if (cierreDiferidoRef.current !== null) {
        window.clearTimeout(cierreDiferidoRef.current)
      }
    }
  }, [])

  const filtrados = useMemo(() => {
    const consulta = texto.trim().toLowerCase()

    if (!consulta) {
      return productos.slice(0, MAX_RESULTADOS)
    }

    const coincidencias = productos.filter((p) => {
      const nombre = p.concepto.toLowerCase()
      const codigo = (p.codigo_barras ?? '').toLowerCase()
      return nombre.includes(consulta) || codigo.includes(consulta)
    })

    return coincidencias.slice(0, MAX_RESULTADOS)
  }, [productos, texto])

  function seleccionar(producto: ProductoConCategoria) {
    onChange(producto.id)
    setTexto(etiquetaProducto(producto))
    setAbierto(false)
  }

  function manejarFoco(e: React.FocusEvent<HTMLInputElement>) {
    setAbierto(true)
    setIndiceActivo(0)
    // Selecciona todo el texto para que la primera tecla reemplace el
    // nombre ya elegido en vez de tener que borrarlo manualmente.
    e.target.select()
  }

  function manejarBlur() {
    // Diferido: si el blur ocurre porque se hizo click en una opción de
    // la lista, ese click ya disparó seleccionar() vía onMouseDown antes
    // de que este timeout corra. Si no se seleccionó nada, se revierte
    // el texto libre a la última selección válida (o vacío).
    cierreDiferidoRef.current = window.setTimeout(() => {
      setAbierto(false)
      const seleccionado = productos.find((p) => p.id === value)
      setTexto(seleccionado ? etiquetaProducto(seleccionado) : '')
    }, 150)
  }

  function manejarTeclado(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setAbierto(true)
      setIndiceActivo((i) => Math.min(i + 1, filtrados.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndiceActivo((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (abierto && filtrados[indiceActivo]) {
        e.preventDefault()
        seleccionar(filtrados[indiceActivo])
      }
    } else if (e.key === 'Escape') {
      setAbierto(false)
    }
  }

  return (
    <div ref={contenedorRef} className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={abierto}
        aria-autocomplete="list"
        autoComplete="off"
        required={required}
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value)
          setAbierto(true)
          setIndiceActivo(0)
          if (value) onChange('')
        }}
        onFocus={manejarFoco}
        onBlur={manejarBlur}
        onKeyDown={manejarTeclado}
        placeholder={placeholder}
        className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm focus:border-accent focus:outline-none"
      />

      {abierto && (
        <div
          role="listbox"
          className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-canvas-card shadow-lg"
        >
          {filtrados.length === 0 && (
            <p className="px-3 py-2.5 text-sm text-text-muted">
              Ningún insumo coincide con la búsqueda.
            </p>
          )}

          {filtrados.map((producto, indice) => (
            <button
              key={producto.id}
              type="button"
              role="option"
              aria-selected={producto.id === value}
              onMouseDown={(e) => {
                // preventDefault evita que el input pierda el foco antes
                // de que se procese la selección — sin esto, el onBlur
                // diferido revertiría el texto antes de que este click
                // llegue a registrarse.
                e.preventDefault()
                seleccionar(producto)
              }}
              onMouseEnter={() => setIndiceActivo(indice)}
              className={`block w-full px-3 py-2 text-left text-sm ${
                indice === indiceActivo ? 'bg-accent-soft/40' : ''
              } ${producto.id === value ? 'font-semibold text-accent-strong' : 'text-text-primary'}`}
            >
              <span className="block">{producto.concepto}</span>
              {producto.codigo_barras && (
                <span className="block text-xs text-text-muted">{producto.codigo_barras}</span>
              )}
            </button>
          ))}

          {filtrados.length === MAX_RESULTADOS && (
            <p className="border-t border-border px-3 py-2 text-xs text-text-muted">
              Mostrando los primeros {MAX_RESULTADOS} resultados. Sigue escribiendo para acotar la búsqueda.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
