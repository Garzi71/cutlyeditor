// Right panel: properties of the selected clip, or of the project when nothing is selected.
import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { Clip, MediaItem, Project } from '@shared/types'
import { clipDuration } from '@shared/types'
import { commit, defaultTransform, updateClip, useEditor } from '../store'
import { ASPECTS, RESOLUTIONS, aspectIdOf, formatBytes, formatTimecode, frameSize } from '../lib/util'
import { NumberField, SliderField } from './Controls'
import TextInspector from './TextInspector'

export default function Inspector(): React.JSX.Element {
  const project = useEditor((s) => s.project)!
  const selection = useEditor((s) => s.selection)
  const clip = selection.length === 1 ? project.clips.find((c) => c.id === selection[0]) : undefined
  const media = clip ? project.media.find((m) => m.id === clip.mediaId) : undefined

  return (
    <div className="panel">
      {clip?.text ? (
        <TextInspector key={clip.id} clip={clip} />
      ) : clip && media ? (
        <ClipInspector key={clip.id} project={project} clip={clip} media={media} />
      ) : selection.length > 1 ? (
        <>
          <div className="panel-header">{selection.length} clips selected</div>
          <div className="empty">Select a single clip to edit its properties.</div>
        </>
      ) : (
        <ProjectInspector project={project} />
      )}
    </div>
  )
}

type Tab = 'video' | 'audio' | 'info'

