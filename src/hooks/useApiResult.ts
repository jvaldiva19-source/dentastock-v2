import { useCallback, useEffect, useState } from 'react'
import type { Result } from '../lib/result'

/**
 * src/hooks/useApiResult.ts
 *
 * Adapta cualquier función de src/api/ que devuelva Result<T, TError>
 * a un estado de React listo para renderizar, sin que cada pantalla
 * tenga que repetir su propio useEffect + useState + manejo de
 * desmontaje. Es la contraparte de UI del mismo patrón de unión
 * discriminada que ya gobierna toda la capa de datos: en vez de
 * banderas sueltas (cargando, error, data) que permitirían estados
 * imposibles, el consumidor recibe exactamente un .fase de los tres
 * válidos.
 *
 * Uso típico en una pantalla:
 *
 *   const resumen = useApiResult(() => obtenerResumenAuditoria())
 *
 *   if (resumen.fase === 'cargando') return <Spinner />
 *   if (resumen.fase === 'error') return <Error mensaje={resumen.error.message} />
 *   return <Panel datos={resumen.data} />
 *
 * El parámetro `deps` sigue la misma semántica que el arreglo de
 * dependencias de useEffect: cuando cambia, se vuelve a ejecutar
 * fetcher(). Para llamadas sin parámetros (como las del Dashboard)
 * se deja vacío y solo se ejecuta al montar.
 */

export type EstadoApiResult<T, TError> =
  | { fase: 'cargando' }
  | { fase: 'error'; error: TError; recargar: () => void }
  | { fase: 'listo'; data: T; recargar: () => void }

export function useApiResult<T, TError>(
  fetcher: () => Promise<Result<T, TError>>,
  deps: unknown[] = [],
): EstadoApiResult<T, TError> {
  const [version, setVersion] = useState(0)
  const [estadoInterno, setEstadoInterno] = useState<
    { fase: 'cargando' } | { fase: 'error'; error: TError } | { fase: 'listo'; data: T }
  >({ fase: 'cargando' })

  useEffect(() => {
    let cancelado = false
    setEstadoInterno({ fase: 'cargando' })

    fetcher().then((resultado) => {
      if (cancelado) return

      if (resultado.success) {
        setEstadoInterno({ fase: 'listo', data: resultado.data })
      } else {
        setEstadoInterno({ fase: 'error', error: resultado.error })
      }
    })

    // Guarda de desmontaje: si el componente se desmonta (el usuario
    // navega a otra pantalla) antes de que la promesa resuelva, este
    // flag evita un setState sobre un componente ya desmontado.
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version])

  const recargar = useCallback(() => setVersion((v) => v + 1), [])

  if (estadoInterno.fase === 'cargando') {
    return { fase: 'cargando' }
  }

  if (estadoInterno.fase === 'error') {
    return { fase: 'error', error: estadoInterno.error, recargar }
  }

  return { fase: 'listo', data: estadoInterno.data, recargar }
}