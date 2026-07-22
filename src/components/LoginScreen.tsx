import { useState, type FormEvent } from 'react'
import { signIn } from '../api/auth'

/**
 * src/components/LoginScreen.tsx
 *
 * Pantalla de acceso. Igual que MainLayout llama a signOut()
 * directamente, este componente llama a signIn() directamente — es
 * la convención ya establecida en este proyecto para las acciones de
 * autenticación, en vez de hacer que cada acción suba como callback
 * hasta App.tsx.
 *
 * Este componente NO redirige tras un login exitoso. Solo gestiona el
 * estado del formulario (carga, error). El cambio de pantalla ocurre
 * porque App.tsx está suscrito a subscribeToAuthChanges() y reacciona
 * por su cuenta en cuanto Supabase confirma la nueva sesión — el mismo
 * patrón reactivo que ya se confirmó para el cierre de sesión.
 */
export function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function manejarSubmit(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setError(null)
    setEnviando(true)

    const resultado = await signIn(email.trim(), password)

    if (!resultado.success) {
      setError(resultado.error.message)
      setEnviando(false)
      return
    }

    // Éxito: no se hace nada más aquí. App.tsx reacciona vía
    // subscribeToAuthChanges() y reemplaza esta pantalla por su cuenta.
    // No se limpia 'enviando' a propósito: mantener el botón
    // deshabilitado evita un segundo submit accidental durante la
    // breve ventana entre la confirmación de Supabase y el re-render
    // de App.tsx.
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-900 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-2xl font-semibold tracking-wide text-text-onink">
            DENTASTOCK
          </p>
          <p className="mt-1 text-sm text-text-onink-muted">
            Clínica Odontológica · UAQ
          </p>
        </div>

        <form
          onSubmit={manejarSubmit}
          className="rounded-lg bg-canvas-card p-8 shadow-xl"
        >
          <h1 className="mb-6 text-base font-medium text-text-primary">
            Iniciar sesión
          </h1>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-xs font-medium text-text-muted"
              >
                Correo institucional
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={enviando}
                className="w-full rounded-md border border-border bg-canvas px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
                placeholder="usuario@alumnos.uaq.mx"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-xs font-medium text-text-muted"
              >
                Contraseña
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={enviando}
                className="w-full rounded-md border border-border bg-canvas px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
                placeholder="••••••••"
              />
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-md bg-status-critico-soft px-3 py-2 text-sm text-status-critico"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={enviando}
            className="mt-6 w-full rounded-md bg-accent py-2.5 text-sm font-medium text-text-onink transition-colors hover:bg-accent-strong disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            {enviando ? 'Iniciando sesión…' : 'Iniciar sesión'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-text-onink-muted">
          Acceso restringido al personal autorizado de la clínica.
        </p>
      </div>
    </div>
  )
}