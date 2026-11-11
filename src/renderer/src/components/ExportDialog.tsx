// Export window: choose file, resolution, fps, codec, quality and GPU/CPU, then watch progress.
import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, FolderOpen, X } from 'lucide-react'
import type { ExportProgress, ExportSettings, SystemInfo } from '@shared/types'
import { projectDuration } from '@shared/types'
import { player } from '../engine/player'
import { useEditor } from '../store'
import { RESOLUTIONS, formatShort } from '../lib/util'
import { Segmented } from './Controls'
import { runExport } from '../engine/exportRender'

type Phase = 'setup' | 'running' | 'done' | 'error'

interface Preset {
  id: string
  name: string
  w: number
  h: number
  fps: number
  maxSeconds?: number
  note: string
}

/** Recommended upload settings per platform (H.264 MP4, AAC). */
const PRESETS: Preset[] = [
  { id: 'tiktok', name: 'TikTok', w: 1080, h: 1920, fps: 30, maxSeconds: 600, note: 'Vertical 1080×1920, up to 10 min' },
  { id: 'reels', name: 'Reels', w: 1080, h: 1920, fps: 30, maxSeconds: 180, note: 'Instagram/Facebook Reels, up to 3 min' },
  { id: 'shorts', name: 'Shorts', w: 1080, h: 1920, fps: 30, maxSeconds: 180, note: 'YouTube Shorts, up to 3 min' },
  { id: 'youtube', name: 'YouTube', w: 1920, h: 1080, fps: 30, note: 'Landscape 1080p' },
  { id: 'youtube4k', name: 'YouTube 4K', w: 3840, h: 2160, fps: 30, note: 'Landscape 4K' },
  { id: 'igpost', name: 'Instagram post', w: 1080, h: 1350, fps: 30, maxSeconds: 3600, note: 'Portrait 4:5 for the feed' },
  { id: 'square', name: 'Square', w: 1080, h: 1080, fps: 30, note: '1:1 for feeds' },
  { id: 'x', name: 'X / Twitter', w: 1280, h: 720, fps: 30, maxSeconds: 140, note: 'Up to 2:20 for free accounts' }
]

