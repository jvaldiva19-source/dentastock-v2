import { useEffect, useState } from 'react'
import { subscribeToAuthChanges, getPerfilActual, signOut, type PerfilActual } from './api/auth'
import { obtenerUbicaciones } from './api/catalogo'
import { LoginScreen } from './components/LoginScreen'
import { MainLayout, type VistaPrincipal } from './components/MainLayout'
import { DashboardScreen } from './components/DashboardScreen'
import { MovimientosScreen } from './components/MovimientosScreen'
import { CatalogoScreen } from './components/CatalogoScreen'
import { ReportesScreen } from './components/ReportesScreen'
import { UsuariosScreen } from './components/UsuariosScreen'

/**
 * src/App.tsx
 *
 * Despachador central de la aplicación. Responsabilidades, en orden:
 *
 *   1. Suscribirse a los cambios de sesión de Supabase Auth (vía el
 *      wrapper subscribeToAuthChanges() de auth.ts — nunca llama a
 *      supabase.auth.* directamente, ver nota en ese archivo).
 *   2. Sin sesión -> LoginScreen.
 *   3. Con sesión -> resolver el perfil de negocio completo
 *      (getPerfilActual) y el nombre legible de su ubicación asignada
 *      (obtenerUbicaciones), con sus propios estados de carga y error.
 *   4. Perfil listo -> montar MainLayout y despachar la vista
 *      operativa activa mediante un switch.
 *
 * Este archivo modela su flujo como una única unión discriminada
 * (EstadoApp) en vez de varios booleanos sueltos (cargando, error,
 * sesion, perfil...) precisamente por la misma razón que ya guió el
 * diseño de Result<T, TError> en toda la capa de api/: un conjunto de
 * banderas independientes permite estados imposibles (por ejemplo,
 * "cargando = true" y "perfil = {...}" al mismo tiempo), mientras que
 * una unión discriminada solo permite los estados que el negocio
 * reconoce como válidos.
 */

type EstadoApp =
  | { fase: 'verificando_sesion' }
  | { fase: 'sin_sesion' }
  | { fase: 'cargando_perfil' }
  | { fase: 'error_perfil'; mensaje: string }
  | { fase: 'listo'; perfil: PerfilActual; ubicacionNombre: string | null }

/**
 * Vistas reservadas a ADMINISTRADOR, espejo exacto de la bandera
 * soloAdministrador ya declarada en MainLayout.tsx. Se duplica aquí
 * deliberadamente como defensa en profundidad: MainLayout ya oculta
 * los botones de navegación correspondientes, pero si vistaActiva
 * llegara a quedar en uno de estos valores por cualquier otra vía,
 * el área de contenido debe rechazarlo en vez de confiar
 * silenciosamente en que la barra lateral hizo bien su trabajo — el
 * mismo principio de "no confiar en una sola capa" que ya aplicamos
 * al dejar que el motor de PostgreSQL valide el stock además de la
 * lógica de la aplicación.
 */
const VISTAS_SOLO_ADMINISTRADOR: VistaPrincipal[] = ['catalogo', 'reportes', 'usuarios']

