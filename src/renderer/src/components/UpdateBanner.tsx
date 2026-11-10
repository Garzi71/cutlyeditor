// Small card in the bottom-right corner that asks before downloading / installing an update.
import { useEffect, useState } from 'react'
import { Download, RefreshCw, Sparkles, X } from 'lucide-react'
import type { UpdateStatus } from '@shared/types'
import { toast } from '../store'
import { confirmDiscard } from './TopBar'

let manualCheck = false

/** Used by the "Check for updates" link. */
export function checkForUpdatesManually(): void {
  manualCheck = true
  window.api.checkForUpdates()
}

export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    window.api.updateStatus().then(setStatus)
    return window.api.onUpdateStatus(setStatus)
  }, [])
  return status
}

export default function UpdateBanner(): React.JSX.Element | null {
  const status = useUpdateStatus()
  const [dismissed, setDismissed] = useState<string | null>(null)

  useEffect(() => {
    if (!status || !manualCheck) return
    if (status.state === 'none') {
      toast(`You're up to date (version ${status.currentVersion})`, 'success')
      manualCheck = false
    } else if (status.state === 'error') {
      toast(`Update check failed: ${status.error}`, 'error')
      manualCheck = false
    } else if (status.state === 'available') {
      manualCheck = false
      setDismissed(null)
    }
  }, [status])

  if (!status) return null
  const { state, version } = status
  if (!['available', 'downloading', 'ready'].includes(state)) return null
  if (dismissed === `${state}-${version}`) return null

  return (
    <div className="update-card">
      <div className="update-icon">
        <Sparkles size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {state === 'available' && (
          <>
            <b>New version {version} is available</b>
            <div className="hint">You have {status.currentVersion}. Download and install it?</div>
            <div className="update-actions">
              <button className="btn primary" onClick={() => window.api.downloadUpdate()}>
                <Download size={14} /> Download
              </button>
              <button className="btn ghost" onClick={() => setDismissed(`${state}-${version}`)}>
                Later
              </button>
            </div>
          </>
        )}
        {state === 'downloading' && (
          <>
            <b>Downloading {version}…</b>
            <div className="progress" style={{ marginTop: 10 }}>
              <div style={{ width: `${status.percent ?? 0}%` }} />
            </div>
            <div className="hint" style={{ marginTop: 6 }}>
              {Math.round(status.percent ?? 0)} % · you can keep working
            </div>
          </>
        )}
        {state === 'ready' && (
          <>
            <b>Version {version} is ready</b>
            <div className="hint">Restart Cutly to finish the update.</div>
            <div className="update-actions">
              <button
                className="btn primary"
                onClick={async () => {
                  if (await confirmDiscard()) window.api.installUpdate()
                }}
              >
                <RefreshCw size={14} /> Restart now
              </button>
              <button className="btn ghost" onClick={() => setDismissed(`${state}-${version}`)}>
                When I close Cutly
              </button>
            </div>
          </>
        )}
      </div>
      {state !== 'downloading' && (
        <button className="icon-btn sm" onClick={() => setDismissed(`${state}-${version}`)}>
          <X size={14} />
        </button>
      )}
    </div>
  )
}
