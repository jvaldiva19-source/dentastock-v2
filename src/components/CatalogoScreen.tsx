import { useState, useMemo, type FormEvent } from 'react'
import { useApiResult } from '../hooks/useApiResult'
import {
  obtenerProductos,
  obtenerCategorias,
  obtenerUbicaciones,
  crearProducto,
  actualizarProducto,
  type ProductoConCategoria,
} from '../api/catalogo'
import { obtenerStockPorUbicacion } from '../api/inventario'
import {
  BannerExito,
  BannerErrorFormulario,
} from './common/BannerFormulario'
import type { Categoria, TablesInsert, TablesUpdate, Enums } from '../types/database.types'

/**
 * src/components/CatalogoScreen.tsx
 *
 * Pantalla de administración del catálogo maestro de insumos. Solo
 * llega aquí el rol ADMIN — el guard de vista ya está en
 * App.tsx y en el menú de MainLayout — por lo tanto este componente
 * no necesita verificar rol ni pasar perfil: puede llamar a
 * crearProducto() / actualizarProducto() directamente y la RLS del
 * motor rechazará cualquier intento de un rol diferente antes de
 * que llegue a la base de datos.
 *
 * Patrón de refresh: el componente mantiene un contador `refreshKey`
 * que se pasa como dependencia a useApiResult. Incrementarlo después
 * de un CRUD exitoso dispara una nueva llamada a obtenerProductos()
 * sin necesidad de un store global ni de prop drilling.
 *
 * Patrón de reset de formulario: se usa un contador `claveFormulario`
 * como prop `key` de FormularioProducto. Incrementarlo después de una
 * creación exitosa desmonta y remonta el formulario con estado fresco
 * para la siguiente entrada rápida, más limpio que resetear 12+
 * variables de estado individuales.
 */

// ------------------------------------------------------------------
// Constantes de presentación
// ------------------------------------------------------------------

const LABELS_UNIDAD: Record<Enums<'unidad_medida'>, string> = {
  PIEZA: 'Pieza',
  CAJA: 'Caja',
  FRASCO: 'Frasco',
  AMPOLLETA: 'Ampolleta',
  SOBRE: 'Sobre',
  ROLLO: 'Rollo',
  KIT: 'Kit',
  LITRO: 'Litro',
  GRAMO: 'Gramo',
  MILILITRO: 'Mililitro',
}

const UNIDADES = Object.keys(LABELS_UNIDAD) as Enums<'unidad_medida'>[]

const formatoMoneda = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
})

// ------------------------------------------------------------------
// Tipos internos
// ------------------------------------------------------------------

type ModoFormulario = 'crear' | 'editar'

// ------------------------------------------------------------------
// Componente principal
// ------------------------------------------------------------------

