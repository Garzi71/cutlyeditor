// Export window: choose file, resolution, fps, codec, quality and GPU/CPU, then watch progress.
import { useEffect, useState } from 'react'
import { CheckCircle2, FolderOpen, X } from 'lucide-react'
import type { ExportProgress, ExportSettings, SystemInfo } from '@shared/types'
import { projectDuration } from '@shared/types'
import { player } from '../engine/player'
import { useEditor } from '../store'
import { RESOLUTIONS, formatShort } from '../lib/util'
import { Segmented } from './Controls'

type Phase = 'setup' | 'running' | 'done' | 'error'

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
    return window.api.onExportProgress((p) => {
      setProgress(p)
      if (p.done) setPhase('done')
      else if (p.error) setPhase('error')
      else if (p.cancelled) setPhase('setup')
    })
  }, [])

  const scale = res / short
  const width = Math.round((project.width * scale) / 2) * 2
  const height = Math.round((project.height * scale) / 2) * 2

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
    try {
      await window.api.startExport(project, { outputPath: out, width, height, fps, codec, quality, useGpu })
    } catch (e) {
      setPhase('error')
      setProgress({ percent: 0, error: (e as Error).message })
    }
  }

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
                Length {formatShort(duration)} · MP4 · AAC 192 kbps audio
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
              <div>Exporting {output?.split(/[\\/]/).pop()}…</div>
              <div className="progress">
                <div style={{ width: `${progress.percent}%` }} />
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
              <button className="btn" onClick={() => window.api.cancelExport()}>
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
