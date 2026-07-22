import type { PostgrestError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { type Result, okResult, failResult } from '../lib/result'
import { obtenerTodasLasFilas } from '../lib/paginacion'
import type {
  Producto,
  Categoria,
  Proveedor,
  Ubicacion,
  TablesInsert,
  TablesUpdate,
} from '../types/database.types'

/**
 * src/api/catalogo.ts
 *
 * Capa de gestión del catálogo maestro: productos (con su categoría
 * embebida) y lectura de proveedores activos. La creación/edición de
 * proveedores no vive en este módulo todavía porque no fue parte del
 * alcance solicitado — solo se expone obtenerProveedores(), pensado
 * para alimentar el selector de proveedor al registrar una entrada en
 * src/api/movimientos.ts.
 */

// ------------------------------------------------------------------
// Tipos de resultado y error de este dominio
// ------------------------------------------------------------------

export type CatalogoErrorCode =
  | 'DATOS_INVALIDOS'
  | 'CODIGO_DUPLICADO'
  | 'CATEGORIA_INVALIDA'
  | 'PRODUCTO_NO_ENCONTRADO'
  | 'CONSULTA_FALLIDA'
  | 'ERROR_RED'
  | 'ERROR_DESCONOCIDO'

export class CatalogoApiError extends Error {
  readonly code: CatalogoErrorCode

  constructor(code: CatalogoErrorCode, message: string) {
    super(message)
    this.name = 'CatalogoApiError'
    this.code = code
  }
}

export type CatalogoResult<T> = Result<T, CatalogoApiError>

function fail(code: CatalogoErrorCode, message: string): CatalogoResult<never> {
  return failResult(new CatalogoApiError(code, message))
}

function ok<T>(data: T): CatalogoResult<T> {
  return okResult(data)
}

/**
 * Traduce errores de Postgres a códigos de dominio usando el campo
 * .code de PostgrestError (el SQLSTATE estándar), NO el texto del
 * mensaje. A diferencia de traducirErrorMotor() en movimientos.ts —
 * que tiene que interpretar el texto de una RAISE EXCEPTION
 * personalizada del trigger, sin un código estándar propio — las
 * violaciones de restricciones (unicidad, llave foránea) sí tienen
 * un SQLSTATE fijo y documentado por PostgreSQL, así que aquí
 * podemos confiar en .code en vez de parsear texto: es más robusto
 * porque no depende de la redacción exacta del mensaje de error.
 */
function traducirErrorPostgrest(error: PostgrestError): CatalogoApiError {
  // 23505 = unique_violation
  if (error.code === '23505') {
    return new CatalogoApiError(
      'CODIGO_DUPLICADO',
      'Ya existe un producto registrado con ese código de barras.',
    )
  }

  // 23503 = foreign_key_violation
  if (error.code === '23503') {
    return new CatalogoApiError(
      'CATEGORIA_INVALIDA',
      'La categoría seleccionada no existe o fue eliminada. Selecciona otra.',
    )
  }

  return new CatalogoApiError(
    'ERROR_DESCONOCIDO',
    'Ocurrió un error al guardar el producto. Intenta de nuevo o contacta al administrador.',
  )
}

// ------------------------------------------------------------------
// Forma de retorno enriquecida con la categoría embebida
// ------------------------------------------------------------------

export interface ProductoConCategoria extends Producto {
  categoria: Pick<Categoria, 'id' | 'nombre' | 'requiere_cadena_frio'> | null
}

// ------------------------------------------------------------------
// 1. obtenerProductos
// ------------------------------------------------------------------

/**
 * Trae el catálogo completo de productos (activos e inactivos —
 * la UI decide cómo distinguirlos visualmente, esta función no filtra)
 * con su categoría correspondiente embebida en una sola consulta,
 * en lugar de hacer N+1 consultas separadas a 'categorias'.
 *
 * Paginada con obtenerTodasLasFilas() porque PostgREST trunca a 1000
 * filas por defecto — con 1,778 productos en catálogo, un .select() sin
 * paginar dejaba fuera (en silencio) a todo lo que ordena después de la
 * fila 1000 según 'concepto', rompiendo tanto el orden alfabético
 * completo como cualquier total calculado sobre este arreglo.
 */
export async function obtenerProductos(): Promise<
  CatalogoResult<ProductoConCategoria[]>
> {
  try {
    const { data, error } = await obtenerTodasLasFilas((desde, hasta) =>
      supabase
        .from('productos')
        .select('*, categoria:categorias(id, nombre, requiere_cadena_frio)')
        .order('concepto', { ascending: true })
        .range(desde, hasta),
    )

    if (error) {
      console.error('[catalogo] obtenerProductos:', error)
      return fail(
        'CONSULTA_FALLIDA',
        'No se pudo consultar el catálogo de productos. Intenta de nuevo.',
      )
    }

    return ok((data ?? []) as unknown as ProductoConCategoria[])
  } catch (err) {
    console.error('[catalogo] obtenerProductos (excepción):', err)
    return fail(
      'ERROR_RED',
      'No fue posible conectar con el servidor para consultar el catálogo.',
    )
  }
}

// ------------------------------------------------------------------
// 2. crearProducto
// ------------------------------------------------------------------

/**
 * Valida en el cliente, antes de tocar la red, las mismas reglas que
 * la base de datos impone con CONSTRAINTS — no porque la validación
 * del cliente sea la garantía real (esa siempre es el motor), sino
 * para darle a quien está llenando el formulario un mensaje inmediato
 * en vez de esperar un round-trip completo solo para descubrir que el
 * precio con IVA quedó por debajo del precio sin IVA.
 */
function validarDatosProducto(datos: {
  codigo_barras?: string
  concepto?: string
  precio_sin_iva?: number | null
  precio_con_iva?: number | null
}): string | null {
  if (!datos.codigo_barras || datos.codigo_barras.trim().length === 0) {
    return 'El código de barras es obligatorio.'
  }

  if (!datos.concepto || datos.concepto.trim().length === 0) {
    return 'El nombre del insumo es obligatorio.'
  }

  if (
    datos.precio_sin_iva != null &&
    datos.precio_con_iva != null &&
    datos.precio_con_iva < datos.precio_sin_iva
  ) {
    return 'El precio con IVA no puede ser menor al precio sin IVA.'
  }

  return null
}

export async function crearProducto(
  datos: TablesInsert<'productos'>,
): Promise<CatalogoResult<Producto>> {
  const errorValidacion = validarDatosProducto(datos)
  if (errorValidacion) {
    return fail('DATOS_INVALIDOS', errorValidacion)
  }

  try {
    // Normalización heredada deliberadamente de la versión anterior del
    // sistema: los códigos de barras se guardan siempre en mayúsculas y
    // sin espacios, para que una pistola lectora que dispare el mismo
    // código con un espacio accidental al final no genere un producto
    // duplicado por una diferencia puramente cosmética.
    const codigoNormalizado = datos.codigo_barras.trim().toUpperCase()

    const { data: producto, error } = await supabase
      .from('productos')
      .insert({ ...datos, codigo_barras: codigoNormalizado })
      .select()
      .single()

    if (error || !producto) {
      console.error('[catalogo] crearProducto:', error)
      return failResult(traducirErrorPostgrest(error!))
    }

    return ok(producto)
  } catch (err) {
    console.error('[catalogo] crearProducto (excepción):', err)
    return fail(
      'ERROR_RED',
      'No fue posible conectar con el servidor para crear el producto.',
    )
  }
}

// ------------------------------------------------------------------
// 3. actualizarProducto
// ------------------------------------------------------------------

export async function actualizarProducto(
  id: string,
  datos: TablesUpdate<'productos'>,
): Promise<CatalogoResult<Producto>> {
  if (!id || id.trim().length === 0) {
    return fail('DATOS_INVALIDOS', 'Debes especificar el producto a actualizar.')
  }

  const errorValidacion = validarDatosProducto(datos)
  if (errorValidacion) {
    return fail('DATOS_INVALIDOS', errorValidacion)
  }

  try {
    const payload = { ...datos }
    if (payload.codigo_barras) {
      payload.codigo_barras = payload.codigo_barras.trim().toUpperCase()
    }

    const { data: producto, error } = await supabase
      .from('productos')
      .update(payload)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('[catalogo] actualizarProducto:', error)
      return failResult(traducirErrorPostgrest(error))
    }

    if (!producto) {
      return fail(
        'PRODUCTO_NO_ENCONTRADO',
        'No se encontró el producto que intentas actualizar.',
      )
    }

    return ok(producto)
  } catch (err) {
    console.error('[catalogo] actualizarProducto (excepción):', err)
    return fail(
      'ERROR_RED',
      'No fue posible conectar con el servidor para actualizar el producto.',
    )
  }
}

