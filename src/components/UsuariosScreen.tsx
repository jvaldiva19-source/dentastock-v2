import { useState, type FormEvent } from 'react'
import { useApiResult } from '../hooks/useApiResult'
import { obtenerUsuarios, crearUsuario } from '../api/usuarios'
import { obtenerUbicaciones } from '../api/catalogo'
import { BannerExito, BannerErrorFormulario } from './common/BannerFormulario'
import type { Ubicacion, Enums } from '../types/database.types'

/**
 * src/components/UsuariosScreen.tsx
 *
 * Vista de administración del personal de la clínica (tabla
 * 'usuarios'). Solo llega aquí ADMINISTRADOR — igual que
 * CatalogoScreen y ReportesScreen, el guard de vista vive en App.tsx
 * y en el menú de MainLayout, así que este componente puede llamar a
 * crearUsuario() directamente y confiar en que la RLS del motor
 * rechace cualquier intento de un rol distinto antes de llegar aquí.
 *
 * Sigue el mismo patrón de refresh que CatalogoScreen: un contador
 * `refreshKey` como dependencia de useApiResult, incrementado tras un
 * alta exitosa para volver a consultar obtenerUsuarios() sin store
 * global ni prop drilling.
 *
 * Ver la nota de autenticación al inicio de src/api/usuarios.ts: el
 * alta de aquí SÍ crea una cuenta real de Supabase Auth (vía la Edge
 * Function crear-usuario), con la contraseña inicial capturada en
 * este formulario — la persona puede iniciar sesión de inmediato.
 */

const ETIQUETAS_ROL: Record<Enums<'rol_usuario'>, string> = {
  ADMINISTRADOR: 'Administrador',
  PERSONAL_CLINICA: 'Personal de Clínica',
}

const ROLES = Object.keys(ETIQUETAS_ROL) as Enums<'rol_usuario'>[]

/**
 * Genera una contraseña inicial razonablemente fuerte (12 caracteres,
 * mezclando mayúsculas/minúsculas/dígitos/símbolos) con
 * crypto.getRandomValues() — no Math.random(), que no es
 * criptográficamente seguro. Es solo un punto de partida cómodo para
 * el administrador; el campo sigue siendo editable a mano.
 */
function generarPasswordSegura(): string {
  const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%'
  const valores = new Uint32Array(12)
  crypto.getRandomValues(valores)
  return Array.from(valores, (v) => ALFABETO[v % ALFABETO.length]).join('')
}

