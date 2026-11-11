// Right panel: properties of the selected clip, or of the project when nothing is selected.
import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { Clip, MediaItem, Project } from '@shared/types'
import { clipDuration } from '@shared/types'
import { commit, defaultTransform, updateClip, useEditor } from '../store'
import { ASPECTS, RESOLUTIONS, aspectIdOf, formatBytes, formatTimecode, frameSize } from '../lib/util'
import { NumberField, SliderField } from './Controls'
import TextInspector from './TextInspector'
import { EffectInspector, TransitionInspector } from './FxPanels'
import ColorInspector from './ColorInspector'
import { AnimatedPosition, AnimatedSlider, AnimationPanel, AudioFades, KeyframeTools, SpeedPanel } from './MotionPanels'

export default function Inspector(): React.JSX.Element {
  const project = useEditor((s) => s.project)!
  const selection = useEditor((s) => s.selection)
  const transitionSel = useEditor((s) => s.transitionSel)
  const clip = selection.length === 1 ? project.clips.find((c) => c.id === selection[0]) : undefined
  const media = clip ? project.media.find((m) => m.id === clip.mediaId) : undefined

  return (
    <div className="panel">
      {transitionSel ? (
        <TransitionInspector key={transitionSel} clipId={transitionSel} />
      ) : clip?.effect ? (
        <EffectInspector key={clip.id} clip={clip} />
      ) : clip?.text ? (
        <TextInspector key={clip.id} clip={clip} />
      ) : clip?.adjustment ? (
        <>
          <div className="insp-tabs">
            <button className="insp-tab active">Adjustment layer</button>
          </div>
          <div className="panel-body">
            <p className="hint" style={{ margin: '12px 14px 0', lineHeight: 1.5 }}>
              Colors everything below it on the timeline while it plays. Stretch it on the timeline to cover more.
            </p>
            <ColorInspector key={clip.id} clip={clip} />
          </div>
        </>
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

type Tab = 'video' | 'color' | 'anim' | 'speed' | 'audio' | 'info'
let lastTab: Tab = 'video' // remembered when switching between clips

function ClipInspector({ project, clip, media }: { project: Project; clip: Clip; media: MediaItem }): React.JSX.Element {
  const visual = media.kind !== 'audio'
  const hasSound = media.kind === 'audio' || media.hasAudio
  const canSpeed = media.kind !== 'image'
  const allowed: Tab[] = [
    ...(visual ? (['video', 'color', 'anim'] as Tab[]) : []),
    ...(canSpeed ? (['speed'] as Tab[]) : []),
    ...(hasSound ? (['audio'] as Tab[]) : []),
    'info'
  ]
  const [tab, setTabState] = useState<Tab>(allowed.includes(lastTab) ? lastTab : allowed[0])
  const setTab = (t: Tab): void => {
    lastTab = t
    setTabState(t)
  }
  return (
    <>
      <div className="insp-tabs">
        {visual && (
          <button className={`insp-tab ${tab === 'video' ? 'active' : ''}`} onClick={() => setTab('video')}>
            Video
          </button>
        )}
        {visual && (
          <button className={`insp-tab ${tab === 'color' ? 'active' : ''}`} onClick={() => setTab('color')}>
            Color
          </button>
        )}
        {visual && (
          <button className={`insp-tab ${tab === 'anim' ? 'active' : ''}`} onClick={() => setTab('anim')}>
            Animation
          </button>
        )}
        {canSpeed && (
          <button className={`insp-tab ${tab === 'speed' ? 'active' : ''}`} onClick={() => setTab('speed')}>
            Speed
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
        {tab === 'color' && visual && <ColorInspector clip={clip} />}
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
            <AnimatedSlider clip={clip} prop="scale" label="Scale" min={0.05} max={4} suffix="%" display={(v) => Math.round(v * 100)} parse={(v) => v / 100} />
            <AnimatedPosition clip={clip} />
            <AnimatedSlider clip={clip} prop="rotation" label="Rotate" min={-180} max={180} suffix="°" />
            <AnimatedSlider clip={clip} prop="opacity" label="Opacity" min={0} max={1} suffix="%" display={(v) => Math.round(v * 100)} parse={(v) => v / 100} />
            <KeyframeTools clip={clip} props={['x', 'y', 'scale', 'rotation', 'opacity']} />
          </div>
        )}
        {tab === 'anim' && visual && <AnimationPanel clip={clip} />}
        {tab === 'speed' && canSpeed && <SpeedPanel clip={clip} />}
        {tab === 'audio' && hasSound && (
          <div className="section">
            <div className="section-title">Basic</div>
            <AnimatedSlider clip={clip} prop="volume" label="Volume" min={0} max={2} suffix="%" display={(v) => Math.round(v * 100)} parse={(v) => v / 100} />
            <KeyframeTools clip={clip} props={['volume']} />
            <AudioFades clip={clip} />
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
