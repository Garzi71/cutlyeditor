// Right panel: properties of the selected clip, or of the project when nothing is selected.
import { useState } from 'react'
import { Info, RotateCcw } from 'lucide-react'
import type { Clip, MediaItem, Project } from '@shared/types'
import { clipDuration } from '@shared/types'
import { commit, defaultTransform, updateClip, useEditor } from '../store'
import { RATIOS, RESOLUTIONS, aspectIdOf, formatBytes, formatTimecode, frameSize } from '../lib/util'
import { ColorField, NumberField, SliderField } from './Controls'
import TextInspector from './TextInspector'
import BgPanel from './BgPanel'
import { EffectInspector, TransitionInspector } from './FxPanels'
import ColorInspector from './ColorInspector'
import { NoisePanel, SilencePanel } from './AudioTools'
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
          <div className="panel-header">Adjustment layer</div>
          <div className="panel-body">
            <p className="hint panel-intro">
              Colors everything below it on the timeline while it plays. Stretch it on the timeline to cover more.
            </p>
            <ColorInspector key={clip.id} clip={clip} />
          </div>
        </>
      ) : clip && media ? (
        <ClipInspector key={clip.id} project={project} clip={clip} media={media} />
      ) : selection.length > 1 ? (
        <>
          <div className="panel-header">
            {selection.length} clips selected
          </div>
          <div className="empty">Select a single clip to edit its properties.</div>
        </>
      ) : (
        <ProjectInspector project={project} />
      )}
    </div>
  )
}

type Tab = 'video' | 'color' | 'anim' | 'speed' | 'audio' | 'info'
/** Last tab per kind of clip, remembered when switching between clips. */
const lastTab: Record<string, Tab> = {}

function ClipInspector({ project, clip, media }: { project: Project; clip: Clip; media: MediaItem }): React.JSX.Element {
  const visual = media.kind !== 'audio'
  const hasSound = media.kind === 'audio' || media.hasAudio
  const canSpeed = media.kind !== 'image'
  const tabs: { id: Tab; label: string }[] =
    media.kind === 'audio'
      ? [
          { id: 'audio', label: 'Audio' },
          { id: 'speed', label: 'Speed' }
        ]
      : [
          { id: 'video', label: media.kind === 'image' ? 'Photo' : 'Video' },
          { id: 'color', label: 'Color' },
          { id: 'anim', label: 'Animate' },
          ...(canSpeed ? [{ id: 'speed' as Tab, label: 'Speed' }] : []),
          ...(hasSound ? [{ id: 'audio' as Tab, label: 'Audio' }] : [])
        ]
  const allowed: Tab[] = [...tabs.map((t) => t.id), 'info']
  const remembered = lastTab[media.kind]
  const [tab, setTabState] = useState<Tab>(remembered && allowed.includes(remembered) ? remembered : allowed[0])
  const setTab = (t: Tab): void => {
    lastTab[media.kind] = t
    setTabState(t)
  }
  return (
    <>
      <div className="insp-tabs">
        {tabs.map((t) => (
          <button key={t.id} className={`insp-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
        <button
          className={`insp-tab icon ${tab === 'info' ? 'active' : ''}`}
          title="File info"
          aria-label="File info"
          onClick={() => setTab('info')}
        >
          <Info size={15} />
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
        {tab === 'video' && visual && <BgPanel clip={clip} photo={media.kind === 'image'} />}
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
        {tab === 'audio' && hasSound && <NoisePanel clip={clip} />}
        {tab === 'audio' && hasSound && <SilencePanel clip={clip} media={media} />}
        {tab === 'info' && (
          <div className="section">
            <div className="section-title">Clip</div>
            <div className="info-grid">
              <span>File</span>
              <b title={media.path}>{media.name}</b>
              <span>Type</span>
              <b>{media.kind[0].toUpperCase() + media.kind.slice(1)}</b>
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
    const a = RATIOS.find((x) => x.id === aspectId) ?? RATIOS[0]
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
              {RATIOS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id} · {a.label}
                </option>
              ))}
              {!RATIOS.some((a) => a.id === aspect) && <option value={aspect}>{aspect}</option>}
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
            <ColorField value={project.background} onChange={(v) => commit((d) => void (d.background = v), 'bg')} />
          </div>
        </div>
        <div className="section">
          <div className="section-title">Shortcuts</div>
          <div className="info-grid">
            {[
              ['Play / pause', 'Space'],
              ['Split', 'S / Ctrl+B'],
              ['Delete', 'Del'],
              ['Duplicate', 'Ctrl+D'],
              ['Undo / Redo', 'Ctrl+Z / Ctrl+Y'],
              ['Frame step', '← / →'],
              ['Start / end', 'Home / End'],
              ['Zoom timeline', 'Ctrl+Wheel'],
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
      <span className="keys">
        {keys.split(/\s+/).map((k, i) =>
          k === '/' ? (
            <span key={i} className="key-sep">
              or
            </span>
          ) : (
            <kbd key={i} className="kbd">
              {k}
            </kbd>
          )
        )}
      </span>
    </>
  )
}