export function UsuariosScreen() {
  const [refreshKey, setRefreshKey] = useState(0)
  const [claveFormulario, setClaveFormulario] = useState(0)
  const [formularioAbierto, setFormularioAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState('')

  const usuarios = useApiResult(() => obtenerUsuarios(), [refreshKey])
  const ubicaciones = useApiResult(() => obtenerUbicaciones(), [])

  function abrirCrear() {
    setClaveFormulario((k) => k + 1)
    setFormularioAbierto(true)
  }

  function cerrar() {
    setFormularioAbierto(false)
  }

  function manejarCreado() {
    setRefreshKey((k) => k + 1)
    // Remonta el formulario con estado fresco para la siguiente alta rápida,
    // sin cerrar el panel — mismo criterio que FormularioProducto en CatalogoScreen.
    setClaveFormulario((k) => k + 1)
  }

  const listaUbicaciones = ubicaciones.fase === 'listo' ? ubicaciones.data : []

  const usuariosFiltrados =
    usuarios.fase === 'listo'
      ? usuarios.data.filter((u) => {
          if (!busqueda.trim()) return true
          const q = busqueda.trim().toLowerCase()
          return (
            (u.nombre_completo ?? '').toLowerCase().includes(q) ||
            u.nombre_usuario.toLowerCase().includes(q) ||
            (u.email ?? '').toLowerCase().includes(q)
          )
        })
      : []

  return (
    <div className="space-y-6">
      {/* ---- Encabezado ---- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Gestión de Usuarios</h1>
          {usuarios.fase === 'listo' && (
            <p className="mt-0.5 text-sm text-text-muted">
              {usuarios.data.length} {usuarios.data.length === 1 ? 'usuario registrado' : 'usuarios registrados'}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={formularioAbierto ? cerrar : abrirCrear}
          className={`self-start rounded-md px-5 py-2.5 text-sm font-semibold text-text-onink shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${
            formularioAbierto ? 'bg-text-muted hover:opacity-80' : 'bg-accent hover:bg-accent-strong'
          }`}
        >
          {formularioAbierto ? 'Cancelar nuevo' : '➕ Nuevo Usuario'}
        </button>
      </div>

      {/* ---- Formulario de creación ---- */}
      {formularioAbierto && (
        <FormularioUsuario
          key={claveFormulario}
          ubicaciones={listaUbicaciones}
          onCreado={manejarCreado}
          onCancelar={cerrar}
        />
      )}

      {/* ---- Buscador ---- */}
      <input
        type="search"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar por nombre, usuario o correo…"
        className="w-full max-w-md rounded-md border border-border bg-canvas-card px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />

      {/* ---- Tabla ---- */}
      {usuarios.fase === 'cargando' && <FilaCargando />}

      {usuarios.fase === 'error' && (
        <div className="rounded-lg border border-status-critico bg-status-critico-soft p-4 text-sm text-status-critico">
          {usuarios.error.message}
          <button type="button" onClick={usuarios.recargar} className="ml-3 underline underline-offset-2">
            Reintentar
          </button>
        </div>
      )}

      {usuarios.fase === 'listo' && (
        <div className="overflow-x-auto rounded-lg border border-border bg-canvas-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-text-muted">
                <th className="px-4 py-3 font-medium">Nombre</th>
                <th className="px-4 py-3 font-medium">Usuario</th>
                <th className="px-4 py-3 font-medium">Correo</th>
                <th className="px-4 py-3 font-medium">Rol</th>
                <th className="px-4 py-3 font-medium">Ubicación</th>
                <th className="px-4 py-3 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {usuariosFiltrados.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-text-muted">
                    {busqueda ? `Sin resultados para "${busqueda}".` : 'Todavía no hay usuarios registrados.'}
                  </td>
                </tr>
              ) : (
                usuariosFiltrados.map((u) => (
                  <tr key={u.id} className={`border-b border-border last:border-0 ${!u.activo ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3 font-medium text-text-primary">
                      {u.nombre_completo ?? '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-text-muted">{u.nombre_usuario}</td>
                    <td className="px-4 py-3 text-text-muted">{u.email ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-semibold tracking-wide text-accent-strong">
                        {ETIQUETAS_ROL[u.rol]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {listaUbicaciones.find((ub) => ub.id === u.ubicacion_id)?.nombre ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs font-semibold uppercase tracking-wide ${u.activo ? 'text-status-ok' : 'text-text-muted'}`}
                      >
                        {u.activo ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function FilaCargando() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-canvas-card">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-4 border-b border-border px-4 py-3 last:border-0">
          <div className="h-4 w-40 animate-pulse rounded bg-canvas" />
          <div className="h-4 w-28 animate-pulse rounded bg-canvas" />
          <div className="h-4 w-32 animate-pulse rounded bg-canvas" />
          <div className="ml-auto h-4 w-20 animate-pulse rounded bg-canvas" />
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------
// Formulario de creación
// ------------------------------------------------------------------

interface FormularioUsuarioProps {
  ubicaciones: Ubicacion[]
  onCreado: () => void
  onCancelar: () => void
}

const claseLabel = 'mb-1.5 block text-xs font-medium text-text-muted'
const claseInput =
  'w-full rounded-md border border-border bg-canvas px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60'

function FormularioUsuario({ ubicaciones, onCreado, onCancelar }: FormularioUsuarioProps) {
  const [nombreCompleto, setNombreCompleto] = useState('')
  const [nombreUsuario, setNombreUsuario] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mostrarPassword, setMostrarPassword] = useState(false)
  const [rol, setRol] = useState<Enums<'rol_usuario'>>('PERSONAL_CLINICA')
  const [ubicacionId, setUbicacionId] = useState('')
  const [activo, setActivo] = useState(true)

  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)

  async function manejarSubmit(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setError(null)
    setExito(null)

    if (rol === 'PERSONAL_CLINICA' && !ubicacionId) {
      setError('El personal de clínica requiere una ubicación asignada.')
      return
    }

    setEnviando(true)

    const resultado = await crearUsuario({
      nombre_completo: nombreCompleto.trim(),
      nombre_usuario: nombreUsuario.trim(),
      email: email.trim(),
      password,
      rol,
      ubicacion_id: rol === 'PERSONAL_CLINICA' ? ubicacionId : null,
      activo,
    })

    setEnviando(false)

    if (!resultado.success) {
      setError(resultado.error.message)
      return
    }

    setExito(
      `Usuario "${resultado.data.nombre_completo}" creado exitosamente. Comparte con la persona su correo y la contraseña capturada — ya puede iniciar sesión con ellos.`,
    )
    setNombreCompleto('')
    setNombreUsuario('')
    setEmail('')
    setPassword('')
    setMostrarPassword(false)
    setRol('PERSONAL_CLINICA')
    setUbicacionId('')
    setActivo(true)
    onCreado()
  }

  return (
    <div className="rounded-lg border border-border bg-canvas-card p-6">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-base font-semibold text-text-primary">Nuevo usuario</h2>
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
        {error && <BannerErrorFormulario mensaje={error} onCerrar={() => setError(null)} />}

        {/* Fila 1: Nombre completo + Nombre de usuario */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="usr-nombre" className={claseLabel}>
              Nombre completo
            </label>
            <input
              id="usr-nombre"
              type="text"
              required
              value={nombreCompleto}
              disabled={enviando}
              onChange={(e) => setNombreCompleto(e.target.value)}
              className={claseInput}
              placeholder="Nombre y apellidos"
            />
          </div>
          <div>
            <label htmlFor="usr-usuario" className={claseLabel}>
              Nombre de usuario
            </label>
            <input
              id="usr-usuario"
              type="text"
              required
              value={nombreUsuario}
              disabled={enviando}
              onChange={(e) => setNombreUsuario(e.target.value)}
              className={`${claseInput} font-mono`}
              placeholder="ej. jrodriguez"
            />
          </div>
        </div>

        {/* Fila 2: Correo + Rol */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="usr-email" className={claseLabel}>
              Correo electrónico
            </label>
            <input
              id="usr-email"
              type="email"
              required
              value={email}
              disabled={enviando}
              onChange={(e) => setEmail(e.target.value)}
              className={claseInput}
              placeholder="nombre@clinica.mx"
            />
            <p className="mt-1 text-[10px] text-text-muted">
              Es el identificador con el que la persona inicia sesión.
            </p>
          </div>
          <div>
            <label htmlFor="usr-rol" className={claseLabel}>
              Rol
            </label>
            <select
              id="usr-rol"
              value={rol}
              disabled={enviando}
              onChange={(e) => setRol(e.target.value as Enums<'rol_usuario'>)}
              className={claseInput}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ETIQUETAS_ROL[r]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Contraseña inicial */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="usr-password" className="text-xs font-medium text-text-muted">
              Contraseña inicial
            </label>
            <button
              type="button"
              onClick={() => {
                setPassword(generarPasswordSegura())
                setMostrarPassword(true)
              }}
              disabled={enviando}
              className="text-[10px] font-medium text-accent-strong underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Generar contraseña
            </button>
          </div>
          <div className="relative">
            <input
              id="usr-password"
              type={mostrarPassword ? 'text' : 'password'}
              required
              minLength={8}
              value={password}
              disabled={enviando}
              onChange={(e) => setPassword(e.target.value)}
              className={`${claseInput} pr-16 font-mono`}
              placeholder="Mínimo 8 caracteres"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setMostrarPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-[10px] font-medium text-text-muted hover:text-text-primary"
            >
              {mostrarPassword ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
          <p className="mt-1 text-[10px] text-text-muted">
            Compártela directamente con la persona — todavía no existe un flujo de invitación por
            correo, así que es la única forma en que sabrá su contraseña inicial.
          </p>
        </div>

        {/* Ubicación — obligatoria solo para Personal de Clínica */}
        {rol === 'PERSONAL_CLINICA' && (
          <div>
            <label htmlFor="usr-ubicacion" className={claseLabel}>
              Ubicación asignada
            </label>
            <select
              id="usr-ubicacion"
              required
              value={ubicacionId}
              disabled={enviando}
              onChange={(e) => setUbicacionId(e.target.value)}
              className={claseInput}
            >
              <option value="">Selecciona una ubicación...</option>
              {ubicaciones.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[10px] text-text-muted">
              Requerida: el personal de clínica siempre opera desde un área fija.
            </p>
          </div>
        )}

        {/* Activo */}
        <div className="rounded-md border border-border bg-canvas p-4">
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={activo}
              disabled={enviando}
              onChange={(e) => setActivo(e.target.checked)}
              className="h-4 w-4 rounded accent-accent"
            />
            <div>
              <p className="text-sm font-medium text-text-primary">Usuario activo</p>
              <p className="mt-0.5 text-xs text-text-muted">
                {activo ? 'Puede operar en el sistema' : 'Queda dado de alta pero sin acceso'}
              </p>
            </div>
          </label>
        </div>

        {/* Botones */}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={enviando}
            className="rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-text-onink transition-colors hover:bg-accent-strong disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            {enviando ? 'Guardando…' : 'Crear usuario'}
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
