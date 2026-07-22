import type { PostgrestError } from '@supabase/supabase-js'

/**
 * src/lib/paginacion.ts
 *
 * PostgREST (el motor HTTP detrás de supabase-js) impone un límite de
 * fila por defecto — 1000 — a cualquier consulta que no especifique
 * .range() explícitamente. Con 1,778 productos en el catálogo (y
 * creciendo), cualquier .select() sin paginar trunca el resultado en
 * silencio: no lanza error, simplemente entrega las primeras 1000 filas
 * según el .order() aplicado, sin avisar que quedaron filas fuera.
 *
 * Esta función pagina automáticamente cualquier consulta de Supabase en
 * bloques de `tamanioPagina` filas, acumulando resultados hasta que una
 * página devuelve menos filas de las solicitadas — la señal de que ya
 * no quedan más páginas.
 */
export async function obtenerTodasLasFilas<T>(
  construirConsulta: (
    desde: number,
    hasta: number,
  ) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
  tamanioPagina = 1000,
): Promise<{ data: T[]; error: PostgrestError | null }> {
  const filas: T[] = []
  let desde = 0

  while (true) {
    const { data, error } = await construirConsulta(desde, desde + tamanioPagina - 1)

    if (error) {
      return { data: filas, error }
    }

    const pagina = data ?? []
    filas.push(...pagina)

    if (pagina.length < tamanioPagina) {
      break
    }

    desde += tamanioPagina
  }

  return { data: filas, error: null }
}