export default function App() {
  const [estado, setEstado] = useState<EstadoApp>({ fase: 'verificando_sesion' })
  const [vistaActiva, setVistaActiva] = useState<VistaPrincipal>('dashboard')

  useEffect(() => {
    const { unsubscribe } = subscribeToAuthChanges((session) => {
      if (!session) {
        setEstado({ fase: 'sin_sesion' })
        return
      }

      // Hay sesión: pasamos a cargar el perfil de negocio. Esto se
      // dispara tanto en el login inicial como cada vez que Supabase
      // refresca el token en segundo plano (autoRefreshToken: true en
      // lib/supabase.ts) — resolverPerfil() es barata de repetir y
      // mantiene el perfil siempre consistente con la sesión vigente.
      void resolverPerfil()
    })

    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function resolverPerfil() {
    setEstado({ fase: 'cargando_perfil' })

    const resultadoPerfil = await getPerfilActual()

    if (!resultadoPerfil.success) {
      // Caso límite: el listener disparó con una sesión que ya expiró
      // entre el evento y esta llamada. Lo tratamos como "sin sesión"
      // en vez de mostrar una pantalla de error por una condición de
      // carrera transitoria que se resuelve sola.
      if (resultadoPerfil.error.code === 'SIN_SESION') {
        setEstado({ fase: 'sin_sesion' })
        return
      }

      setEstado({ fase: 'error_perfil', mensaje: resultadoPerfil.error.message })
      return
    }

    const perfil = resultadoPerfil.data
    const ubicacionNombre = await resolverNombreUbicacion(perfil)

    setVistaActiva('dashboard')
    setEstado({ fase: 'listo', perfil, ubicacionNombre })
  }

  if (estado.fase === 'verificando_sesion') {
    return <PantallaCarga mensaje="Verificando sesión…" />
  }

  if (estado.fase === 'sin_sesion') {
    return <LoginScreen />
  }

  if (estado.fase === 'cargando_perfil') {
    return <PantallaCarga mensaje="Cargando perfil clínico…" />
  }

  if (estado.fase === 'error_perfil') {
    return <PantallaErrorPerfil mensaje={estado.mensaje} />
  }

  // estado.fase === 'listo'
  const { perfil, ubicacionNombre } = estado
  const vistaPermitida =
    !VISTAS_SOLO_ADMINISTRADOR.includes(vistaActiva) || perfil.rol === 'ADMINISTRADOR'

  return (
    <MainLayout
      usuario={{
        nombre: perfil.nombreCompleto ?? perfil.nombreUsuario,
        rol: perfil.rol,
        ubicacionNombre,
      }}
      vistaActiva={vistaActiva}
      onNavegar={setVistaActiva}
    >
      {vistaPermitida ? (
        <ContenidoVista vista={vistaActiva} />
      ) : (
        <PanelAccesoRestringido />
      )}
    </MainLayout>
  )
}

// ------------------------------------------------------------------
// Resolución del nombre de ubicación
// ------------------------------------------------------------------

/**
 * Traduce perfil.ubicacionId (UUID) a un nombre legible como
 * "Farmacia 2". ADMINISTRADOR no tiene una sola ubicación fija por
 * diseño (ver CONSTRAINT area_requiere_ubicacion en
 * docs/arquitectura.md: solo PERSONAL_CLINICA está obligado a tener
 * ubicacion_id) — para ese rol se devuelve null y MainLayout ya sabe
 * mostrar "Todas las ubicaciones" en su lugar.
 *
 * Si el rol es PERSONAL_CLINICA pero la consulta de ubicaciones falla
 * o el id no aparece en la lista (por ejemplo, una ubicación fue
 * desactivada después de asignarse), se devuelve null en vez de
 * bloquear el acceso completo del usuario por un dato puramente
 * cosmético del encabezado — el error se deja en consola para
 * diagnóstico, pero no le impide a la persona seguir trabajando.
 */
async function resolverNombreUbicacion(
  perfil: PerfilActual,
): Promise<string | null> {
  if (perfil.rol === 'ADMINISTRADOR' || !perfil.ubicacionId) {
    return null
  }

  const resultado = await obtenerUbicaciones()

  if (!resultado.success) {
    console.error(
      '[App] No se pudo resolver el nombre de la ubicación:',
      resultado.error,
    )
    return null
  }

  const ubicacion = resultado.data.find((u) => u.id === perfil.ubicacionId)

  if (!ubicacion) {
    console.error(
      '[App] ubicacion_id del perfil no corresponde a ninguna ubicación activa:',
      perfil.ubicacionId,
    )
    return null
  }

  return ubicacion.nombre
}

// ------------------------------------------------------------------
// Pantallas de estado (carga / error)
// ------------------------------------------------------------------

function PantallaCarga({ mensaje }: { mensaje: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-900">
      <div className="flex flex-col items-center gap-4">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-text-onink-muted border-t-accent"
          role="status"
          aria-label="Cargando"
        />
        <p className="text-sm text-text-onink-muted">{mensaje}</p>
      </div>
    </div>
  )
}

/**
 * Único punto de la app donde una pantalla de estado NO está montada
 * dentro de MainLayout — a diferencia de PanelAccesoRestringido (que
 * sigue teniendo el sidebar completo con su propio botón de cerrar
 * sesión y navegación), aquí getPerfilActual() falló, así que no hay
 * ni perfil ni ubicación para construir el layout. Sin un botón propio
 * de salida, quien cae aquí queda atrapado sin más opción que recargar
 * la pestaña — por eso este botón, igual que el de MainLayout, usa el
 * wrapper signOut() de api/auth.ts (nunca supabase.auth.* directo, ver
 * la nota de auth.ts). Cerrar la sesión dispara el listener de
 * subscribeToAuthChanges() en App(), que a su vez pasa el estado a
 * 'sin_sesion' y monta LoginScreen — el "volver al inicio" ocurre solo,
 * no hace falta una navegación manual aparte.
 */
function PantallaErrorPerfil({ mensaje }: { mensaje: string }) {
  const [cerrandoSesion, setCerrandoSesion] = useState(false)
  const [errorCierre, setErrorCierre] = useState<string | null>(null)

  async function manejarCerrarSesion() {
    setCerrandoSesion(true)
    setErrorCierre(null)

    const resultado = await signOut()

    if (!resultado.success) {
      setErrorCierre(resultado.error.message)
      setCerrandoSesion(false)
    }

    // Sin redirección manual en el caso de éxito: el listener de
    // subscribeToAuthChanges() en App() se encarga de pasar a LoginScreen.
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-900 px-4">
      <div className="w-full max-w-sm rounded-lg bg-canvas-card p-8 text-center shadow-xl">
        <p className="mb-2 text-sm font-medium text-status-critico">
          No se pudo cargar tu perfil
        </p>
        <p className="text-sm text-text-muted">{mensaje}</p>

        <button
          type="button"
          onClick={manejarCerrarSesion}
          disabled={cerrandoSesion}
          className="mt-6 w-full rounded-md bg-ink-900 px-4 py-2.5 text-sm font-medium text-text-onink transition-colors hover:bg-ink-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          {cerrandoSesion ? 'Cerrando sesión…' : 'Cerrar sesión / Volver al inicio'}
        </button>
        {errorCierre && <p className="mt-2 text-xs text-status-critico">{errorCierre}</p>}
      </div>
    </div>
  )
}

function PanelAccesoRestringido() {
  return (
    <div className="rounded-lg border border-border bg-canvas-card p-8 text-center">
      <p className="text-sm font-medium text-status-critico">Acceso restringido</p>
      <p className="mt-1 text-sm text-text-muted">
        Tu rol no tiene permiso para ver esta sección.
      </p>
    </div>
  )
}

// ------------------------------------------------------------------
// Despacho de vistas operativas
// ------------------------------------------------------------------

/**
 * Marcador de posición deliberado para cada vista: los módulos reales
 * (DashboardScreen, CatalogoScreen, MovimientosScreen, ReportesScreen)
 * todavía no se han construido en esta sesión. Reemplazar cada caso
 * de este switch por el componente correspondiente es el siguiente
 * trabajo de src/components/, módulo por módulo — exactamente como
 * hemos venido avanzando con la capa de api/.
 */
function ContenidoVista({ vista }: { vista: VistaPrincipal }) {
  switch (vista) {
    case 'dashboard':
      return <DashboardScreen />
    case 'catalogo':
      return <CatalogoScreen />
    case 'movimientos':
      return <MovimientosScreen />
    case 'reportes':
      return <ReportesScreen />
    case 'usuarios':
      return <UsuariosScreen />
    default:
      return (
        <PanelMarcador
          titulo="Módulo no encontrado"
          descripcion="La vista solicitada no está configurada en el despachador central."
        />
      )
  }
}

function PanelMarcador({
  titulo,
  descripcion,
}: {
  titulo: string
  descripcion: string
}) {
  return (
    <div className="rounded-lg border border-border bg-canvas-card p-8">
      <h2 className="text-lg font-semibold text-text-primary">{titulo}</h2>
      <p className="mt-2 text-sm text-text-muted">{descripcion}</p>
      <p className="mt-4 text-xs text-text-muted">
        Módulo pendiente de implementación.
      </p>
    </div>
  )
}