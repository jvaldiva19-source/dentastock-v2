/**
 * src/lib/result.ts
 *
 * Contenedor genérico de resultado, compartido por todos los módulos de
 * src/api/. Centraliza la FORMA del patrón de unión discriminada que se
 * introdujo en auth.ts ({ success: true; data } | { success: false; error })
 * para que cada módulo nuevo (inventario.ts, movimientos.ts, catalogo.ts,
 * reportes.ts) no reimplemente su propia versión del contenedor.
 *
 * Lo que NO se comparte aquí es el significado de los errores: cada
 * módulo de dominio sigue definiendo su propia clase de error con sus
 * propios códigos (DentaAuthError en auth.ts, InventarioApiError en
 * inventario.ts, etc.), porque un error de "credenciales inválidas" y
 * un error de "consulta de stock fallida" no deberían poder confundirse
 * por compartir una misma clase genérica.
 */

export type Result<T, TError> =
  | { success: true; data: T }
  | { success: false; error: TError }

export function okResult<T>(data: T): { success: true; data: T } {
  return { success: true, data }
}

export function failResult<TError>(
  error: TError,
): { success: false; error: TError } {
  return { success: false, error }
}