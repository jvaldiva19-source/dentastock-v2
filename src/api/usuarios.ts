import type { PostgrestError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { type Result, okResult, failResult } from '../lib/result'
import type { Usuario, TablesInsert } from '../types/database.types'

/**
 * src/api/usuarios.ts
 *
 * Capa de gestión del personal de la clínica (tabla 'usuarios'). Antes
 * obtenerUsuarios() vivía en catalogo.ts (se agregó ahí de paso, solo
 * para alimentar el filtro "Usuario" de PanelAnalitica) — se movió
 * aquí porque ahora existe un módulo real de administración
 * (UsuariosScreen.tsx) y 'usuarios' no es un catálogo de inventario
 * como productos/categorías/proveedores/ubicaciones, es personal.
 *
 * NOTA DE AUTENTICACIÓN — LEER ANTES DE TOCAR crearUsuario(): esta
 * versión inserta directamente en la tabla pública 'usuarios' sin
 * crear ninguna cuenta real de Supabase Auth. auth_id es NOT NULL en
 * el esquema (referencia esperada a auth.users.id), así que aquí se
 * genera un UUID aleatorio como marcador de posición — la persona
 * queda dada de alta en el directorio de personal, pero NO podrá
 * iniciar sesión hasta que se conecte con Supabase Auth (ej. un flujo
 * de invitación por correo que cree el auth.users real y actualice
 * este mismo registro con su id verdadero). Es una limitación conocida
 * y aceptada explícitamente para esta fase — no la resuelvas por tu
 * cuenta sin confirmarlo, ya que cambiar esto implica decidir el flujo
 * de invitación/alta de credenciales.
 */

// ------------------------------------------------------------------
// Tipos de resultado y error de este dominio
// ------------------------------------------------------------------

export type UsuariosErrorCode =
  | 'DATOS_INVALIDOS'
  | 'NOMBRE_USUARIO_DUPLICADO'
  | 'UBICACION_REQUERIDA'
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

/**
 * Traduce SQLSTATE de Postgres a códigos de dominio — mismo criterio
 * que traducirErrorPostgrest() en catalogo.ts: .code es el SQLSTATE
 * estándar, no depende de la redacción del mensaje.
 */
function traducirErrorPostgrest(error: PostgrestError): UsuariosApiError {
  // 23505 = unique_violation (nombre_usuario ya existe)
  if (error.code === '23505') {
    return new UsuariosApiError(
      'NOMBRE_USUARIO_DUPLICADO',
      'Ya existe un usuario registrado con ese nombre de usuario.',
    )
  }

  // 23514 = check_violation — cubre la restricción de negocio que exige
  // ubicacion_id para PERSONAL_CLINICA (ver validarDatosUsuario más abajo,
  // que ya valida esto antes de llegar aquí; esto es la red de respaldo
  // del motor si algún día cambia el chequeo del lado del cliente).
  if (error.code === '23514') {
    return new UsuariosApiError(
      'UBICACION_REQUERIDA',
      'El personal de clínica requiere una ubicación asignada.',
    )
  }

  return new UsuariosApiError(
    'ERROR_DESCONOCIDO',
    'Ocurrió un error al guardar el usuario. Intenta de nuevo o contacta al administrador.',
  )
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

/**
 * Espeja la misma restricción de negocio documentada en App.tsx
 * (resolverNombreUbicacion): solo PERSONAL_CLINICA está obligado a
 * tener ubicacion_id — ADMINISTRADOR no tiene una sola área fija.
 * Validado aquí en el cliente para un mensaje inmediato; el motor
 * sigue siendo la garantía real si esta regla también existe como
 * CONSTRAINT en la base de datos.
 */
function validarDatosUsuario(datos: {
  nombre_completo?: string | null
  nombre_usuario?: string
  rol?: string
  ubicacion_id?: string | null
}): string | null {
  if (!datos.nombre_completo || datos.nombre_completo.trim().length === 0) {
    return 'El nombre completo es obligatorio.'
  }

  if (!datos.nombre_usuario || datos.nombre_usuario.trim().length === 0) {
    return 'El nombre de usuario es obligatorio.'
  }

  if (!datos.rol) {
    return 'Debes seleccionar un rol para el usuario.'
  }

  if (datos.rol === 'PERSONAL_CLINICA' && !datos.ubicacion_id) {
    return 'El personal de clínica requiere una ubicación asignada.'
  }

  return null
}

/**
 * Alta de personal en el directorio — ver la nota de autenticación al
 * inicio del archivo: auth_id se genera aquí como UUID aleatorio
 * (marcador de posición) porque todavía no existe integración con
 * Supabase Auth. `datos` no incluye auth_id ni created_at/updated_at
 * porque esta función es la única responsable de generarlos.
 */
export async function crearUsuario(
  datos: Omit<TablesInsert<'usuarios'>, 'auth_id'>,
): Promise<UsuariosResult<Usuario>> {
  const errorValidacion = validarDatosUsuario(datos)
  if (errorValidacion) {
    return fail('DATOS_INVALIDOS', errorValidacion)
  }

  try {
    const payload: TablesInsert<'usuarios'> = {
      ...datos,
      nombre_usuario: datos.nombre_usuario.trim().toLowerCase(),
      nombre_completo: datos.nombre_completo?.trim() || null,
      // Marcador de posición hasta conectar con Supabase Auth — ver
      // nota de autenticación al inicio del archivo.
      auth_id: crypto.randomUUID(),
    }

    const { data: usuario, error } = await supabase
      .from('usuarios')
      .insert(payload)
      .select()
      .single()

    if (error || !usuario) {
      console.error('[usuarios] crearUsuario:', error)
      return failResult(traducirErrorPostgrest(error!))
    }

    return ok(usuario)
  } catch (err) {
    console.error('[usuarios] crearUsuario (excepción):', err)
    return fail(
      'ERROR_RED',
      'No fue posible conectar con el servidor para crear el usuario.',
    )
  }
}