// ------------------------------------------------------------------
// 4. obtenerProveedores
// ------------------------------------------------------------------

/**
 * Trae únicamente proveedores activos (activo = true), pensado para
 * alimentar el selector de proveedor en el formulario de recepción de
 * src/api/movimientos.ts — registrarEntradaProveedor(). Un proveedor
 * dado de baja no debe aparecer como opción al capturar una nueva
 * entrada, aunque su historial siga intacto en movimientos pasados.
 */
export async function obtenerProveedores(): Promise<CatalogoResult<Proveedor[]>> {
  try {
    const { data, error } = await supabase
      .from('proveedores')
      .select('*')
      .eq('activo', true)
      .order('nombre', { ascending: true })

    if (error) {
      console.error('[catalogo] obtenerProveedores:', error)
      return fail(
        'CONSULTA_FALLIDA',
        'No se pudo consultar la lista de proveedores. Intenta de nuevo.',
      )
    }

    return ok(data ?? [])
  } catch (err) {
    console.error('[catalogo] obtenerProveedores (excepción):', err)
    return fail(
      'ERROR_RED',
      'No fue posible conectar con el servidor para consultar proveedores.',
    )
  }
}

// ------------------------------------------------------------------
// 5. obtenerCategorias
// ------------------------------------------------------------------

