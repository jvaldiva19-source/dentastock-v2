import { useState, type FormEvent } from 'react'
import { useApiResult } from '../hooks/useApiResult'
import { obtenerProductos, obtenerProveedores, obtenerUbicaciones, type ProductoConCategoria } from '../api/catalogo'
import { getPerfilActual } from '../api/auth'
import { registrarEntradaProveedor, registrarTraspaso, registrarConsumo } from '../api/movimientos'
import type { Proveedor, Ubicacion } from '../types/database.types'

type SubSeccion = 'entrada' | 'traspaso' | 'consumo'

/** Código de catálogo de la ubicación única que actúa como destino de
 *  toda entrada de proveedor y como origen de todo traspaso — ver
 *  docs/arquitectura.md. */
const CODIGO_ALMACEN_CENTRAL = 'ALM-CEN'

export function MovimientosScreen() {
  const [subSeccion, setSubSeccion] = useState<SubSeccion>('entrada')

  // Datos maestros requeridos para alimentar los Selectores de los formularios
  const productosRes = useApiResult(() => obtenerProductos(), [])
  const proveedoresRes = useApiResult(() => obtenerProveedores(), [])
  const ubicacionesRes = useApiResult(() => obtenerUbicaciones(), [])
  // Identidad real del usuario activo, resuelta vía Supabase Auth +
  // tabla 'usuarios' — reemplaza el UUID simulado que existía antes.
  const perfilRes = useApiResult(() => getPerfilActual(), [])

  const cargando =
    productosRes.fase === 'cargando' ||
    proveedoresRes.fase === 'cargando' ||
    ubicacionesRes.fase === 'cargando' ||
    perfilRes.fase === 'cargando'

  return (
    <div className="space-y-6">
      {/* Botonera superior de conmutación de formularios */}
      <div className="flex flex-wrap gap-2 border-b border-border pb-4">
        <button
          type="button"
          onClick={() => setSubSeccion('entrada')}
          className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            subSeccion === 'entrada'
              ? 'bg-accent text-text-onink font-semibold'
              : 'bg-canvas-card border border-border text-text-muted hover:bg-canvas'
          }`}
        >
          📦 Entrada de Proveedor
        </button>
        <button
          type="button"
          onClick={() => setSubSeccion('traspaso')}
          className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            subSeccion === 'traspaso'
              ? 'bg-accent text-text-onink font-semibold'
              : 'bg-canvas-card border border-border text-text-muted hover:bg-canvas'
          }`}
        >
          🔄 Traspaso entre Áreas
        </button>
        <button
          type="button"
          onClick={() => setSubSeccion('consumo')}
          className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            subSeccion === 'consumo'
              ? 'bg-accent text-text-onink font-semibold'
              : 'bg-canvas-card border border-border text-text-muted hover:bg-canvas'
          }`}
        >
          🦷 Consumo Clínico / Merma
        </button>
      </div>

      {/* Renderizado condicional del formulario activo */}
      <div className="rounded-lg border border-border bg-canvas-card p-6 shadow-sm">
        {cargando && (
          <div className="py-8 text-center text-sm text-text-muted animate-pulse">
            Cargando catálogos operativos...
          </div>
        )}

        {!cargando && perfilRes.fase === 'error' && (
          <PanelErrorCritico mensaje={perfilRes.error.message} />
        )}

        {!cargando && perfilRes.fase === 'listo' && ubicacionesRes.fase === 'error' && (
          <PanelErrorCritico mensaje={ubicacionesRes.error.message} />
        )}

        {!cargando && perfilRes.fase === 'listo' && ubicacionesRes.fase === 'listo' && (
          <FormulariosOperativos
            subSeccion={subSeccion}
            productos={productosRes.fase === 'listo' ? productosRes.data : []}
            proveedores={proveedoresRes.fase === 'listo' ? proveedoresRes.data : []}
            ubicaciones={ubicacionesRes.data}
            usuarioId={perfilRes.data.id}
            ubicacionUsuarioId={perfilRes.data.ubicacionId}
          />
        )}
      </div>
    </div>
  )
}

function PanelErrorCritico({ mensaje }: { mensaje: string }) {
  return (
    <div className="rounded-md bg-status-critico-soft p-4 text-sm text-status-critico">
      {mensaje}
    </div>
  )
}

// =================================────────────────=================
// Despacho del formulario activo, ya con perfil y ubicaciones reales
// =================================────────────────=================
function FormulariosOperativos({
  subSeccion,
  productos,
  proveedores,
  ubicaciones,
  usuarioId,
  ubicacionUsuarioId,
}: {
  subSeccion: SubSeccion
  productos: ProductoConCategoria[]
  proveedores: Proveedor[]
  ubicaciones: Ubicacion[]
  usuarioId: string
  ubicacionUsuarioId: string | null
}) {
  const almacenCentral = ubicaciones.find((u) => u.codigo === CODIGO_ALMACEN_CENTRAL)

  if (!almacenCentral) {
    return (
      <PanelErrorCritico
        mensaje={`No se encontró la ubicación de Almacén Central (código "${CODIGO_ALMACEN_CENTRAL}") entre las ubicaciones activas. Verifica el catálogo de ubicaciones antes de registrar movimientos.`}
      />
    )
  }

  const ubicacionesDestino = ubicaciones.filter((u) => u.id !== almacenCentral.id)

  switch (subSeccion) {
    case 'entrada':
      return (
        <FormularioEntrada
          productos={productos}
          proveedores={proveedores}
          usuarioId={usuarioId}
          almacenId={almacenCentral.id}
        />
      )
    case 'traspaso':
      return (
        <FormularioTraspaso
          productos={productos}
          usuarioId={usuarioId}
          origen={almacenCentral}
          destinos={ubicacionesDestino}
          destinoSugeridoId={ubicacionUsuarioId}
        />
      )
    case 'consumo':
      return (
        <FormularioConsumo
          productos={productos}
          usuarioId={usuarioId}
          ubicaciones={ubicaciones}
          ubicacionSugeridaId={ubicacionUsuarioId}
        />
      )
  }
}

// =================================────────────────=================
// 📦 FORMULARIO: ENTRADA DE PROVEEDOR
// =================================────────────────=================
function FormularioEntrada({
  productos,
  proveedores,
  usuarioId,
  almacenId,
}: {
  productos: ProductoConCategoria[]
  proveedores: Proveedor[]
  usuarioId: string
  almacenId: string
}) {
  const [productoId, setProductoId] = useState('')
  const [proveedorId, setProveedorId] = useState('')
  const [cantidad, setCantidad] = useState('')
  const [costoUnitario, setCostoUnitario] = useState('')
  const [numeroFactura, setNumeroFactura] = useState('')
  const [numeroLote, setNumeroLote] = useState('')
  const [fechaCaducidad, setFechaCaducidad] = useState('')
  const [observaciones, setObservaciones] = useState('')

  const [enviando, setEnviando] = useState(false)
  const [status, setStatus] = useState<{ tipo: 'ok' | 'error'; msg: string } | null>(null)

  const productoSeleccionado = productos.find((p) => p.id === productoId)

  async function manejarSubmit(e: FormEvent) {
    e.preventDefault()
    setStatus(null)
    setEnviando(true)

    const res = await registrarEntradaProveedor({
      productoId,
      ubicacionDestinoId: almacenId,
      cantidad: Number(cantidad),
      costoUnitario: Number(costoUnitario),
      numeroFactura: numeroFactura.trim(),
      proveedorId,
      usuarioId,
      numeroLote: productoSeleccionado?.requiere_lote ? numeroLote.trim() : undefined,
      fechaCaducidad: productoSeleccionado?.requiere_lote ? fechaCaducidad : undefined,
      observacionesLote: observaciones.trim() || undefined,
    })

    setEnviando(false)
    if (res.success) {
      setStatus({ tipo: 'ok', msg: 'Entrada y lote sembrados con éxito en Almacén Central.' })
      // Resetear campos
      setCantidad(''); setCostoUnitario(''); setNumeroFactura(''); setNumeroLote(''); setFechaCaducidad(''); setObservaciones('')
    } else {
      setStatus({ tipo: 'error', msg: res.error.message })
    }
  }

  return (
    <form onSubmit={manejarSubmit} className="space-y-4 max-w-2xl">
      <h3 className="text-base font-semibold text-text-primary border-b border-border pb-2">Registrar Recepción de Mercancía</h3>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Insumo / Producto</label>
          <select required value={productoId} onChange={(e) => setProductoId(e.target.value)} className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm focus:border-accent focus:outline-none">
            <option value="">Selecciona un material...</option>
            {productos.map((p) => <option key={p.id} value={p.id}>{p.concepto} ({p.codigo_barras})</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Proveedor Autorizado</label>
          <select required value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm focus:border-accent focus:outline-none">
            <option value="">Selecciona proveedor...</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Cantidad Física</label>
          <input type="number" required min="1" value={cantidad} onChange={(e) => setCantidad(e.target.value)} className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm focus:border-accent focus:outline-none" placeholder="0" />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Costo Unitario (Sin IVA)</label>
          <input type="number" required step="0.01" min="0" value={costoUnitario} onChange={(e) => setCostoUnitario(e.target.value)} className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm focus:border-accent focus:outline-none" placeholder="$0.00" />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Número de Factura</label>
          <input type="text" required value={numeroFactura} onChange={(e) => setNumeroFactura(e.target.value)} className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm focus:border-accent focus:outline-none" placeholder="FAC-XXXX" />
        </div>
      </div>

      {productoSeleccionado?.requiere_lote && (
        <div className="bg-accent-soft/40 border border-accent/20 rounded-md p-4 space-y-4">
          <p className="text-xs font-semibold text-accent-strong uppercase tracking-wider">Trazabilidad Biomédica Requerida (COFEPRIS)</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Código de Lote del Fabricante</label>
              <input type="text" required value={numeroLote} onChange={(e) => setNumeroLote(e.target.value)} className="w-full rounded-md border border-border bg-canvas-card px-3 py-2 text-sm focus:border-accent focus:outline-none" placeholder="LOTE-XXXX" />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Fecha de Caducidad</label>
              <input type="date" required value={fechaCaducidad} onChange={(e) => setFechaCaducidad(e.target.value)} className="w-full rounded-md border border-border bg-canvas-card px-3 py-2 text-sm focus:border-accent focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Notas del lote o Cadena de Frío</label>
            <input type="text" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} className="w-full rounded-md border border-border bg-canvas-card px-3 py-2 text-sm focus:border-accent focus:outline-none" placeholder="Ej. Termolábil, refrigerado a 4°C" />
          </div>
        </div>
      )}

      {status && (
        <div className={`rounded-md p-3 text-sm ${status.tipo === 'ok' ? 'bg-status-ok-soft text-status-ok' : 'bg-status-critico-soft text-status-critico'}`}>
          {status.msg}
        </div>
      )}

      <button type="submit" disabled={enviando} className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-text-onink transition-colors hover:bg-accent-strong disabled:opacity-50">
        {enviando ? 'Sembrando registros...' : 'Confirmar Entrada al Almacén'}
      </button>
    </form>
  )
}

// =================================────────────────=================
// 🔄 FORMULARIO: TRASPASO ENTRE UBICACIONES
// ==================================================================
function FormularioTraspaso({
  productos,
  usuarioId,
  origen,
  destinos,
  destinoSugeridoId,
}: {
  productos: ProductoConCategoria[]
  usuarioId: string
  origen: Ubicacion
  destinos: Ubicacion[]
  destinoSugeridoId: string | null
}) {
  const [productoId, setProductoId] = useState('')
  const [destinoId, setDestinoId] = useState(
    destinoSugeridoId && destinos.some((d) => d.id === destinoSugeridoId)
      ? destinoSugeridoId
      : (destinos[0]?.id ?? ''),
  )
  const [cantidad, setCantidad] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [status, setStatus] = useState<{ tipo: 'ok' | 'error'; msg: string } | null>(null)

  async function manejarSubmit(e: FormEvent) {
    e.preventDefault()
    setStatus(null)
    setEnviando(true)

    const res = await registrarTraspaso({
      productoId,
      ubicacionOrigenId: origen.id,
      ubicacionDestinoId: destinoId,
      cantidad: Number(cantidad),
      usuarioId,
    })

    setEnviando(false)
    if (res.success) {
      const nombreDestino = destinos.find((d) => d.id === destinoId)?.nombre ?? 'la ubicación seleccionada'
      setStatus({ tipo: 'ok', msg: `Traspaso atómico completado. Material transferido a ${nombreDestino}.` })
      setCantidad('')
    } else {
      setStatus({ tipo: 'error', msg: res.error.message })
    }
  }

  return (
    <form onSubmit={manejarSubmit} className="space-y-4 max-w-2xl">
      <h3 className="text-base font-semibold text-text-primary border-b border-border pb-2">Distribución de Material Inter-Clínicas</h3>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Origen</label>
          <input type="text" disabled className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm text-text-muted" value={`${origen.nombre} (${origen.codigo})`} />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Destino</label>
          <select required value={destinoId} onChange={(e) => setDestinoId(e.target.value)} className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm focus:border-accent focus:outline-none">
            <option value="">Selecciona destino...</option>
            {destinos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="sm:col-span-3">
          <label className="block text-xs font-medium text-text-muted mb-1">Seleccionar Material a Mover</label>
          <select required value={productoId} onChange={(e) => setProductoId(e.target.value)} className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm focus:border-accent focus:outline-none">
            <option value="">Elige un insumo...</option>
            {productos.map((p) => <option key={p.id} value={p.id}>{p.concepto}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Cantidad</label>
          <input type="number" required min="1" value={cantidad} onChange={(e) => setCantidad(e.target.value)} className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm focus:border-accent focus:outline-none" placeholder="0" />
        </div>
      </div>

      {status && (
        <div className={`rounded-md p-3 text-sm ${status.tipo === 'ok' ? 'bg-status-ok-soft text-status-ok' : 'bg-status-critico-soft text-status-critico'}`}>
          {status.msg}
        </div>
      )}

      <button type="submit" disabled={enviando || !destinoId} className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-text-onink transition-colors hover:bg-accent-strong disabled:opacity-50">
        {enviando ? 'Ejecutando transacción RPC...' : 'Autorizar Traspaso Atómico'}
      </button>
    </form>
  )
}

// =================================────────────────=================
// 🦷 FORMULARIO: CONSUMO / MERMA (APLICA PEPS DE FORMA IMPLÍCITA)
// =================================────────────────=================
function FormularioConsumo({
  productos,
  usuarioId,
  ubicaciones,
  ubicacionSugeridaId,
}: {
  productos: ProductoConCategoria[]
  usuarioId: string
  ubicaciones: Ubicacion[]
  ubicacionSugeridaId: string | null
}) {
  const [productoId, setProductoId] = useState('')
  const [ubicacionId, setUbicacionId] = useState(
    ubicacionSugeridaId && ubicaciones.some((u) => u.id === ubicacionSugeridaId)
      ? ubicacionSugeridaId
      : (ubicaciones[0]?.id ?? ''),
  )
  const [cantidad, setCantidad] = useState('')
  const [tipo, setTipo] = useState<'CONSUMO' | 'MERMA_CADUCIDAD'>('CONSUMO')
  const [comentario, setComentario] = useState('')

  const [enviando, setEnviando] = useState(false)
  const [status, setStatus] = useState<{ tipo: 'ok' | 'error'; msg: string } | null>(null)

  async function manejarSubmit(e: FormEvent) {
    e.preventDefault()
    setStatus(null)
    setEnviando(true)

    const res = await registrarConsumo({
      productoId,
      ubicacionId,
      cantidad: Number(cantidad),
      usuarioId,
      tipo,
      comentario: comentario.trim() || undefined,
    })

    setEnviando(false)
    if (res.success) {
      setStatus({ tipo: 'ok', msg: `Baja registrada. PEPS/FIFO descontó del lote más próximo a caducar de forma automática.` })
      setCantidad(''); setComentario('')
    } else {
      setStatus({ tipo: 'error', msg: res.error.message })
    }
  }

  return (
    <form onSubmit={manejarSubmit} className="space-y-4 max-w-2xl">
      <h3 className="text-base font-semibold text-text-primary border-b border-border pb-2">Descuento de Material Quirúrgico</h3>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-text-muted mb-1">Insumo utilizado</label>
          <select required value={productoId} onChange={(e) => setProductoId(e.target.value)} className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm focus:border-accent focus:outline-none">
            <option value="">Selecciona el material consumido...</option>
            {productos.map((p) => <option key={p.id} value={p.id}>{p.concepto}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Uso Operativo</label>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as 'CONSUMO' | 'MERMA_CADUCIDAD')} className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm focus:border-accent focus:outline-none">
            <option value="CONSUMO">Legítimo Clínico</option>
            <option value="MERMA_CADUCIDAD">Baja / Merma Caducidad</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Ubicación</label>
          <select required value={ubicacionId} onChange={(e) => setUbicacionId(e.target.value)} className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm focus:border-accent focus:outline-none">
            <option value="">Selecciona ubicación...</option>
            {ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Cantidad Unidades</label>
          <input type="number" required min="1" value={cantidad} onChange={(e) => setCantidad(e.target.value)} className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm focus:border-accent focus:outline-none" placeholder="0" />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-text-muted mb-1">Justificación del Movimiento {tipo === 'MERMA_CADUCIDAD' && '(Obligatoria)'}</label>
          <input type="text" required={tipo === 'MERMA_CADUCIDAD'} value={comentario} onChange={(e) => setComentario(e.target.value)} className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-sm focus:border-accent focus:outline-none" placeholder="Ej. Paciente Práctica de Endodoncia o Lote Vencido" />
        </div>
      </div>

      {status && (
        <div className={`rounded-md p-3 text-sm ${status.tipo === 'ok' ? 'bg-status-ok-soft text-status-ok' : 'bg-status-critico-soft text-status-critico'}`}>
          {status.msg}
        </div>
      )}

      <button type="submit" disabled={enviando || !ubicacionId} className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-text-onink transition-colors hover:bg-accent-strong disabled:opacity-50">
        {enviando ? 'Calculando FIFO en motor...' : 'Efectuar Descuento Automatico'}
      </button>
    </form>
  )
}
