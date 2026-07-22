import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'

/**
 * Singleton del cliente de Supabase.
 *
 * Esta es la ÚNICA llamada a createClient() en todo el proyecto.
 * Ningún archivo de src/api/, src/components/ ni src/hooks/ debe
 * importar '@supabase/supabase-js' directamente — todos consumen
 * esta instancia ya tipada contra el esquema real de la base de datos.
 *
 * El genérico <Database> conecta este cliente con los tipos de
 * src/types/database.types.ts: a partir de este punto, supabase
 * .from('productos') o supabase.from('movimientos') quedan
 * autocompletados y verificados en tiempo de compilación contra
 * las columnas reales de cada tabla.
 */

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Fallo explícito en arranque, no en tiempo de ejecución silencioso.
// Si falta una variable de entorno, preferimos que la aplicación nunca
// llegue a montar la UI, en lugar de que el primer query falle con un
// mensaje de red genérico y confuso para quien lo esté depurando.
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Faltan variables de entorno requeridas: VITE_SUPABASE_URL y/o ' +
      'VITE_SUPABASE_ANON_KEY. Verifica que exista un archivo .env.local ' +
      'en la raíz del proyecto basado en .env.example.',
  )
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Mantiene la sesión en almacenamiento local del navegador entre
    // recargas — necesario porque el rol y la ubicación del usuario
    // (leídos vía fn_obtener_rol_actual() en cada policy de RLS)
    // dependen de que el JWT siga vivo sin requerir un login repetido
    // cada vez que el personal de farmacia recarga la página.
    persistSession: true,
    autoRefreshToken: true,
    // true (default): permite que Supabase detecte un token de sesión
    // en la URL tras flujos de confirmación de correo o recuperación
    // de contraseña. Lo dejamos explícito para que la intención quede
    // documentada y no dependa de un valor implícito de la librería.
    detectSessionInUrl: true,
  },
})

/**
 * Tipo de conveniencia para cuando un hook o componente necesita
 * tipar explícitamente una referencia al cliente (por ejemplo, al
 * recibirlo como prop en un test). En el 99% de los casos basta con
 * importar { supabase } directamente.
 */
export type SupabaseClient = typeof supabase