/**
 * Trae todas las categorías de insumos, usadas como opciones del
 * selector en el formulario de creación/edición de productos de
 * CatalogoScreen. Pequeño catálogo de referencia de baja frecuencia
 * de cambio — igual que ubicaciones y proveedores.
 */
export async function obtenerCategorias(): Promise<CatalogoResult<Categoria[]>> {
  try {
    const { data, error } = await supabase
      .from('categorias')
      .select('*')
      .order('nombre', { ascending: true })

    if (error) {
      console.error('[catalogo] obtenerCategorias:', error)
      return fail(
        'CONSULTA_FALLIDA',
        'No se pudo consultar las categorías. Intenta de nuevo.',
      )
    }

    return ok(data ?? [])
  } catch (err) {
    console.error('[catalogo] obtenerCategorias (excepción):', err)
    return fail(
      'ERROR_RED',
      'No fue posible conectar con el servidor para consultar categorías.',
    )
  }
}

// ------------------------------------------------------------------
// 6. obtenerUbicaciones
// ------------------------------------------------------------------

/**
 * Trae todas las ubicaciones activas. Se agrega aquí, junto a
 * obtenerProveedores(), porque 'ubicaciones' es exactamente el mismo
 * tipo de dato maestro de referencia que 'proveedores': un catálogo
 * pequeño y de baja frecuencia de cambio, no una entidad transaccional.
 *
 * Caso de uso principal: resolver el nombre legible de la
 * ubicacion_id de un usuario (un UUID) a algo mostrable como
 * "Farmacia 2" para el encabezado de MainLayout — Supabase no
 * devuelve ese join automáticamente desde getPerfilActual() porque
 * esa función solo lee la tabla 'usuarios'.
 */
export async function obtenerUbicaciones(): Promise<CatalogoResult<Ubicacion[]>> {
  try {
    const { data, error } = await supabase
      .from('ubicaciones')
      .select('*')
      .eq('activo', true)
      .order('nombre', { ascending: true })

    if (error) {
      console.error('[catalogo] obtenerUbicaciones:', error)
      return fail(
        'CONSULTA_FALLIDA',
        'No se pudo consultar la lista de ubicaciones. Intenta de nuevo.',
      )
    }

    return ok(data ?? [])
  } catch (err) {
    console.error('[catalogo] obtenerUbicaciones (excepción):', err)
    return fail(
      'ERROR_RED',
      'No fue posible conectar con el servidor para consultar ubicaciones.',
    )
  }
}