export default function ExportDialog(): React.JSX.Element {
  const project = useEditor((s) => s.project)!
  const projectPath = useEditor((s) => s.projectPath)
  const close = (): void => useEditor.setState({ exportOpen: false })
  const short = Math.min(project.width, project.height)
  const [res, setRes] = useState<number>(short)
  const [fps, setFps] = useState(project.fps)
  const [codec, setCodec] = useState<ExportSettings['codec']>('h264')
  const [quality, setQuality] = useState<ExportSettings['quality']>('high')
  const [sys, setSys] = useState<SystemInfo | null>(null)
  const [useGpu, setUseGpu] = useState(true)
  const [output, setOutput] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('setup')
  const [progress, setProgress] = useState<ExportProgress>({ percent: 0 })
  const duration = projectDuration(project)

  useEffect(() => {
    player.pause()
    window.api.systemInfo().then((s) => {
      setSys(s)
      setUseGpu(s.nvenc)
    })
  }, [])
  const cancelled = useRef(false)

  const [presetId, setPresetId] = useState<string>('custom')
  const [fit, setFit] = useState<NonNullable<ExportSettings['fit']>>('blur')
  const preset = PRESETS.find((p) => p.id === presetId)
  const scale = res / short
  const width = preset ? preset.w : Math.round((project.width * scale) / 2) * 2
  const height = preset ? preset.h : Math.round((project.height * scale) / 2) * 2
  const sameShape = Math.abs(width / height - project.width / project.height) < 0.01
  const tooLong = preset?.maxSeconds !== undefined && duration > preset.maxSeconds
  const pickPreset = (id: string): void => {
    setPresetId(id)
    const p = PRESETS.find((x) => x.id === id)
    if (p) {
      setFps(p.fps)
      setCodec('h264')
      setQuality('high')
    }
  }

  const choose = async (): Promise<string | null> => {
    const base = projectPath ? projectPath.replace(/\.cutly$/i, '').split(/[\\/]/).pop()! : project.name
    const p = await window.api.chooseExportFile(base || 'video')
    if (p) setOutput(p)
    return p
  }

  const start = async (): Promise<void> => {
    const out = output ?? (await choose())
    if (!out) return
    setPhase('running')
    setProgress({ percent: 0 })
    cancelled.current = false
    try {
      await runExport(
        project,
        { outputPath: out, width, height, fps, codec, quality, useGpu, fit },
        (p) => setProgress({ percent: p.percent, fps: p.fps, etaSeconds: p.etaSeconds }),
        () => cancelled.current
      )
      setPhase('done')
    } catch (e) {
      if (cancelled.current) {
        setPhase('setup')
        return
      }
      setPhase('error')
      setProgress({ percent: 0, error: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    }
  }
  const preparing: number | null = null

  const resOptions = [...new Set([...RESOLUTIONS.filter((r) => r <= Math.max(short, 1080) * 2), short])].sort((a, b) => a - b)

  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && phase !== 'running' && close()}>
      <div className="modal">
        <div className="modal-head">
          <h2>Export</h2>
          {phase !== 'running' && (
            <button className="icon-btn" onClick={close}>
              <X size={16} />
            </button>
          )}
        </div>

        {phase === 'setup' && (
          <>
            <div className="modal-body">
              <div className="field">
                <label>Save to</label>
                <div className="path-row">
                  <div className="input" title={output ?? ''}>
                    {output ?? 'Choose when exporting…'}
                  </div>
                  <button className="btn" onClick={choose}>
                    <FolderOpen size={14} />
                  </button>
                </div>
              </div>
              <div className="field">
                <label>For</label>
                <div className="preset-chips">
                  <button className={`chip ${presetId === 'custom' ? 'active' : ''}`} onClick={() => setPresetId('custom')}>
                    Custom
                  </button>
                  {PRESETS.map((p) => (
                    <button key={p.id} className={`chip ${presetId === p.id ? 'active' : ''}`} title={p.note} onClick={() => pickPreset(p.id)}>
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
              {preset && (
                <div className="field">
                  <label />
                  <div className="hint">
                    {preset.note} · {preset.w}×{preset.h}
                    {tooLong && (
                      <div className="warn-inline">
                        The video is {formatShort(duration)} long, {preset.name} allows up to {formatShort(preset.maxSeconds!)}.
                      </div>
                    )}
                  </div>
                </div>
              )}
              {!sameShape && (
                <div className="field">
                  <label>Shape</label>
                  <Segmented
                    value={fit}
                    onChange={setFit}
                    options={[
                      { value: 'blur', label: 'Blurred background' },
                      { value: 'crop', label: 'Crop to fill' },
                      { value: 'bars', label: 'Black bars' }
                    ]}
                  />
                </div>
              )}
              {!preset && (
              <div className="field">
                <label>Resolution</label>
                <select className="input" value={res} onChange={(e) => setRes(Number(e.target.value))}>
                  {resOptions.map((r) => (
                    <option key={r} value={r}>
                      {r === 2160 ? '4K' : `${r}p`} — {Math.round((project.width * r) / short / 2) * 2}×
                      {Math.round((project.height * r) / short / 2) * 2}
                    </option>
                  ))}
                </select>
              </div>
              )}
              <div className="field">
                <label>Frame rate</label>
                <Segmented value={fps} onChange={setFps} options={[24, 25, 30, 50, 60].map((f) => ({ value: f, label: String(f) }))} />
              </div>
              <div className="field">
                <label>Format</label>
                <Segmented
                  value={codec}
                  onChange={setCodec}
                  options={[
                    { value: 'h264', label: 'H.264 (most compatible)' },
                    { value: 'hevc', label: 'H.265 (smaller)' }
                  ]}
                />
              </div>
              <div className="field">
                <label>Quality</label>
                <Segmented
                  value={quality}
                  onChange={setQuality}
                  options={[
                    { value: 'high', label: 'High' },
                    { value: 'medium', label: 'Recommended' },
                    { value: 'low', label: 'Small file' }
                  ]}
                />
              </div>
              <div className="field">
                <label>Encoder</label>
                <Segmented
                  value={useGpu ? 'gpu' : 'cpu'}
                  onChange={(v) => setUseGpu(v === 'gpu')}
                  options={[
                    { value: 'gpu', label: sys?.nvenc ? 'GPU (NVIDIA)' : 'GPU (not available)', disabled: !sys?.nvenc },
                    { value: 'cpu', label: 'CPU' }
                  ]}
                />
              </div>
              <div className="hint">
                Length {formatShort(duration)} · {width}×{height} · MP4 · AAC 192 kbps audio
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={close}>
                Cancel
              </button>
              <button className="btn primary" disabled={duration <= 0} onClick={start}>
                Export
              </button>
            </div>
          </>
        )}

        {phase === 'running' && (
          <>
            <div className="modal-body">
              <div>
                {preparing !== null ? 'Preparing text and captions…' : `Exporting ${output?.split(/[\\/]/).pop()}…`}
              </div>
              <div className="progress">
                <div style={{ width: `${preparing !== null ? preparing * 100 : progress.percent}%` }} />
              </div>
              <div className="export-stats">
                <span>{progress.percent.toFixed(1)} %</span>
                <span>
                  {progress.fps ? `${Math.round(progress.fps)} fps · ` : ''}
                  {progress.etaSeconds !== undefined ? `${formatShort(progress.etaSeconds)} left` : 'starting…'}
                </span>
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => (cancelled.current = true)}>
                Cancel export
              </button>
            </div>
          </>
        )}

        {phase === 'done' && (
          <>
            <div className="modal-body">
              <div className="export-done">
                <div className="ok">
                  <CheckCircle2 size={26} />
                </div>
                <b style={{ fontSize: 15 }}>Export finished</b>
                <span className="hint" style={{ wordBreak: 'break-all' }}>
                  {output}
                </span>
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => output && window.api.showItemInFolder(output)}>
                <FolderOpen size={14} /> Show in folder
              </button>
              <button className="btn primary" onClick={close}>
                Done
              </button>
            </div>
          </>
        )}

        {phase === 'error' && (
          <>
            <div className="modal-body">
              <b>Export failed</b>
              <div className="err-box">{progress.error}</div>
              {useGpu && <div className="hint">Tip: try exporting with the CPU encoder.</div>}
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setPhase('setup')}>
                Back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
