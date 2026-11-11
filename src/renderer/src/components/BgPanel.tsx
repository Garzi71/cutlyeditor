// Video tab: "Remove background" (people) with a one-time model download.
import { useEffect, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import type { Clip } from '@shared/types'
import { toast, updateClip } from '../store'
import { mattingBackend } from '../engine/matting'

export default function BgPanel({ clip, photo }: { clip: Clip; photo?: boolean }): React.JSX.Element {
  const [status, setStatus] = useState<{ ready: boolean; size: number } | null>(null)
  const [asking, setAsking] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [backend, setBackend] = useState('')

  useEffect(() => {
    window.api.mattingStatus().then(setStatus)
    const off = window.api.onMattingProgress(setProgress)
    const timer = setInterval(() => setBackend(mattingBackend()), 1000)
    return () => {
      off()
      clearInterval(timer)
    }
  }, [])

  const enable = (on: boolean): void => {
    if (on && status && !status.ready) {
      setAsking(true)
      return
    }
    updateClip(clip.id, (c) => void (c.removeBg = on || undefined))
  }

  const download = async (): Promise<void> => {
    setProgress(0)
    try {
      await window.api.downloadMattingModel()
      setStatus(await window.api.mattingStatus())
      setAsking(false)
      updateClip(clip.id, (c) => void (c.removeBg = true))
    } catch (e) {
      toast(`Download failed: ${(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`, 'error')
    } finally {
      setProgress(null)
    }
  }

  return (
    <div className="section">
      <div className="section-title">
        Remove background
        <label className="switch">
          <input type="checkbox" checked={!!clip.removeBg} onChange={(e) => enable(e.target.checked)} />
          <span />
        </label>
      </div>
      {asking && status && (
        <div className="confirm-box" style={{ marginBottom: 12 }}>
          <b>Download the AI model?</b>
          <span className="hint">
            One-time download of {Math.round(status.size / 1e6)} MB (Robust Video Matting). It runs offline on your computer.
          </span>
          {progress !== null ? (
            <div className="progress">
              <div style={{ width: `${progress * 100}%` }} />
            </div>
          ) : (
            <div className="btn-row" style={{ marginBottom: 0 }}>
              <button className="btn primary" onClick={download}>
                <Download size={14} /> Download
              </button>
              <button className="btn ghost" onClick={() => setAsking(false)}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
      <p className="hint" style={{ marginTop: -6 }}>
        {clip.removeBg ? (
          backend ? (
            <>Running on the {backend}. Put a picture or video on a track below to replace the background.</>
          ) : (
            <>
              <Loader2 size={12} className="spin" style={{ verticalAlign: -2 }} /> Loading the model…
            </>
          )
        ) : (
          <>Cuts people out of the {photo ? 'photo' : 'video'}, no green screen needed.</>
        )}
      </p>
    </div>
  )
}
