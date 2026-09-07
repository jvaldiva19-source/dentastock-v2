import { useState, useMemo, type FormEvent } from 'react'
import { useApiResult } from '../hooks/useApiResult'
import { obtenerStockFarmacia, obtenerDisponibilidadAlmacenCentral } from '../api/inventario'
import { obtenerProductos, obtenerUbicaciones, type ProductoConCategoria } from '../api/catalogo'
import { registrarTraspaso, registrarSalidaPractica } from '../api/movimientos'
import type { PerfilActual } from '../api/auth'
import { Tabs } from './common/Tabs'
import { ComboboxProducto } from './common/ComboboxProducto'
import { BannerExito, BannerErrorFormulario } from './common/BannerFormulario'
import type { StockFarmacia, DisponibilidadAlmacenCentral, Ubicacion } from '../types/database.types'

/**
 * src/components/MiFarmaciaScreen.tsx
 *
 * Pantalla única y dedicada para el rol ENCARGADO_FARMACIA — reemplaza
 * por completo el Dashboard/Movimientos genéricos para este rol (ver
 * VISTAS_POR_ROL en App.tsx). Es la única forma de garantizar que este
 * rol nunca vea costos ni dashboards financieros sin tocar la lógica de
 * DashboardScreen.tsx: en vez de ocultar campos dentro de esas
 * pantallas, este rol simplemente nunca llega a ellas.
 *
 * Cinco sub-flujos, exactamente los permitidos por el rol: ver su
 * subinventario, recibir traspasos desde Almacén Central, enviar
 * traspasos inter-sedes a otra farmacia activa, consultar existencias de
 * Almacén Central antes de solicitar material, y registrar bajas por
 * práctica/alumno. Ninguno consulta ni muestra precio/costo —
 * obtenerStockFarmacia() y obtenerDisponibilidadAlmacenCentral() usan
 * vistas que ni siquiera traen esas columnas, y ComboboxProducto se usa
 * siempre con mostrarPrecio={false} aquí.
 */

const CODIGO_ALMACEN_CENTRAL = 'ALM-CEN'

type SubSeccion = 'stock' | 'recibir' | 'enviar' | 'consultarCentral' | 'salida'

