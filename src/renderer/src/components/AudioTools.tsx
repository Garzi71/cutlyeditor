// Audio tab tools: remove silences (preview, then cut) and noise reduction.
import { useEffect, useState } from 'react'
import { Loader2, Scissors, Search, X } from 'lucide-react'
import type { Clip, MediaItem } from '@shared/types'
import { speedOf, tauAtPlayed } from '@shared/timing'
import { cutRanges, toast, updateClip, useEditor } from '../store'
import { SliderField } from './Controls'

const errMsg = (e: unknown): string => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function SilencePanel({ clip, media }: { clip: Clip; media: MediaItem }): React.JSX.Element {
  const [threshold, setThreshold] = useState(-35)
  // Auto: the threshold is picked from this recording's noise and speech levels.
  const [auto, setAuto] = useState(true)
  const [minPause, setMinPause] = useState(0.5)
  const [padding, setPadding] = useState(0.15)
  const [busy, setBusy] = useState(false)
  const preview = useEditor((s) => (s.silencePreview?.clipId === clip.id ? s.silencePreview : null))

  // Leaving the clip clears its preview.
  useEffect(() => () => useEditor.setState({ silencePreview: null }), [clip.id])

  const find = async (): Promise<void> => {
    setBusy(true)
    try {
      let thr = threshold
      if (auto) {
        thr = (await window.api.silenceThreshold(media.path, clip.in, clip.out)).threshold
        setThreshold(thr)
      }
      const found = await window.api.detectSilence(media.path, clip.in, clip.out, thr, minPause)
      const rev = !!speedOf(clip).reverse
      const ranges: [number, number][] = []
      for (const [s, e] of found) {
        // Source time -> time played -> timeline (handles speed, ramps and reverse).
        const p0 = rev ? clip.out - e : s - clip.in
        const p1 = rev ? clip.out - s : e - clip.in
        const a = clip.start + tauAtPlayed(clip, Math.max(0, p0)) + padding
        const b = clip.start + tauAtPlayed(clip, Math.max(0, p1)) - padding
        if (b - a > 0.05) ranges.push([a, b])
      }
      ranges.sort((x, y) => x[0] - y[0])
      useEditor.setState({ silencePreview: { clipId: clip.id, ranges } })
      if (!ranges.length) toast('No pauses found with these settings.', 'info')
    } catch (e) {
      toast(`Could not analyse the audio: ${errMsg(e)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const total = preview ? preview.ranges.reduce((a, [x, y]) => a + (y - x), 0) : 0
  return (
    <div className="section">
      <div className="section-title">Remove silences</div>
      <div className="field">
        <label>Quieter than</label>
        <div className="color-slider" style={{ gridTemplateColumns: '1fr auto' }}>
          <SliderField
            value={threshold}
            min={-70}
            max={-10}
            suffix="dB"
            onChange={(v) => {
              setAuto(false)
              setThreshold(v)
            }}
          />
          <button className={`chip ${auto ? 'active' : ''}`} title="Pick the level from this recording" onClick={() => setAuto(!auto)}>
            Auto
          </button>
        </div>
      </div>
      <div className="field">
        <label>Pauses over</label>
        <SliderField value={minPause} min={0.2} max={3} step={0.1} decimals={1} suffix="s" onChange={setMinPause} />
      </div>
      <div className="field">
        <label>Keep around</label>
        <SliderField value={padding} min={0} max={0.5} step={0.05} decimals={2} suffix="s" onChange={setPadding} />
      </div>
      {preview && preview.ranges.length > 0 ? (
        <div className="confirm-box">
          <b>
            {preview.ranges.length} pause{preview.ranges.length === 1 ? '' : 's'} · {total.toFixed(1)} s
          </b>
          <span className="hint">Marked in red on the timeline. Cutting joins the rest together.</span>
          <div className="btn-row" style={{ marginBottom: 0 }}>
            <button
              className="btn primary"
              onClick={() => {
                const removed = cutRanges(clip.id, preview.ranges)
                toast(`Removed ${removed.toFixed(1)} s of silence`, 'success')
              }}
            >
              <Scissors size={14} /> Cut them
            </button>
            <button className="btn ghost" onClick={find} disabled={busy}>
              <Search size={14} /> Find again
            </button>
            <button className="icon-btn" title="Cancel" onClick={() => useEditor.setState({ silencePreview: null })}>
              <X size={14} />
            </button>
          </div>
        </div>
      ) : (
        <button className="btn" style={{ width: '100%' }} onClick={find} disabled={busy}>
          {busy ? <Loader2 size={14} className="spin" /> : <Search size={14} />} Find silences
        </button>
      )}
    </div>
  )
}

export function NoisePanel({ clip }: { clip: Clip }): React.JSX.Element {
  const on = (clip.denoise ?? 0) > 0
  return (
    <div className="section">
      <div className="section-title">
        Reduce noise
        <label className="switch">
          <input type="checkbox" checked={on} onChange={(e) => updateClip(clip.id, (c) => void (c.denoise = e.target.checked ? 0.8 : undefined))} />
          <span />
        </label>
      </div>
      {on && (
        <div className="field">
          <label>Strength</label>
          <SliderField
            value={clip.denoise!}
            min={0.1}
            max={1}
            suffix="%"
            display={(v) => Math.round(v * 100)}
            parse={(v) => v / 100}
            onChange={(v) => updateClip(clip.id, (c) => void (c.denoise = v), `dn-${clip.id}`)}
          />
        </div>
      )}
      <p className="hint" style={{ marginTop: on ? -4 : -6 }}>
        Removes background hum, wind and room noise from voices (AI, offline).
      </p>
    </div>
  )
}
