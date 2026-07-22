import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Usuario, RolUsuario } from '../types/database.types'

/**
 * src/api/auth.ts
 *
 * Capa de autenticación. Es el único archivo del proyecto que debe
 * llamar directamente a supabase.auth.* — cualquier componente o hook
 * que necesite saber quién es el usuario actual consume las funciones
 * de este módulo, nunca el cliente de Supabase de forma directa.
 *
 * Patrón de manejo de errores:
 * Cada función retorna una unión discriminada AuthResult<T> en lugar
 * de lanzar excepciones. Esto permite que la UI escriba:
 *
 *   const resultado = await signIn(email, password)
 *   if (!resultado.success) {
 *     mostrarAlerta(resultado.error.message)
 *     return
 *   }
 *   // a partir de aquí TypeScript ya sabe que resultado.data existe
 *
 * sin necesidad de envolver cada llamada en try/catch en los componentes.
 * Las excepciones inesperadas (caída de red, JSON malformado, etc.) se
 * capturan dentro de cada función y se traducen a este mismo formato,
 * de modo que el componente nunca tiene dos mecanismos de error distintos
 * que manejar al mismo tiempo.
 */

// ------------------------------------------------------------------
// Tipos de resultado y error
// ------------------------------------------------------------------

export type AuthErrorCode =
  | 'CREDENCIALES_INVALIDAS'
  | 'SIN_SESION'
  | 'PERFIL_NO_ENCONTRADO'
  | 'USUARIO_INACTIVO'
  | 'ERROR_RED'
  | 'ERROR_DESCONOCIDO'

/**
 * Error de dominio para todo lo relacionado con autenticación.
 * Se nombra DentaAuthError (no AuthError) deliberadamente: la librería
 * @supabase/supabase-js ya exporta sus propias clases AuthError /
 * AuthApiError, y reutilizar ese nombre aquí generaría ambigüedad al
 * importar ambos tipos en el mismo archivo del frontend.
 */
export class DentaAuthError extends Error {
  readonly code: AuthErrorCode

  constructor(code: AuthErrorCode, message: string) {
    super(message)
    this.name = 'DentaAuthError'
    this.code = code
  }
}

export type AuthResult<T> =
  | { success: true; data: T }
  | { success: false; error: DentaAuthError }

function fail(code: AuthErrorCode, message: string): AuthResult<never> {
  return { success: false, error: new DentaAuthError(code, message) }
}

function ok<T>(data: T): AuthResult<T> {
  return { success: true, data }
}

// ------------------------------------------------------------------
// Perfil de dominio (sesión + fila de la tabla usuarios)
// ------------------------------------------------------------------

/**
 * Forma normalizada del perfil del usuario autenticado, combinando
 * el JWT de Supabase Auth con su fila correspondiente en la tabla
 * pública 'usuarios'. Es lo que consumen los guards de ruta y los
 * componentes que necesitan condicionar la UI según el rol.
 */
export interface PerfilActual {
  id: Usuario['id']
  authId: Usuario['auth_id']
  nombreUsuario: Usuario['nombre_usuario']
  nombreCompleto: Usuario['nombre_completo']
  email: Usuario['email']
  rol: RolUsuario
  ubicacionId: Usuario['ubicacion_id']
  activo: Usuario['activo']
}

// ------------------------------------------------------------------
// signIn
// ------------------------------------------------------------------

/**
 * Inicia sesión con email y contraseña contra Supabase Auth.
 *
 * Supabase devuelve el mismo mensaje genérico "Invalid login credentials"
 * tanto si el correo no existe como si la contraseña es incorrecta. Esto
 * es una decisión de seguridad deliberada de Supabase (no revelar qué
 * dato fue el incorrecto), y este módulo la respeta en lugar de intentar
 * adivinar la causa exacta.
 */
export async function signIn(
  email: string,
  password: string,
): Promise<AuthResult<Session>> {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      return fail(
        'CREDENCIALES_INVALIDAS',
        'Usuario o contraseña incorrectos. Verifica tus datos e intenta de nuevo.',
      )
    }

    if (!data.session) {
      // No debería ocurrir si error es null, pero Supabase modela
      // session como nullable — lo cubrimos en vez de asumir.
      return fail(
        'ERROR_DESCONOCIDO',
        'No se pudo iniciar sesión. Intenta de nuevo en unos momentos.',
      )
    }

    return ok(data.session)
  } catch {
    return fail(
      'ERROR_RED',
      'No fue posible conectar con el servidor. Revisa tu conexión a internet e intenta de nuevo.',
    )
  }
}

// ------------------------------------------------------------------
// signOut
// ------------------------------------------------------------------

export async function signOut(): Promise<AuthResult<null>> {
  try {
    const { error } = await supabase.auth.signOut()

    if (error) {
      return fail(
        'ERROR_DESCONOCIDO',
        'No se pudo cerrar la sesión correctamente. Intenta de nuevo.',
      )
    }

    return ok(null)
  } catch {
    return fail(
      'ERROR_RED',
      'No fue posible conectar con el servidor para cerrar la sesión.',
    )
  }
}