function ClipInspector({ project, clip, media }: { project: Project; clip: Clip; media: MediaItem }): React.JSX.Element {
  const visual = media.kind !== 'audio'
  const hasSound = media.kind === 'audio' || media.hasAudio
  const [tab, setTab] = useState<Tab>(visual ? 'video' : 'audio')
  const tr = clip.transform
  const set = (field: keyof Clip['transform'], v: number): void =>
    updateClip(clip.id, (c) => {
      c.transform[field] = v
    }, `tr-${clip.id}-${field}`)

  return (
    <>
      <div className="insp-tabs">
        {visual && (
          <button className={`insp-tab ${tab === 'video' ? 'active' : ''}`} onClick={() => setTab('video')}>
            Video
          </button>
        )}
        {hasSound && (
          <button className={`insp-tab ${tab === 'audio' ? 'active' : ''}`} onClick={() => setTab('audio')}>
            Audio
          </button>
        )}
        <button className={`insp-tab ${tab === 'info' ? 'active' : ''}`} onClick={() => setTab('info')}>
          Info
        </button>
      </div>
      <div className="panel-body">
        {tab === 'video' && visual && (
          <div className="section">
            <div className="section-title">
              Transform
              <button
                className="icon-btn sm"
                title="Reset"
                onClick={() => updateClip(clip.id, (c) => void (c.transform = defaultTransform()))}
              >
                <RotateCcw size={14} />
              </button>
            </div>
            <div className="field">
              <label>Scale</label>
              <SliderField
                value={tr.scale}
                min={0.05}
                max={4}
                step={1}
                suffix="%"
                display={(v) => Math.round(v * 100)}
                parse={(v) => v / 100}
                onChange={(v) => set('scale', v)}
              />
            </div>
            <div className="field">
              <label>Position</label>
              <div className="field-row">
                <NumberField label="X" value={tr.x} onChange={(v) => set('x', v)} />
                <NumberField label="Y" value={tr.y} onChange={(v) => set('y', v)} />
              </div>
            </div>
            <div className="field">
              <label>Rotate</label>
              <SliderField value={tr.rotation} min={-180} max={180} suffix="°" onChange={(v) => set('rotation', v)} />
            </div>
            <div className="field">
              <label>Opacity</label>
              <SliderField
                value={tr.opacity}
                min={0}
                max={1}
                suffix="%"
                display={(v) => Math.round(v * 100)}
                parse={(v) => v / 100}
                onChange={(v) => set('opacity', v)}
              />
            </div>
          </div>
        )}
        {tab === 'audio' && hasSound && (
          <div className="section">
            <div className="section-title">Basic</div>
            <div className="field">
              <label>Volume</label>
              <SliderField
                value={clip.volume}
                min={0}
                max={2}
                suffix="%"
                display={(v) => Math.round(v * 100)}
                parse={(v) => v / 100}
                onChange={(v) => updateClip(clip.id, (c) => void (c.volume = v), `vol-${clip.id}`)}
              />
            </div>
            <p className="hint" style={{ marginTop: -4 }}>
              Fades, noise reduction and voice enhancement are coming in later phases.
            </p>
          </div>
        )}
        {tab === 'info' && (
          <div className="section">
            <div className="section-title">Clip</div>
            <div className="info-grid">
              <span>File</span>
              <b title={media.path}>{media.name}</b>
              <span>Type</span>
              <b style={{ textTransform: 'capitalize' }}>{media.kind}</b>
              {media.kind !== 'audio' && (
                <>
                  <span>Size</span>
                  <b>
                    {media.width}×{media.height}
                  </b>
                </>
              )}
              {media.kind === 'video' && (
                <>
                  <span>Frame rate</span>
                  <b>{media.fps.toFixed(2)} fps</b>
                </>
              )}
              <span>File size</span>
              <b>{formatBytes(media.size)}</b>
              <span>Starts at</span>
              <b>{formatTimecode(clip.start, project.fps)}</b>
              <span>Duration</span>
              <b>{formatTimecode(clipDuration(clip), project.fps)}</b>
              {media.kind !== 'image' && (
                <>
                  <span>Source in</span>
                  <b>{formatTimecode(clip.in, project.fps)}</b>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function ProjectInspector({ project }: { project: Project }): React.JSX.Element {
  const aspect = aspectIdOf(project.width, project.height)
  const short = Math.min(project.width, project.height)
  const setSize = (aspectId: string, res: number): void => {
    const a = ASPECTS.find((x) => x.id === aspectId) ?? ASPECTS[0]
    const s = frameSize(a.w, a.h, res)
    commit((d) => {
      d.width = s.width
      d.height = s.height
    })
  }

  return (
    <>
      <div className="panel-header">Project</div>
      <div className="panel-body">
        <div className="section">
          <div className="field">
            <label>Ratio</label>
            <select className="input" value={aspect} onChange={(e) => setSize(e.target.value, short)}>
              {ASPECTS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id} · {a.label}
                </option>
              ))}
              {!ASPECTS.some((a) => a.id === aspect) && <option value={aspect}>{aspect}</option>}
            </select>
          </div>
          <div className="field">
            <label>Resolution</label>
            <select className="input" value={short} onChange={(e) => setSize(aspect, Number(e.target.value))}>
              {RESOLUTIONS.map((r) => (
                <option key={r} value={r}>
                  {r === 2160 ? '4K' : `${r}p`}
                </option>
              ))}
              {!(RESOLUTIONS as readonly number[]).includes(short) && <option value={short}>{short}p</option>}
            </select>
          </div>
          <div className="field">
            <label>Frame rate</label>
            <select
              className="input"
              value={project.fps}
              onChange={(e) => commit((d) => void (d.fps = Number(e.target.value)))}
            >
              {[24, 25, 30, 50, 60].map((f) => (
                <option key={f} value={f}>
                  {f} fps
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Background</label>
            <input
              type="color"
              className="color-input"
              value={project.background}
              onChange={(e) => commit((d) => void (d.background = e.target.value), 'bg')}
            />
          </div>
        </div>
        <div className="section">
          <div className="section-title">Shortcuts</div>
          <div className="info-grid">
            {[
              ['Play / pause', 'Space'],
              ['Split', 'S  /  Ctrl+B'],
              ['Delete', 'Del'],
              ['Duplicate', 'Ctrl+D'],
              ['Undo / Redo', 'Ctrl+Z / Ctrl+Y'],
              ['Frame step', '← →'],
              ['Start / end', 'Home / End'],
              ['Zoom timeline', 'Ctrl + wheel'],
              ['Save', 'Ctrl+S'],
              ['Export', 'Ctrl+E']
            ].map(([a, b]) => (
              <Shortcut key={a} name={a} keys={b} />
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

function Shortcut({ name, keys }: { name: string; keys: string }): React.JSX.Element {
  return (
    <>
      <span>{name}</span>
      <b className="kbd">{keys}</b>
    </>
  )
}
