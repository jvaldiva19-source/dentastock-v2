import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { type Result, okResult, failResult } from '../lib/result'
import type { Usuario, Enums } from '../types/database.types'

/**
 * src/api/usuarios.ts
 *
 * Capa de gestión del personal de la clínica (tabla 'usuarios').
 *
 * NOTA DE AUTENTICACIÓN — crearUsuario() ya crea una cuenta REAL de
 * Supabase Auth (a diferencia de la primera versión de este archivo,
 * que solo insertaba en la tabla pública 'usuarios' con un auth_id
 * aleatorio de marcador de posición — esa persona nunca podía iniciar
 * sesión). El alta ahora pasa por la Edge Function
 * supabase/functions/crear-usuario/index.ts, no por un INSERT directo
 * desde el cliente, por dos razones que si o si requieren un contexto
 * de servidor:
 *
 *   1. Crear una cuenta de Auth con contraseña propia requiere
 *      `auth.admin.createUser()`, que SOLO funciona con la Service
 *      Role Key — una clave que nunca debe llegar al navegador porque
 *      ignora por completo RLS. Por eso esa clave vive únicamente
 *      dentro de la Edge Function (Supabase la inyecta ahí sola),
 *      jamás en una variable VITE_*.
 *   2. La alternativa sin servidor, `supabase.auth.signUp()` desde el
 *      cliente, se descartó a propósito: si se llama con la sesión de
 *      un ADMIN ya activa, signUp() puede reemplazar esa
 *      sesión por la del usuario recién creado — el administrador
 *      quedaría deslogueado de su propia sesión sin aviso.
 *
 * Desplegar la función (no se puede hacer desde este entorno — hace
 * falta el CLI de Supabase autenticado contra tu proyecto real):
 *
 *   supabase functions deploy crear-usuario
 *
 * Mientras no esté desplegada, crearUsuario() devuelve un error claro
 * en vez de fallar en silencio (ver el catch de invocarFuncion más
 * abajo).
 */

// ------------------------------------------------------------------
// Tipos de resultado y error de este dominio
// ------------------------------------------------------------------

export type UsuariosErrorCode =
  | 'DATOS_INVALIDOS'
  | 'NOMBRE_USUARIO_DUPLICADO'
  | 'CORREO_DUPLICADO'
  | 'UBICACION_REQUERIDA'
  | 'SIN_PERMISOS'
  | 'FUNCION_NO_DISPONIBLE'
  | 'CONSULTA_FALLIDA'
  | 'ERROR_RED'
  | 'ERROR_DESCONOCIDO'

export class UsuariosApiError extends Error {
  readonly code: UsuariosErrorCode

  constructor(code: UsuariosErrorCode, message: string) {
    super(message)
    this.name = 'UsuariosApiError'
    this.code = code
  }
}

export type UsuariosResult<T> = Result<T, UsuariosApiError>

function fail(code: UsuariosErrorCode, message: string): UsuariosResult<never> {
  return failResult(new UsuariosApiError(code, message))
}

function ok<T>(data: T): UsuariosResult<T> {
  return okResult(data)
}

// ------------------------------------------------------------------
// 1. obtenerUsuarios
// ------------------------------------------------------------------

/**
 * Trae TODOS los usuarios (activos e inactivos — igual que
 * obtenerProductos() en catalogo.ts, la UI decide cómo distinguirlos
 * visualmente en vez de que esta función filtre de antemano).
 */
export async function obtenerUsuarios(): Promise<UsuariosResult<Usuario[]>> {
  try {
    const { data, error } = await supabase
      .from('usuarios')
      .select('*')
      .order('nombre_completo', { ascending: true })

    if (error) {
      console.error('[usuarios] obtenerUsuarios:', error)
      return fail(
        'CONSULTA_FALLIDA',
        'No se pudo consultar la lista de usuarios. Intenta de nuevo.',
      )
    }

    return ok(data ?? [])
  } catch (err) {
    console.error('[usuarios] obtenerUsuarios (excepción):', err)
    return fail(
      'ERROR_RED',
      'No fue posible conectar con el servidor para consultar usuarios.',
    )
  }
}

// ------------------------------------------------------------------
// 2. crearUsuario
// ------------------------------------------------------------------

export interface DatosNuevoUsuario {
  nombre_completo: string
  nombre_usuario: string
  /** Requerido: es el identificador de inicio de sesión de la cuenta de Auth. */
  email: string
  /** Contraseña inicial en texto plano — viaja solo hacia la Edge Function (HTTPS), nunca se persiste tal cual en 'usuarios'. */
  password: string
  rol: Enums<'rol_usuario'>
  ubicacion_id: string | null
  activo: boolean
}

