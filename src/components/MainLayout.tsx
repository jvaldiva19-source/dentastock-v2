import { useState, type ComponentType, type ReactNode } from 'react'
import { signOut } from '../api/auth'
import type { RolUsuario } from '../types/database.types'

/**
 * src/components/MainLayout.tsx
 *
 * Cascarón estructural de la aplicación autenticada: barra lateral,
 * encabezado y área central. Es deliberadamente un componente "tonto"
 * (presentacional): no consulta Supabase para resolver quién es el
 * usuario ni en qué vista está — recibe esos datos ya resueltos por
 * props desde un componente contenedor (ej. App.tsx), con la única
 * excepción del botón de cerrar sesión, que sí llama directamente a
 * signOut() porque así se pidió explícitamente.
 *
 * Sobre el cierre de sesión: este componente NO redirige manualmente
 * a la pantalla de login después de llamar a signOut(). Se asume que
 * el componente raíz de la aplicación tiene una suscripción activa a
 * supabase.auth.onAuthStateChange() que detecta la sesión nula y
 * cambia la vista a Login por su cuenta. Si ese listener todavía no
 * existe cuando integres este componente, el botón llamará a signOut()
 * correctamente pero la UI no cambiará de pantalla sola — apunta esa
 * pieza como pendiente si no la tienes ya.
 */

export type VistaPrincipal = 'dashboard' | 'catalogo' | 'movimientos' | 'reportes'

export interface UsuarioEnLayout {
  /** nombreCompleto si existe, o nombreUsuario como respaldo */
  nombre: string
  rol: RolUsuario
  /** Nombre legible de la ubicación asignada, ya resuelto por el contenedor.
   *  null para ADMINISTRADOR (no tiene una sola área fija) o mientras carga. */
  ubicacionNombre: string | null
}

export interface MainLayoutProps {
  usuario: UsuarioEnLayout
  vistaActiva: VistaPrincipal
  onNavegar: (vista: VistaPrincipal) => void
  children: ReactNode
}

// ------------------------------------------------------------------
// Iconografía mínima en SVG inline — sin librería de iconos adicional,
// para no agregar una dependencia nueva solo por cuatro símbolos.
// ------------------------------------------------------------------

function trazoBase(className?: string) {
  return {
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
  }
}

function IconoDashboard({ className }: { className?: string }) {
  return (
    <svg {...trazoBase(className)}>
      <rect x="2.5" y="2.5" width="6" height="7" rx="1" />
      <rect x="11.5" y="2.5" width="6" height="4.5" rx="1" />
      <rect x="11.5" y="9.5" width="6" height="8" rx="1" />
      <rect x="2.5" y="11.5" width="6" height="6" rx="1" />
    </svg>
  )
}

function IconoCatalogo({ className }: { className?: string }) {
  return (
    <svg {...trazoBase(className)}>
      <path d="M3 6.2 10 2.5l7 3.7-7 3.7-7-3.7Z" />
      <path d="M3 6.2v7.6L10 17.5l7-3.7V6.2" />
      <path d="M10 9.9v7.6" />
    </svg>
  )
}

function IconoMovimientos({ className }: { className?: string }) {
  return (
    <svg {...trazoBase(className)}>
      <path d="M3 7h11" />
      <path d="M11 3.5 14.5 7 11 10.5" />
      <path d="M17 13H6" />
      <path d="M9 9.5 5.5 13 9 16.5" />
    </svg>
  )
}

function IconoReportes({ className }: { className?: string }) {
  return (
    <svg {...trazoBase(className)}>
      <path d="M3.5 17V3.5" />
      <path d="M3.5 17h13" />
      <rect x="6" y="10.5" width="2.4" height="6.5" />
      <rect x="9.8" y="7" width="2.4" height="10" />
      <rect x="13.6" y="12.5" width="2.4" height="4.5" />
    </svg>
  )
}

function IconoSalir({ className }: { className?: string }) {
  return (
    <svg {...trazoBase(className)}>
      <path d="M7.5 17H4.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h3" />
      <path d="M13 13.5 17 10l-4-3.5" />
      <path d="M17 10H7.5" />
    </svg>
  )
}

function IconoMenu({ className }: { className?: string }) {
  return (
    <svg {...trazoBase(className)}>
      <path d="M3 5.5h14" />
      <path d="M3 10h14" />
      <path d="M3 14.5h14" />
    </svg>
  )
}

function IconoCerrar({ className }: { className?: string }) {
  return (
    <svg {...trazoBase(className)}>
      <path d="M5 5l10 10" />
      <path d="M15 5 5 15" />
    </svg>
  )
}

// ------------------------------------------------------------------
// Configuración de navegación
// ------------------------------------------------------------------

interface ItemNav {
  id: VistaPrincipal
  etiqueta: string
  icono: ComponentType<{ className?: string }>
  /**
   * El catálogo maestro y los reportes de auditoría/costos quedan
   * reservados a ADMINISTRADOR, en línea con el límite de rol definido
   * desde el primer documento de arquitectura: "Personal de Clínica
   * con permisos limitados a registrar salidas y mermas". Si tu
   * intención actual es que PERSONAL_CLINICA también vea estas dos
   * secciones (aunque sea en modo solo lectura), dímelo y quito esta
   * bandera en vez de dejar una restricción que no querías.
   */
  soloAdministrador?: boolean
}

