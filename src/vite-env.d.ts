/// <reference types="vite/client" />

/**
 * Extiende los tipos de Vite para reconocer las variables de entorno
 * propias de DentaStock. Sin esta declaración, TypeScript marca un error
 * al leer import.meta.env.VITE_SUPABASE_URL porque Vite solo conoce las
 * variables que tú le declaras explícitamente aquí.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}