/**
 * Espeja la misma restricción de negocio documentada en App.tsx
 * (resolverNombreUbicacion): solo ENCARGADO_FARMACIA está obligado a
 * tener ubicacion_id — ADMIN no tiene una sola área fija.
 * Validado aquí en el cliente para un mensaje inmediato; la Edge
 * Function repite estas mismas validaciones del lado del servidor,
 * que es la garantía real.
 */
function validarDatosUsuario(datos: DatosNuevoUsuario): string | null {
  if (!datos.nombre_completo || datos.nombre_completo.trim().length === 0) {
    return 'El nombre completo es obligatorio.'
  }

  if (!datos.nombre_usuario || datos.nombre_usuario.trim().length === 0) {
    return 'El nombre de usuario es obligatorio.'
  }

  if (!datos.email || !datos.email.includes('@')) {
    return 'Debes capturar un correo electrónico válido — es el identificador de inicio de sesión.'
  }

  if (!datos.password || datos.password.length < 8) {
    return 'La contraseña debe tener al menos 8 caracteres.'
  }

  if (!datos.rol) {
    return 'Debes seleccionar un rol para el usuario.'
  }

  if (datos.rol === 'ENCARGADO_FARMACIA' && !datos.ubicacion_id) {
    return 'El encargado de farmacia requiere una ubicación asignada.'
  }

  return null
}

/**
 * Lee el mensaje de error que la Edge Function ya devuelve traducido
 * ({"error": "..."} en el cuerpo de la respuesta) — invoke() no expone
 * ese cuerpo directamente en FunctionsHttpError, hay que leerlo de
 * error.context (el Response crudo).
 */
async function leerMensajeDeFuncion(error: unknown): Promise<string | null> {
  if (!(error instanceof FunctionsHttpError)) {
    return null
  }

  try {
    const cuerpo = await error.context.json()
    return typeof cuerpo?.error === 'string' ? cuerpo.error : null
  } catch {
    return null
  }
}

/**
 * Alta real de personal: crea la cuenta de Supabase Auth (correo +
 * contraseña) Y el perfil en 'public.usuarios' en una sola operación
 * atómica, vía la Edge Function crear-usuario (ver la nota de
 * autenticación al inicio del archivo sobre por qué no es un INSERT
 * directo). La persona puede iniciar sesión de inmediato con el
 * correo y la contraseña capturados aquí.
 */
export async function crearUsuario(
  datos: DatosNuevoUsuario,
): Promise<UsuariosResult<Usuario>> {
  const errorValidacion = validarDatosUsuario(datos)
  if (errorValidacion) {
    return fail('DATOS_INVALIDOS', errorValidacion)
  }

  try {
    const { data, error } = await supabase.functions.invoke('crear-usuario', {
      body: {
        nombre_completo: datos.nombre_completo.trim(),
        nombre_usuario: datos.nombre_usuario.trim().toLowerCase(),
        email: datos.email.trim(),
        password: datos.password,
        rol: datos.rol,
        ubicacion_id: datos.rol === 'ENCARGADO_FARMACIA' ? datos.ubicacion_id : null,
        activo: datos.activo,
      },
    })

    if (error) {
      const mensajeFuncion = await leerMensajeDeFuncion(error)
      console.error('[usuarios] crearUsuario (edge function):', error, mensajeFuncion)

      if (mensajeFuncion) {
        const codigo: UsuariosErrorCode = mensajeFuncion.includes('nombre de usuario')
          ? 'NOMBRE_USUARIO_DUPLICADO'
          : mensajeFuncion.includes('correo')
            ? 'CORREO_DUPLICADO'
            : mensajeFuncion.includes('ubicación')
              ? 'UBICACION_REQUERIDA'
              : mensajeFuncion.includes('permisos')
                ? 'SIN_PERMISOS'
                : 'ERROR_DESCONOCIDO'

        return fail(codigo, mensajeFuncion)
      }

      // No hubo cuerpo JSON legible: lo más probable es que la función
      // todavía no esté desplegada en el proyecto (404) o un fallo de
      // red, no un rechazo de negocio.
      return fail(
        'FUNCION_NO_DISPONIBLE',
        'No se pudo contactar la función "crear-usuario". Verifica que esté desplegada en tu proyecto de Supabase (supabase functions deploy crear-usuario).',
      )
    }

    return ok(data.usuario as Usuario)
  } catch (err) {
    console.error('[usuarios] crearUsuario (excepción):', err)
    return fail(
      'ERROR_RED',
      'No fue posible conectar con el servidor para crear el usuario.',
    )
  }
}