export function MiFarmaciaScreen({ perfil }: { perfil: PerfilActual }) {
  const [subSeccion, setSubSeccion] = useState<SubSeccion>('stock')

  if (!perfil.ubicacionId) {
    return (
      <PanelErrorCritico mensaje="Tu cuenta no tiene una ubicación de farmacia asignada. Contacta al administrador para que la configure antes de continuar." />
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Mi Farmacia</h1>
        <p className="mt-0.5 text-sm text-text-muted">
          Subinventario, recepción de traspasos y bajas por práctica de tu sede.
        </p>
      </div>

      <Tabs
        activo={subSeccion}
        onCambiar={(id) => setSubSeccion(id as SubSeccion)}
        pestanas={[
          { id: 'stock', etiqueta: 'Mi Stock', contenido: <SeccionMiStock ubicacionId={perfil.ubicacionId} /> },
          {
            id: 'recibir',
            etiqueta: 'Recibir Traspaso',
            contenido: <SeccionRecibirTraspaso perfil={perfil} ubicacionId={perfil.ubicacionId} />,
          },
          {
            id: 'enviar',
            etiqueta: 'Traspaso a otra Área/Farmacia',
            contenido: <SeccionEnviarTraspaso perfil={perfil} ubicacionId={perfil.ubicacionId} />,
          },
          {
            id: 'consultarCentral',
            etiqueta: 'Consultar Almacén Central',
            contenido: <SeccionConsultarAlmacenCentral />,
          },
          {
            id: 'salida',
            etiqueta: 'Salida por Práctica',
            contenido: <SeccionSalidaPractica perfil={perfil} ubicacionId={perfil.ubicacionId} />,
          },
        ]}
      />
    </div>
  )
}

function PanelErrorCritico({ mensaje }: { mensaje: string }) {
  return (
    <div className="rounded-md bg-status-critico-soft p-4 text-sm text-status-critico">{mensaje}</div>
  )
}

// ------------------------------------------------------------------
// Sección: Mi Stock
// ------------------------------------------------------------------

function SeccionMiStock({ ubicacionId }: { ubicacionId: string }) {
  const stock = useApiResult(() => obtenerStockFarmacia(ubicacionId), [ubicacionId])

  if (stock.fase === 'cargando') {
    return <div className="py-8 text-center text-sm text-text-muted animate-pulse">Cargando stock...</div>
  }

  if (stock.fase === 'error') {
    return (
      <div className="flex items-center justify-between rounded-md bg-status-critico-soft px-4 py-3 text-sm text-status-critico">
        <span>{stock.error.message}</span>
        <button type="button" onClick={stock.recargar} className="ml-4 underline underline-offset-2">
          Reintentar
        </button>
      </div>
    )
  }

  if (stock.data.length === 0) {
    return (
      <div className="rounded-md bg-status-ok-soft px-4 py-6 text-center text-sm text-status-ok">
        Todavía no hay existencias registradas en tu farmacia. Recibe un traspaso desde Almacén Central para
        empezar.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-canvas-card">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wide text-text-muted">
            <th className="px-4 py-3 font-medium">Insumo</th>
            <th className="px-4 py-3 font-medium">Categoría</th>
            <th className="px-4 py-3 font-medium">Unidad</th>
            <th className="px-4 py-3 font-medium">Existencia</th>
            <th className="px-4 py-3 font-medium">Estado</th>
          </tr>
        </thead>
        <tbody>
          {stock.data.map((fila) => (
            <FilaStock key={fila.id} fila={fila} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FilaStock({ fila }: { fila: StockFarmacia }) {
  const cantidad = fila.cantidad_actual ?? 0
  const minimo = fila.stock_minimo ?? 0
  const reorden = fila.punto_reorden ?? 0

  const bajoMinimo = cantidad <= minimo
  const enReorden = !bajoMinimo && cantidad <= reorden

  const estilo = bajoMinimo
    ? { fila: 'bg-status-critico-soft', texto: 'text-status-critico', etiqueta: 'BAJO MÍNIMO' }
    : enReorden
      ? { fila: 'bg-status-reorden-soft', texto: 'text-status-reorden', etiqueta: 'PUNTO DE REORDEN' }
      : { fila: '', texto: 'text-status-ok', etiqueta: 'SALUDABLE' }

  return (
    <tr className={`border-b border-border last:border-0 ${estilo.fila}`}>
      <td className="px-4 py-3">
        <p className="font-medium text-text-primary">{fila.concepto}</p>
        <p className="text-xs text-text-muted">{fila.codigo_barras}</p>
      </td>
      <td className="px-4 py-3 text-text-muted">{fila.categoria ?? '—'}</td>
      <td className="px-4 py-3 text-text-muted">{fila.unidad_medida}</td>
      <td className={`px-4 py-3 font-semibold ${estilo.texto}`}>{cantidad}</td>
      <td className="px-4 py-3">
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide ${estilo.texto}`}>
          {estilo.etiqueta}
        </span>
      </td>
    </tr>
  )
}

// ------------------------------------------------------------------
// Sección: Recibir Traspaso
// ------------------------------------------------------------------

function SeccionRecibirTraspaso({ perfil, ubicacionId }: { perfil: PerfilActual; ubicacionId: string }) {
  const productosRes = useApiResult(() => obtenerProductos(), [])
  const ubicacionesRes = useApiResult(() => obtenerUbicaciones(), [])

  if (productosRes.fase === 'cargando' || ubicacionesRes.fase === 'cargando') {
    return <div className="py-8 text-center text-sm text-text-muted animate-pulse">Cargando catálogo...</div>
  }

  if (ubicacionesRes.fase === 'error') {
    return <PanelErrorCritico mensaje={ubicacionesRes.error.message} />
  }

  const almacenCentral = ubicacionesRes.data.find((u) => u.codigo === CODIGO_ALMACEN_CENTRAL)

  if (!almacenCentral) {
    return (
      <PanelErrorCritico mensaje={`No se encontró la ubicación de Almacén Central (código "${CODIGO_ALMACEN_CENTRAL}"). Verifica el catálogo de ubicaciones antes de recibir un traspaso.`} />
    )
  }

  return (
    <FormularioRecibirTraspaso
      productos={productosRes.fase === 'listo' ? productosRes.data : []}
      usuarioId={perfil.id}
      origenId={almacenCentral.id}
      origenNombre={almacenCentral.nombre}
      destinoId={ubicacionId}
    />
  )
}

function FormularioRecibirTraspaso({
  productos,
  usuarioId,
  origenId,
  origenNombre,
  destinoId,
}: {
  productos: ProductoConCategoria[]
  usuarioId: string
  origenId: string
  origenNombre: string
  destinoId: string
}) {
  const [productoId, setProductoId] = useState('')
  const [cantidad, setCantidad] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [exito, setExito] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function manejarSubmit(e: FormEvent) {
    e.preventDefault()
    setExito(null)
    setError(null)
    setEnviando(true)

    const res = await registrarTraspaso({
      productoId,
      ubicacionOrigenId: origenId,
      ubicacionDestinoId: destinoId,
      cantidad: Number(cantidad),
      usuarioId,
    })

    setEnviando(false)
    if (res.success) {
      setExito('Traspaso recibido con éxito. Tu stock ya quedó actualizado.')
      setProductoId('')
      setCantidad('')
    } else {
      setError(res.error.message)
    }
  }

  return (
    <form onSubmit={manejarSubmit} className="max-w-2xl space-y-4">
      <h3 className="border-b border-border pb-2 text-base font-semibold text-text-primary">
        Recepción de material desde {origenNombre}
      </h3>

      {exito && <BannerExito mensaje={exito} onCerrar={() => setExito(null)} />}
      {error && <BannerErrorFormulario mensaje={error} onCerrar={() => setError(null)} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="sm:col-span-3">
          <label className="mb-1 block text-xs font-medium text-text-muted">Insumo recibido</label>
          <ComboboxProducto
            productos={productos}
            value={productoId}
            onChange={setProductoId}
            required
            mostrarPrecio={false}
            placeholder="Busca el insumo por nombre o código..."
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-muted">Cantidad</label>
          <input
            type="number"
            required
            min="1"
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm focus:border-accent focus:outline-none"
            placeholder="0"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={enviando}
        className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-text-onink transition-colors hover:bg-accent-strong disabled:opacity-50"
      >
        {enviando ? 'Registrando recepción...' : 'Confirmar Recepción'}
      </button>
    </form>
  )
}

// ------------------------------------------------------------------
// Sección: Traspaso a otra Área/Farmacia (inter-sedes)
// ------------------------------------------------------------------

function SeccionEnviarTraspaso({ perfil, ubicacionId }: { perfil: PerfilActual; ubicacionId: string }) {
  const productosRes = useApiResult(() => obtenerProductos(), [])
  const ubicacionesRes = useApiResult(() => obtenerUbicaciones(), [])

  if (productosRes.fase === 'cargando' || ubicacionesRes.fase === 'cargando') {
    return <div className="py-8 text-center text-sm text-text-muted animate-pulse">Cargando catálogo...</div>
  }

  if (ubicacionesRes.fase === 'error') {
    return <PanelErrorCritico mensaje={ubicacionesRes.error.message} />
  }

  const otrasFarmacias = ubicacionesRes.data.filter(
    (u) => u.tipo === 'FARMACIA' && u.id !== ubicacionId,
  )

  return (
    <FormularioEnviarTraspaso
      productos={productosRes.fase === 'listo' ? productosRes.data : []}
      usuarioId={perfil.id}
      origenId={ubicacionId}
      destinos={otrasFarmacias}
    />
  )
}

function FormularioEnviarTraspaso({
  productos,
  usuarioId,
  origenId,
  destinos,
}: {
  productos: ProductoConCategoria[]
  usuarioId: string
  origenId: string
  destinos: Ubicacion[]
}) {
  const [productoId, setProductoId] = useState('')
  const [destinoId, setDestinoId] = useState('')
  const [cantidad, setCantidad] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [exito, setExito] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function manejarSubmit(e: FormEvent) {
    e.preventDefault()
    setExito(null)
    setError(null)
    setEnviando(true)

    const res = await registrarTraspaso({
      productoId,
      ubicacionOrigenId: origenId,
      ubicacionDestinoId: destinoId,
      cantidad: Number(cantidad),
      usuarioId,
    })

    setEnviando(false)
    if (res.success) {
      const nombreDestino = destinos.find((d) => d.id === destinoId)?.nombre ?? 'la sede seleccionada'
      setExito(`Traspaso enviado con éxito a ${nombreDestino}. Tu stock ya quedó actualizado.`)
      setProductoId('')
      setCantidad('')
      setDestinoId('')
    } else {
      setError(res.error.message)
    }
  }

  if (destinos.length === 0) {
    return (
      <PanelErrorCritico mensaje="No hay otras farmacias activas registradas todavía. Contacta al administrador para dar de alta la sede destino antes de continuar." />
    )
  }

  return (
    <form onSubmit={manejarSubmit} className="max-w-2xl space-y-4">
      <h3 className="border-b border-border pb-2 text-base font-semibold text-text-primary">
        Traspaso de material hacia otra área o farmacia
      </h3>

      {exito && <BannerExito mensaje={exito} onCerrar={() => setExito(null)} />}
      {error && <BannerErrorFormulario mensaje={error} onCerrar={() => setError(null)} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="sm:col-span-3">
          <label className="mb-1 block text-xs font-medium text-text-muted">Insumo a enviar</label>
          <ComboboxProducto
            productos={productos}
            value={productoId}
            onChange={setProductoId}
            required
            mostrarPrecio={false}
            placeholder="Busca el insumo por nombre o código..."
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-muted">Cantidad</label>
          <input
            type="number"
            required
            min="1"
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm focus:border-accent focus:outline-none"
            placeholder="0"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-text-muted">Área / Farmacia destino</label>
        <select
          required
          value={destinoId}
          onChange={(e) => setDestinoId(e.target.value)}
          className="w-full max-w-sm rounded-md border border-border bg-canvas px-3 py-2 text-sm focus:border-accent focus:outline-none"
        >
          <option value="">Selecciona destino...</option>
          {destinos.map((d) => (
            <option key={d.id} value={d.id}>
              {d.nombre}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        disabled={enviando}
        className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-text-onink transition-colors hover:bg-accent-strong disabled:opacity-50"
      >
        {enviando ? 'Enviando traspaso...' : 'Confirmar Traspaso'}
      </button>
    </form>
  )
}

// ------------------------------------------------------------------
// Sección: Consultar Almacén Central (sin costos)
// ------------------------------------------------------------------

function SeccionConsultarAlmacenCentral() {
  const [busqueda, setBusqueda] = useState('')
  const disponibilidad = useApiResult(() => obtenerDisponibilidadAlmacenCentral(), [])

  const filtrados = useMemo(() => {
    if (disponibilidad.fase !== 'listo') return []
    const q = busqueda.trim().toLowerCase()
    if (!q) return disponibilidad.data
    return disponibilidad.data.filter(
      (fila) =>
        (fila.concepto ?? '').toLowerCase().includes(q) ||
        (fila.codigo_barras ?? '').toLowerCase().includes(q) ||
        (fila.categoria ?? '').toLowerCase().includes(q),
    )
  }, [disponibilidad, busqueda])

  if (disponibilidad.fase === 'cargando') {
    return <div className="py-8 text-center text-sm text-text-muted animate-pulse">Cargando existencias de Almacén Central...</div>
  }

  if (disponibilidad.fase === 'error') {
    return (
      <div className="flex items-center justify-between rounded-md bg-status-critico-soft px-4 py-3 text-sm text-status-critico">
        <span>{disponibilidad.error.message}</span>
        <button type="button" onClick={disponibilidad.recargar} className="ml-4 underline underline-offset-2">
          Reintentar
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-text-primary">Existencias en Almacén Central</h3>
        <p className="mt-0.5 text-sm text-text-muted">
          Verifica disponibilidad antes de solicitar un traspaso. No se muestran precios ni costos.
        </p>
      </div>

      <input
        type="search"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar por nombre, código o categoría..."
        className="w-full max-w-md rounded-md border border-border bg-canvas px-3 py-2 text-sm placeholder:text-text-muted focus:border-accent focus:outline-none"
      />

      <div className="overflow-x-auto rounded-lg border border-border bg-canvas-card">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-text-muted">
              <th className="px-4 py-3 font-medium">Insumo</th>
              <th className="px-4 py-3 font-medium">Categoría</th>
              <th className="px-4 py-3 font-medium">Disponible en Almacén Central</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-sm text-text-muted">
                  {busqueda ? `Sin resultados para "${busqueda}".` : 'No hay productos activos en el catálogo.'}
                </td>
              </tr>
            ) : (
              filtrados.map((fila) => <FilaDisponibilidadCentral key={fila.id} fila={fila} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FilaDisponibilidadCentral({ fila }: { fila: DisponibilidadAlmacenCentral }) {
  const cantidad = fila.cantidad_actual_central ?? 0
  const sinStock = cantidad <= 0

  return (
    <tr className={`border-b border-border last:border-0 ${sinStock ? 'bg-status-critico-soft' : ''}`}>
      <td className="px-4 py-3">
        <p className="font-medium text-text-primary">{fila.concepto}</p>
        <p className="text-xs text-text-muted">{fila.codigo_barras}</p>
      </td>
      <td className="px-4 py-3 text-text-muted">{fila.categoria ?? '—'}</td>
      <td className={`px-4 py-3 font-semibold ${sinStock ? 'text-status-critico' : 'text-status-ok'}`}>
        {cantidad}
      </td>
    </tr>
  )
}

// ------------------------------------------------------------------
// Sección: Salida por Práctica
// ------------------------------------------------------------------

function SeccionSalidaPractica({ perfil, ubicacionId }: { perfil: PerfilActual; ubicacionId: string }) {
  const productosRes = useApiResult(() => obtenerProductos(), [])

  if (productosRes.fase === 'cargando') {
    return <div className="py-8 text-center text-sm text-text-muted animate-pulse">Cargando catálogo...</div>
  }

  return (
    <FormularioSalidaPractica
      productos={productosRes.fase === 'listo' ? productosRes.data : []}
      usuarioId={perfil.id}
      ubicacionId={ubicacionId}
    />
  )
}

function FormularioSalidaPractica({
  productos,
  usuarioId,
  ubicacionId,
}: {
  productos: ProductoConCategoria[]
  usuarioId: string
  ubicacionId: string
}) {
  const [productoId, setProductoId] = useState('')
  const [cantidad, setCantidad] = useState('')
  const [alumnoReferencia, setAlumnoReferencia] = useState('')
  const [comentario, setComentario] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [exito, setExito] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function manejarSubmit(e: FormEvent) {
    e.preventDefault()
    setExito(null)
    setError(null)
    setEnviando(true)

    const res = await registrarSalidaPractica({
      productoId,
      ubicacionId,
      cantidad: Number(cantidad),
      usuarioId,
      alumnoReferencia: alumnoReferencia.trim(),
      comentario: comentario.trim() || undefined,
    })

    setEnviando(false)
    if (res.success) {
      setExito('Salida registrada con éxito.')
      setProductoId('')
      setCantidad('')
      setAlumnoReferencia('')
      setComentario('')
    } else {
      setError(res.error.message)
    }
  }

  return (
    <form onSubmit={manejarSubmit} className="max-w-2xl space-y-4">
      <h3 className="border-b border-border pb-2 text-base font-semibold text-text-primary">
        Registrar salida por práctica / alumno
      </h3>

      {exito && <BannerExito mensaje={exito} onCerrar={() => setExito(null)} />}
      {error && <BannerErrorFormulario mensaje={error} onCerrar={() => setError(null)} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-text-muted">Insumo utilizado</label>
          <ComboboxProducto
            productos={productos}
            value={productoId}
            onChange={setProductoId}
            required
            mostrarPrecio={false}
            placeholder="Busca el material consumido..."
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-muted">Cantidad</label>
          <input
            type="number"
            required
            min="1"
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm focus:border-accent focus:outline-none"
            placeholder="0"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-muted">Alumno / Matrícula / Bitácora</label>
          <input
            type="text"
            required
            value={alumnoReferencia}
            onChange={(e) => setAlumnoReferencia(e.target.value)}
            className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm focus:border-accent focus:outline-none"
            placeholder="Ej. Juan Pérez — 12345678 o Práctica de Endodoncia Gpo. 4"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-muted">Comentario (opcional)</label>
          <input
            type="text"
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm focus:border-accent focus:outline-none"
            placeholder="Notas adicionales"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={enviando}
        className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-text-onink transition-colors hover:bg-accent-strong disabled:opacity-50"
      >
        {enviando ? 'Registrando salida...' : 'Confirmar Salida'}
      </button>
    </form>
  )
}
