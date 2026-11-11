// In-app confirmation dialog (replaces the browser's confirm(), which doesn't match the dark UI).
import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Request {
  title: string
  message?: string
  confirmLabel?: string
  danger?: boolean
  resolve: (ok: boolean) => void
}

let show: ((r: Request) => void) | null = null

/** Ask the user to confirm. Resolves true for the confirm button, false for Cancel / Esc. */
export function askConfirm(opts: Omit<Request, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    if (!show) return resolve(window.confirm(opts.title))
    show({ ...opts, resolve })
  })
}

export default function ConfirmHost(): React.JSX.Element | null {
  const [req, setReq] = useState<Request | null>(null)
  useEffect(() => {
    show = setReq
    return () => {
      show = null
    }
  }, [])

  const close = (ok: boolean): void => {
    req?.resolve(ok)
    setReq(null)
  }

  useEffect(() => {
    if (!req) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  if (!req) return null
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && close(false)}>
      <div className="modal sm confirm" role="alertdialog" aria-label={req.title}>
        <div className="modal-body confirm-body">
          {req.danger && (
            <div className="confirm-icon">
              <AlertTriangle size={18} />
            </div>
          )}
          <div>
            <h2>{req.title}</h2>
            {req.message && <p>{req.message}</p>}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" autoFocus={!!req.danger} onClick={() => close(false)}>
            Cancel
          </button>
          <button className={`btn ${req.danger ? 'danger-fill' : 'primary'}`} autoFocus={!req.danger} onClick={() => close(true)}>
            {req.confirmLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  )
}