const ITEMS_NAV: ItemNav[] = [
  { id: 'dashboard', etiqueta: 'Dashboard y Alertas', icono: IconoDashboard },
  {
    id: 'catalogo',
    etiqueta: 'Catálogo de Insumos',
    icono: IconoCatalogo,
    soloAdministrador: true,
  },
  { id: 'movimientos', etiqueta: 'Registro de Movimientos', icono: IconoMovimientos },
  {
    id: 'reportes',
    etiqueta: 'Reportes de Auditoría',
    icono: IconoReportes,
    soloAdministrador: true,
  },
]

function etiquetaRol(rol: RolUsuario): string {
  return rol === 'ADMINISTRADOR' ? 'Administrador' : 'Personal Clínica'
}

// ------------------------------------------------------------------
// Componente principal
// ------------------------------------------------------------------

export function MainLayout({
  usuario,
  vistaActiva,
  onNavegar,
  children,
}: MainLayoutProps) {
  const [menuMovilAbierto, setMenuMovilAbierto] = useState(false)
  const [cerrandoSesion, setCerrandoSesion] = useState(false)
  const [errorCierre, setErrorCierre] = useState<string | null>(null)

  const itemsVisibles = ITEMS_NAV.filter(
    (item) => !item.soloAdministrador || usuario.rol === 'ADMINISTRADOR',
  )

  async function manejarCerrarSesion() {
    setCerrandoSesion(true)
    setErrorCierre(null)

    const resultado = await signOut()

    if (!resultado.success) {
      setErrorCierre(resultado.error.message)
      setCerrandoSesion(false)
      return
    }

    // Sin redirección manual: ver nota de diseño al inicio del archivo.
  }

  function manejarNavegacion(vista: VistaPrincipal) {
    onNavegar(vista)
    setMenuMovilAbierto(false)
  }

  return (
    <div className="flex h-screen bg-canvas text-text-primary">
      {/* ---- Overlay móvil ---- */}
      {menuMovilAbierto && (
        <div
          className="fixed inset-0 z-30 bg-ink-900/50 lg:hidden"
          onClick={() => setMenuMovilAbierto(false)}
          aria-hidden="true"
        />
      )}

      {/* ---- Barra lateral ---- */}
      <aside
        className={`fixed z-40 flex h-full w-64 flex-col bg-ink-900 transition-transform duration-200 lg:static lg:translate-x-0 ${
          menuMovilAbierto ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-6 py-7">
          <div>
            <p className="text-lg font-semibold tracking-wide text-text-onink">
              DENTASTOCK
            </p>
            <p className="text-xs text-text-onink-muted">
              Clínica Odontológica · UAQ
            </p>
          </div>
          <button
            type="button"
            onClick={() => setMenuMovilAbierto(false)}
            className="rounded-md p-1 text-text-onink-muted hover:text-text-onink lg:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Cerrar menú"
          >
            <IconoCerrar className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {itemsVisibles.map((item) => {
            const activo = item.id === vistaActiva
            const Icono = item.icono

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => manejarNavegacion(item.id)}
                className={`flex w-full items-center gap-3 rounded-md border-l-2 px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  activo
                    ? 'border-accent bg-ink-700 text-text-onink'
                    : 'border-transparent text-text-onink-muted hover:bg-ink-800 hover:text-text-onink'
                }`}
                aria-current={activo ? 'page' : undefined}
              >
                <Icono className="h-4.5 w-4.5 flex-shrink-0" />
                <span>{item.etiqueta}</span>
              </button>
            )
          })}
        </nav>

        <div className="px-3 pb-6 pt-3">
          <button
            type="button"
            onClick={manejarCerrarSesion}
            disabled={cerrandoSesion}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm text-text-onink-muted transition-colors hover:bg-ink-800 hover:text-text-onink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <IconoSalir className="h-4.5 w-4.5 flex-shrink-0" />
            <span>{cerrandoSesion ? 'Cerrando sesión…' : 'Cerrar sesión'}</span>
          </button>
          {errorCierre && (
            <p className="mt-2 px-3 text-xs text-status-critico">{errorCierre}</p>
          )}
        </div>
      </aside>

      {/* ---- Columna derecha: header + contenido ---- */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 flex-shrink-0 items-center justify-between border-b border-border bg-canvas-card px-4 lg:px-8">
          <button
            type="button"
            onClick={() => setMenuMovilAbierto(true)}
            className="rounded-md p-2 text-text-muted hover:bg-canvas lg:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Abrir menú"
          >
            <IconoMenu className="h-5 w-5" />
          </button>

          <div className="hidden lg:block" />

          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-text-primary">
                {usuario.nombre}
              </p>
              <p className="text-xs text-text-muted">
                {usuario.ubicacionNombre ?? 'Todas las ubicaciones'}
              </p>
            </div>
            <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent-strong">
              {etiquetaRol(usuario.rol)}
            </span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-8">{children}</main>
      </div>
    </div>
  )
}