export function CatalogoScreen() {
  const [refreshKey, setRefreshKey] = useState(0)
  const [claveFormulario, setClaveFormulario] = useState(0)
  const [modo, setModo] = useState<ModoFormulario | null>(null)
  const [productoEditando, setProductoEditando] = useState<ProductoConCategoria | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [ubicacionId, setUbicacionId] = useState('')

  const productos = useApiResult(() => obtenerProductos(), [refreshKey])
  const categorias = useApiResult(() => obtenerCategorias(), [])
  const ubicaciones = useApiResult(() => obtenerUbicaciones(), [])
  const stock = useApiResult(
    () => obtenerStockPorUbicacion(ubicacionId || undefined),
    [ubicacionId, refreshKey],
  )

  // Suma cantidad_actual por producto — con ubicación seleccionada hay
  // una sola fila por producto; sin selección (todas las ubicaciones)
  // puede haber varias filas del mismo producto que deben sumarse.
  const stockPorProducto = useMemo(() => {
    const mapa = new Map<string, number>()
    if (stock.fase === 'listo') {
      for (const fila of stock.data) {
        mapa.set(fila.producto_id, (mapa.get(fila.producto_id) ?? 0) + fila.cantidad_actual)
      }
    }
    return mapa
  }, [stock])

  function abrirCrear() {
    setProductoEditando(null)
    setClaveFormulario((k) => k + 1)
    setModo('crear')
  }

  function abrirEditar(producto: ProductoConCategoria) {
    setProductoEditando(producto)
    setClaveFormulario((k) => k + 1)
    setModo('editar')
  }

  function cerrar() {
    setModo(null)
    setProductoEditando(null)
  }

  function manejarGuardado(modoActual: ModoFormulario) {
    setRefreshKey((k) => k + 1)
    if (modoActual === 'editar') {
      // Cierra el formulario tras editar, para que el usuario pueda
      // ver inmediatamente el cambio reflejado en la tabla.
      cerrar()
    } else {
      // Modo crear: remonta el formulario con estado fresco para la
      // siguiente captura rápida, sin cerrar el panel.
      setClaveFormulario((k) => k + 1)
    }
  }

  const listaCategorias = categorias.fase === 'listo' ? categorias.data : []

  const productosFiltrados =
    productos.fase === 'listo'
      ? productos.data.filter((p) => {
          if (!busqueda.trim()) return true
          const q = busqueda.trim().toLowerCase()
          return (
            p.concepto.toLowerCase().includes(q) ||
            p.codigo_barras.toLowerCase().includes(q) ||
            (p.categoria?.nombre ?? '').toLowerCase().includes(q)
          )
        })
      : []

  return (
    <div className="space-y-6">
      {/* ---- Encabezado ---- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">
            Catálogo de Insumos
          </h1>
          {productos.fase === 'listo' && (
            <p className="mt-0.5 text-sm text-text-muted">
              {productos.data.length}{' '}
              {productos.data.length === 1 ? 'producto registrado' : 'productos registrados'}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={modo === 'crear' ? cerrar : abrirCrear}
          className={`self-start rounded-md px-5 py-2.5 text-sm font-semibold text-text-onink shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${
            modo === 'crear'
              ? 'bg-text-muted hover:opacity-80'
              : 'bg-accent hover:bg-accent-strong'
          }`}
        >
          {modo === 'crear' ? 'Cancelar nuevo' : '➕ Nuevo Insumo / Medicamento'}
        </button>
      </div>

      {/* ---- Formulario de creación / edición ---- */}
      {modo !== null && (
        <FormularioProducto
          key={claveFormulario}
          modo={modo}
          productoInicial={productoEditando}
          categorias={listaCategorias}
          onGuardado={manejarGuardado}
          onCancelar={cerrar}
        />
      )}

      {/* ---- Buscador + filtro de ubicación (para Stock actual) ---- */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre, código o categoría…"
          className="w-full max-w-md rounded-md border border-border bg-canvas-card px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <select
          value={ubicacionId}
          onChange={(e) => setUbicacionId(e.target.value)}
          className="w-full max-w-xs rounded-md border border-border bg-canvas-card px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <option value="">Stock: todas las ubicaciones</option>
          {ubicaciones.fase === 'listo' &&
            ubicaciones.data.map((u) => (
              <option key={u.id} value={u.id}>
                Stock: {u.nombre}
              </option>
            ))}
        </select>
      </div>

      {/* ---- Tabla ---- */}
      {productos.fase === 'cargando' && <FilaCargando />}

      {productos.fase === 'error' && (
        <div className="rounded-lg border border-status-critico bg-status-critico-soft p-4 text-sm text-status-critico">
          {productos.error.message}
          <button
            type="button"
            onClick={productos.recargar}
            className="ml-3 underline underline-offset-2"
          >
            Reintentar
          </button>
        </div>
      )}

      {productos.fase === 'listo' && (
        <div className="overflow-x-auto rounded-lg border border-border bg-canvas-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-text-muted">
                <th className="px-4 py-3 font-medium">Insumo</th>
                <th className="px-4 py-3 font-medium">Código</th>
                <th className="px-4 py-3 font-medium">Categoría</th>
                <th className="px-4 py-3 font-medium">U/M</th>
                <th className="px-4 py-3 font-medium">Costo</th>
                <th className="px-4 py-3 font-medium">Stock actual</th>
                <th className="px-4 py-3 font-medium">Mín / Reorden</th>
                <th className="px-4 py-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {productosFiltrados.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-8 text-center text-sm text-text-muted"
                  >
                    {busqueda
                      ? `Sin resultados para "${busqueda}".`
                      : 'El catálogo está vacío. Agrega el primer producto.'}
                  </td>
                </tr>
              ) : (
                productosFiltrados.map((p) => (
                  <FilaProducto
                    key={p.id}
                    producto={p}
                    stockActual={stockPorProducto.get(p.id) ?? 0}
                    editandoId={productoEditando?.id ?? null}
                    onEditar={abrirEditar}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------
// Fila de la tabla
// ------------------------------------------------------------------

function FilaProducto({
  producto,
  stockActual,
  editandoId,
  onEditar,
}: {
  producto: ProductoConCategoria
  stockActual: number
  editandoId: string | null
  onEditar: (p: ProductoConCategoria) => void
}) {
  const editandoEste = editandoId === producto.id
  return (
    <tr
      className={`border-b border-border last:border-0 transition-colors ${
        !producto.activo ? 'opacity-50' : ''
      } ${editandoEste ? 'bg-accent-soft' : 'hover:bg-canvas'}`}
    >
      <td className="px-4 py-3">
        <p className="font-medium text-text-primary">{producto.concepto}</p>
        {!producto.activo && (
          <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
            Inactivo
          </p>
        )}
      </td>
      <td className="px-4 py-3 font-mono text-xs text-text-muted">
        {producto.codigo_barras}
      </td>
      <td className="px-4 py-3 text-text-muted">
        {producto.categoria?.nombre ?? '—'}
      </td>
      <td className="px-4 py-3 text-text-muted">
        {LABELS_UNIDAD[producto.unidad_medida] ?? producto.unidad_medida ?? '—'}
      </td>
      <td className="px-4 py-3 text-text-primary">
        {producto.precio_sin_iva != null
          ? formatoMoneda.format(producto.precio_sin_iva)
          : '—'}
      </td>
      <td className="px-4 py-3 text-text-primary">{stockActual}</td>
      <td className="px-4 py-3">
        <span className="text-text-primary">{producto.stock_minimo}</span>
        <span className="mx-1 text-text-muted">/</span>
        <span className="text-text-primary">{producto.punto_reorden}</span>
      </td>
      <td className="px-4 py-3">
        <button
          type="button"
          onClick={() => onEditar(producto)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            editandoEste
              ? 'bg-accent text-text-onink'
              : 'border border-border text-text-muted hover:border-accent hover:text-accent'
          }`}
        >
          {editandoEste ? 'Editando' : 'Editar'}
        </button>
      </td>
    </tr>
  )
}

function FilaCargando() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-canvas-card">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex gap-4 border-b border-border px-4 py-3 last:border-0">
          <div className="h-4 w-48 animate-pulse rounded bg-canvas" />
          <div className="h-4 w-28 animate-pulse rounded bg-canvas" />
          <div className="h-4 w-20 animate-pulse rounded bg-canvas" />
          <div className="h-4 w-16 animate-pulse rounded bg-canvas" />
          <div className="ml-auto h-4 w-12 animate-pulse rounded bg-canvas" />
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------
// Formulario de creación / edición
// ------------------------------------------------------------------

interface FormularioProductoProps {
  modo: ModoFormulario
  productoInicial: ProductoConCategoria | null
  categorias: Categoria[]
  onGuardado: (modo: ModoFormulario) => void
  onCancelar: () => void
}

const claseLabel = 'mb-1.5 block text-xs font-medium text-text-muted'
const claseInput =
  'w-full rounded-md border border-border bg-canvas px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60'

function FormularioProducto({
  modo,
  productoInicial: p,
  categorias,
  onGuardado,
  onCancelar,
}: FormularioProductoProps) {
  const [codigoBarras, setCodigoBarras] = useState(p?.codigo_barras ?? '')
  const [concepto, setConcepto] = useState(p?.concepto ?? '')
  const [descripcion, setDescripcion] = useState(p?.descripcion ?? '')
  const [categoriaId, setCategoriaId] = useState(p?.categoria_id ?? '')
  const [unidadMedida, setUnidadMedida] = useState<Enums<'unidad_medida'>>(
    p?.unidad_medida ?? 'PIEZA',
  )
  const [precioSinIva, setPrecioSinIva] = useState(
    p?.precio_sin_iva != null ? String(p.precio_sin_iva) : '',
  )
  const [precioConIva, setPrecioConIva] = useState(
    p?.precio_con_iva != null ? String(p.precio_con_iva) : '',
  )
  const [stockMinimo, setStockMinimo] = useState(String(p?.stock_minimo ?? 5))
  const [puntoReorden, setPuntoReorden] = useState(String(p?.punto_reorden ?? 10))
  const [diasReorden, setDiasReorden] = useState(
    p?.dias_reorden != null ? String(p.dias_reorden) : '15',
  )
  const [requiereLote, setRequiereLote] = useState(p?.requiere_lote ?? false)
  const [activo, setActivo] = useState(p?.activo ?? true)

  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)

  /**
   * Calcula precio_sin_iva asumiendo IVA del 16% — la misma lógica
   * que usaba la versión original del sistema (`precio_con_iva / 1.16`).
   * Es un helper de conveniencia visible para el usuario, no una
   * operación silenciosa: el campo precio_sin_iva sigue siendo
   * editable de forma independiente.
   */
  function calcularSinIva() {
    const conIva = Number(precioConIva)
    if (!Number.isFinite(conIva) || conIva <= 0) return
    setPrecioSinIva(String(Math.round((conIva / 1.16) * 10000) / 10000))
  }

  async function manejarSubmit(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setError(null)
    setExito(null)

    const cantMinimo = Number(stockMinimo)
    const cantReorden = Number(puntoReorden)
    if (cantReorden < cantMinimo) {
      setError('El punto de reorden no puede ser menor al stock mínimo.')
      return
    }

    const payload = {
      codigo_barras: codigoBarras.trim().toUpperCase(),
      concepto: concepto.trim(),
      descripcion: descripcion.trim() || null,
      categoria_id: categoriaId || null,
      unidad_medida: unidadMedida,
      precio_sin_iva: precioSinIva ? Number(precioSinIva) : null,
      precio_con_iva: precioConIva ? Number(precioConIva) : null,
      stock_minimo: cantMinimo,
      punto_reorden: cantReorden,
      dias_reorden: diasReorden ? Number(diasReorden) : null,
      requiere_lote: requiereLote,
      activo,
    }

    setEnviando(true)

    const resultado =
      modo === 'crear'
        ? await crearProducto(payload as TablesInsert<'productos'>)
        : await actualizarProducto(p!.id, payload as TablesUpdate<'productos'>)

    setEnviando(false)

    if (!resultado.success) {
      // Los errores de CODIGO_DUPLICADO y CATEGORIA_INVALIDA ya vienen
      // traducidos a mensajes de negocio desde traducirErrorPostgrest()
      // en catalogo.ts — aquí simplemente los mostramos directamente
      // en el banner, sin necesidad de volver a inspeccionarlos.
      setError(resultado.error.message)
      return
    }

    setExito(
      modo === 'crear'
        ? `Producto "${payload.concepto}" creado exitosamente. El formulario está listo para el siguiente producto.`
        : `Producto "${payload.concepto}" actualizado correctamente.`,
    )

    onGuardado(modo)
  }

  return (
    <div className="rounded-lg border border-border bg-canvas-card p-6">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-base font-semibold text-text-primary">
          {modo === 'crear' ? 'Nuevo producto' : `Editando: ${p?.concepto}`}
        </h2>
        <button
          type="button"
          onClick={onCancelar}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Cancelar
        </button>
      </div>

      <form onSubmit={manejarSubmit} className="space-y-5">
        {exito && <BannerExito mensaje={exito} onCerrar={() => setExito(null)} />}
        {error && (
          <BannerErrorFormulario mensaje={error} onCerrar={() => setError(null)} />
        )}

        {/* Fila 1: Código + Nombre */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="cat-codigo" className={claseLabel}>
              Código de barras
            </label>
            <input
              id="cat-codigo"
              type="text"
              required
              value={codigoBarras}
              disabled={enviando || modo === 'editar'}
              onChange={(e) => setCodigoBarras(e.target.value)}
              className={`${claseInput} font-mono ${modo === 'editar' ? 'cursor-not-allowed bg-canvas opacity-70' : ''}`}
              placeholder="EAN-13 o código interno"
            />
            {modo === 'editar' && (
              <p className="mt-1 text-[10px] text-text-muted">
                El código no puede modificarse una vez registrado.
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="cat-concepto" className={claseLabel}>
              Nombre del insumo
            </label>
            <input
              id="cat-concepto"
              type="text"
              required
              value={concepto}
              disabled={enviando}
              onChange={(e) => setConcepto(e.target.value)}
              className={claseInput}
              placeholder="Nombre completo tal como aparece en reportes"
            />
          </div>
        </div>

        {/* Fila 2: Categoría + Unidad */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="cat-categoria" className={claseLabel}>
              Categoría
            </label>
            <select
              id="cat-categoria"
              value={categoriaId}
              disabled={enviando}
              onChange={(e) => setCategoriaId(e.target.value)}
              className={claseInput}
            >
              <option value="">Sin categoría</option>
              {categorias.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.nombre}
                  {cat.requiere_cadena_frio ? ' ❄' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="cat-unidad" className={claseLabel}>
              Unidad de medida
            </label>
            <select
              id="cat-unidad"
              value={unidadMedida}
              disabled={enviando}
              onChange={(e) =>
                setUnidadMedida(e.target.value as Enums<'unidad_medida'>)
              }
              className={claseInput}
            >
              {UNIDADES.map((u) => (
                <option key={u} value={u}>
                  {LABELS_UNIDAD[u]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Fila 3: Precios */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="cat-precio-iva" className={claseLabel.replace('mb-1.5 ', '')}>
                Precio con IVA
              </label>
            </div>
            <input
              id="cat-precio-iva"
              type="number"
              min={0}
              step={0.0001}
              value={precioConIva}
              disabled={enviando}
              onChange={(e) => setPrecioConIva(e.target.value)}
              className={claseInput}
              placeholder="0.00"
            />
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="cat-precio-sin" className={claseLabel.replace('mb-1.5 ', '')}>
                Precio sin IVA
              </label>
              <button
                type="button"
                onClick={calcularSinIva}
                disabled={!precioConIva || enviando}
                className="text-[10px] font-medium text-accent-strong underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Calcular (÷1.16)
              </button>
            </div>
            <input
              id="cat-precio-sin"
              type="number"
              min={0}
              step={0.0001}
              value={precioSinIva}
              disabled={enviando}
              onChange={(e) => setPrecioSinIva(e.target.value)}
              className={claseInput}
              placeholder="0.00"
            />
          </div>
        </div>

        {/* Fila 4: Stock mínimo + Punto de reorden + Días */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="cat-minimo" className={claseLabel}>
              Stock mínimo crítico
            </label>
            <input
              id="cat-minimo"
              type="number"
              min={0}
              step={1}
              value={stockMinimo}
              disabled={enviando}
              onChange={(e) => setStockMinimo(e.target.value)}
              className={claseInput}
            />
          </div>
          <div>
            <label htmlFor="cat-reorden" className={claseLabel}>
              Punto de reorden
            </label>
            <input
              id="cat-reorden"
              type="number"
              min={0}
              step={1}
              value={puntoReorden}
              disabled={enviando}
              onChange={(e) => setPuntoReorden(e.target.value)}
              className={claseInput}
            />
          </div>
          <div>
            <label htmlFor="cat-dias" className={claseLabel}>
              Días de reorden (lead time)
            </label>
            <input
              id="cat-dias"
              type="number"
              min={1}
              step={1}
              value={diasReorden}
              disabled={enviando}
              onChange={(e) => setDiasReorden(e.target.value)}
              className={claseInput}
              placeholder="15"
            />
          </div>
        </div>

        {/* Fila 5: Flags */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          {/* Requiere lote — sección destacada por importancia regulatoria */}
          <div
            className={`flex-1 rounded-md border p-4 transition-colors ${
              requiereLote
                ? 'border-accent bg-accent-soft'
                : 'border-border bg-canvas'
            }`}
          >
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={requiereLote}
                disabled={enviando}
                onChange={(e) => setRequiereLote(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded accent-accent"
              />
              <div>
                <p className={`text-sm font-medium ${requiereLote ? 'text-accent-strong' : 'text-text-primary'}`}>
                  Requiere trazabilidad por lote
                </p>
                {requiereLote ? (
                  <p className="mt-1 text-xs text-accent-strong">
                    Activo — las entradas de este producto pedirán número
                    de lote y fecha de caducidad (COFEPRIS). La selección de
                    lote para consumos seguirá política PEPS automática.
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-text-muted">
                    Activa para resinas, anestésicos, agujas y cualquier
                    insumo sujeto a trazabilidad biomédica por normativa
                    COFEPRIS.
                  </p>
                )}
              </div>
            </label>
          </div>

          {/* Activo */}
          <div className="flex-shrink-0 rounded-md border border-border bg-canvas p-4">
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={activo}
                disabled={enviando}
                onChange={(e) => setActivo(e.target.checked)}
                className="h-4 w-4 rounded accent-accent"
              />
              <div>
                <p className="text-sm font-medium text-text-primary">Producto activo</p>
                <p className="mt-0.5 text-xs text-text-muted">
                  {activo ? 'Visible y operable' : 'Oculto en formularios'}
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Descripción */}
        <div>
          <label htmlFor="cat-descripcion" className={claseLabel}>
            Descripción / especificaciones técnicas (opcional)
          </label>
          <textarea
            id="cat-descripcion"
            value={descripcion}
            disabled={enviando}
            onChange={(e) => setDescripcion(e.target.value)}
            rows={2}
            className={claseInput}
            placeholder="Concentración, presentación, fabricante, etc."
          />
        </div>

        {/* Botones */}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={enviando}
            className="rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-text-onink transition-colors hover:bg-accent-strong disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            {enviando
              ? 'Guardando…'
              : modo === 'crear'
                ? 'Crear producto'
                : 'Guardar cambios'}
          </button>
          <button
            type="button"
            onClick={onCancelar}
            disabled={enviando}
            className="rounded-md px-4 py-2.5 text-sm font-medium text-text-muted hover:text-text-primary disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  )
}