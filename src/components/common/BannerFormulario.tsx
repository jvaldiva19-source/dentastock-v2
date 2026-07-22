interface BannerProps {
  mensaje: string
  onCerrar: () => void
}

export function BannerExito({ mensaje, onCerrar }: BannerProps) {
  return (
    <div className="flex items-center justify-between rounded-md bg-status-ok-soft px-4 py-3 text-sm text-status-ok border border-status-ok/20">
      <span>{mensaje}</span>
      <button
        type="button"
        onClick={onCerrar}
        className="text-xs font-semibold uppercase tracking-wider opacity-70 hover:opacity-100 focus:outline-none"
      >
        ✕
      </button>
    </div>
  )
}

export function BannerErrorFormulario({ mensaje, onCerrar }: BannerProps) {
  return (
    <div className="flex items-center justify-between rounded-md bg-status-critico-soft px-4 py-3 text-sm text-status-critico border border-status-critico/20">
      <span>{mensaje}</span>
      <button
        type="button"
        onClick={onCerrar}
        className="text-xs font-semibold uppercase tracking-wider opacity-70 hover:opacity-100 focus:outline-none"
      >
        ✕
      </button>
    </div>
  )
}