// ------------------------------------------------------------------
// subscribeToAuthChanges
// ------------------------------------------------------------------

/**
 * Envuelve supabase.auth.onAuthStateChange(). Existe para que el
 * componente raíz de la aplicación (App.tsx) pueda reaccionar a
 * cambios de sesión — login, logout, refresco de token expirado —
 * sin tener que importar el cliente de Supabase directamente, lo
 * cual rompería la regla declarada al inicio de este archivo: que
 * auth.ts es el único módulo que llama a supabase.auth.* en todo
 * el proyecto.
 *
 * El callback recibe `session: Session | null` — null significa
 * "no hay sesión activa" (logout, sesión expirada sin refresco
 * posible, o arranque en frío sin sesión previa).
 *
 * Devuelve un objeto con unsubscribe() para usar directamente como
 * cleanup de un useEffect:
 *
 *   useEffect(() => {
 *     const { unsubscribe } = subscribeToAuthChanges((session) => { ... })
 *     return unsubscribe
 *   }, [])
 */
export function subscribeToAuthChanges(
  callback: (session: Session | null) => void,
): { unsubscribe: () => void } {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session)
  })

  return { unsubscribe: () => subscription.unsubscribe() }
}

// ------------------------------------------------------------------
// getSession
// ------------------------------------------------------------------

/**
 * Recupera la sesión activa almacenada localmente (no implica una
 * llamada de red en la mayoría de los casos: Supabase la mantiene en
 * memoria/localStorage y la refresca de forma automática gracias a
 * autoRefreshToken: true configurado en lib/supabase.ts).
 */
export async function getSession(): Promise<AuthResult<Session | null>> {
  try {
    const { data, error } = await supabase.auth.getSession()

    if (error) {
      return fail(
        'ERROR_DESCONOCIDO',
        'No se pudo recuperar la sesión actual.',
      )
    }

    return ok(data.session)
  } catch {
    return fail(
      'ERROR_RED',
      'No fue posible conectar con el servidor para verificar la sesión.',
    )
  }
}

// ------------------------------------------------------------------
// getPerfilActual — la función crítica
// ------------------------------------------------------------------

/**
 * Recupera el perfil de dominio completo del usuario autenticado:
 * toma el id de sesión (auth.uid(), implícito en session.user.id) y
 * hace el join contra la tabla pública 'usuarios' para traer el rol
 * ('ADMINISTRADOR' | 'PERSONAL_CLINICA') y la ubicacion_id asignada.
 *
 * Esta es la única vía recomendada para que la UI sepa "quién es" el
 * usuario en términos de negocio. La política RLS 'usuarios_lectura_propio'
 * garantiza que este SELECT solo puede devolver la fila del propio
 * usuario autenticado, nunca la de otra persona — la restricción no
 * depende de este código, depende del motor, pero esta función está
 * escrita asumiendo exactamente esa garantía.
 *
 * Casos de error cubiertos explícitamente:
 *   - SIN_SESION: no hay token activo (usuario no autenticado).
 *   - PERFIL_NO_ENCONTRADO: existe un usuario en Supabase Auth pero
 *     nadie le creó la fila correspondiente en 'usuarios' (cuenta
 *     huérfana — típicamente un error de aprovisionamiento del Admin).
 *   - USUARIO_INACTIVO: la fila existe pero fue desactivada
 *     (usuarios.activo = false), por ejemplo cuando un alumno egresa
 *     y el Administrador revoca su acceso sin borrar el historial de
 *     movimientos que generó.
 */
export async function getPerfilActual(): Promise<AuthResult<PerfilActual>> {
  try {
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession()

    if (sessionError) {
      return fail(
        'ERROR_DESCONOCIDO',
        'No se pudo verificar la sesión actual.',
      )
    }

    const session = sessionData.session
    if (!session) {
      return fail(
        'SIN_SESION',
        'No hay una sesión activa. Inicia sesión para continuar.',
      )
    }

    const { data: usuario, error: usuarioError } = await supabase
      .from('usuarios')
      .select(
        'id, auth_id, nombre_usuario, nombre_completo, email, rol, ubicacion_id, activo',
      )
      .eq('auth_id', session.user.id)
      .single()

    if (usuarioError || !usuario) {
      return fail(
        'PERFIL_NO_ENCONTRADO',
        'Tu cuenta no tiene un perfil configurado en DentaStock. Contacta al administrador del sistema.',
      )
    }

    if (!usuario.activo) {
      return fail(
        'USUARIO_INACTIVO',
        'Tu cuenta ha sido desactivada. Contacta al administrador de DentaStock si crees que esto es un error.',
      )
    }

    const perfil: PerfilActual = {
      id: usuario.id,
      authId: usuario.auth_id,
      nombreUsuario: usuario.nombre_usuario,
      nombreCompleto: usuario.nombre_completo,
      email: usuario.email,
      rol: usuario.rol,
      ubicacionId: usuario.ubicacion_id,
      activo: usuario.activo,
    }

    return ok(perfil)
  } catch {
    return fail(
      'ERROR_RED',
      'No fue posible conectar con el servidor para obtener tu perfil. Revisa tu conexión e intenta de nuevo.',
    )
  }
}