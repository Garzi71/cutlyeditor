// Start screen: create a new project (aspect ratio, resolution, fps) or open an existing one.
import { useEffect, useState } from 'react'
import { AlertTriangle, Clapperboard, FolderOpen, Plus, Scissors } from 'lucide-react'
import type { RecentProject, SystemInfo } from '@shared/types'
import { newProject, openProjectFile } from '../store'
import { ASPECTS, RESOLUTIONS, frameSize } from '../lib/util'
import { checkForUpdatesManually, useUpdateStatus } from './UpdateBanner'
import { TemplatesSection } from './Templates'

export default function Welcome(): React.JSX.Element {
  const [aspect, setAspect] = useState<string>('16:9')
  const [res, setRes] = useState<number>(1080)
  const [fps, setFps] = useState<number>(30)
  const [name, setName] = useState('Untitled project')
  const [recent, setRecent] = useState<RecentProject[]>([])
  const [sys, setSys] = useState<SystemInfo | null>(null)

  useEffect(() => {
    window.api.recentProjects().then(setRecent)
    window.api.systemInfo().then(setSys)
  }, [])

  const a = ASPECTS.find((x) => x.id === aspect)!
  const size = frameSize(a.w, a.h, res)

  const create = (): void => newProject(name.trim() || 'Untitled project', size.width, size.height, fps)

  return (
    <div className="welcome">
      <div className="topbar">
        <div className="logo">
          <div className="logo-mark">
            <Scissors size={13} strokeWidth={2.5} />
          </div>
          Cutly
        </div>
        <div className="spacer" />
      </div>
      <div className="welcome-body">
        <div className="welcome-inner">
          <div className="welcome-head">
            <h1>Start creating</h1>
            <p className="sub">Every feature, free and on your own computer.</p>
          </div>
          <div className="welcome-col">
            {sys && !sys.ffmpegOk && (
              <div className="warn">
                <AlertTriangle size={18} style={{ flexShrink: 0 }} />
                <div>
                  FFmpeg was not found. Cutly needs <b>ffmpeg</b> and <b>ffprobe</b> on your PATH to import and export
                  video.
                </div>
              </div>
            )}
            <div className="card">
              <h2>New project</h2>
              <div className="aspect-grid">
                {ASPECTS.map((x) => {
                  const scale = 48 / Math.max(x.w, x.h)
                  return (
                    <button key={x.id} className={`aspect ${aspect === x.id ? 'active' : ''}`} onClick={() => setAspect(x.id)}>
                      <div className="aspect-shape">
                        <div style={{ width: x.w * scale, height: x.h * scale }} />
                      </div>
                      <b>{x.id}</b>
                      <small>{x.hint}</small>
                    </button>
                  )
                })}
              </div>
              <div className="form-grid">
                <div>
                  <label>Name</label>
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
                </div>
                <div>
                  <label>Resolution</label>
                  <select className="input" value={res} onChange={(e) => setRes(Number(e.target.value))}>
                    {RESOLUTIONS.map((r) => {
                      const s = frameSize(a.w, a.h, r)
                      return (
                        <option key={r} value={r}>
                          {r === 2160 ? '4K' : `${r}p`} ({s.width}×{s.height})
                        </option>
                      )
                    })}
                  </select>
                </div>
                <div>
                  <label>Frame rate</label>
                  <select className="input" value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                    {[24, 25, 30, 50, 60].map((f) => (
                      <option key={f} value={f}>
                        {f} fps
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn primary lg" onClick={create}>
                  <Plus size={16} /> Create project
                </button>
                <button className="btn lg" onClick={() => openProjectFile()}>
                  <FolderOpen size={16} /> Open project…
                </button>
              </div>
            </div>
          </div>
          <div className="welcome-col">
            <div className="card">
              <h2>Recent projects</h2>
              {recent.length === 0 ? (
                <div className="empty" style={{ padding: '20px 0' }}>
                  No projects yet.
                </div>
              ) : (
                <div className="recent">
                  {recent.map((r) => (
                    <button key={r.path} className="recent-item" title={r.path} onClick={() => openProjectFile(r.path)}>
                      <div className="ri-icon">
                        <Clapperboard size={18} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <b>{r.name}</b>
                        <small>Opened {ago(r.openedAt)}</small>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="welcome-wide">
            <TemplatesSection />
            <VersionRow />
          </div>
        </div>
      </div>
    </div>
  )
}

/** "Downloads" for C:\Users\me\Downloads\x.cutly */
function folderOf(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 2] : p
}

function ago(t: number): string {
  if (!t) return ''
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d < 30) return d === 1 ? 'yesterday' : `${d} days ago`
  return new Date(t).toLocaleDateString()
}

function VersionRow(): React.JSX.Element | null {
  const status = useUpdateStatus()
  if (!status) return null
  return (
    <div className="version-row">
      Cutly {status.currentVersion}
      <span>·</span>
      <button className="link-btn" disabled={status.state === 'checking'} onClick={checkForUpdatesManually}>
        {status.state === 'checking' ? 'Checking…' : 'Check for updates'}
      </button>
    </div>
  )
}
