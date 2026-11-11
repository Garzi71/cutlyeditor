// Left panel tabs "Transitions" and "Effects", plus their inspectors.
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Circle, Droplets, Moon, RefreshCw, Sparkles, Sun, Trash2, Waves, ZoomIn
} from 'lucide-react'
import type { Clip, EffectType, TransitionType } from '@shared/types'
import { EFFECTS, TRANSITIONS, clipDuration, clipEnd } from '@shared/types'
import { addEffectLayer, selectTransition, setTransition, toast, updateClip, useEditor } from '../store'
import { previousClip } from '../engine/compositor'
import { SliderField } from './Controls'
import FxThumb from './FxThumb'
import { useState } from 'react'

/** A preset tile with a live preview that plays on hover. */
function FxCard(props: {
  name: string
  active: boolean
  onClick: () => void
  transition?: TransitionType
  effect?: EffectType
}): React.JSX.Element {
  const [hover, setHover] = useState(false)
  return (
    <button
      className={`tile ${props.active ? 'active' : ''}`}
      title={props.name}
      onClick={props.onClick}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <div className="tile-thumb">
        {props.transition ? (
          <FxThumb transition={props.transition} playing={hover} />
        ) : (
          <FxThumb effect={props.effect!} playing={hover} />
        )}
      </div>
      <span className="tile-name">{props.name}</span>
    </button>
  )
}

export const TRANSITION_INFO: Record<TransitionType, { name: string; icon: React.ComponentType<{ size?: number }> }> = {
  dissolve: { name: 'Dissolve', icon: Droplets },
  dipBlack: { name: 'Dip to black', icon: Moon },
  dipWhite: { name: 'Dip to white', icon: Sun },
  pushLeft: { name: 'Push left', icon: ArrowLeft },
  pushRight: { name: 'Push right', icon: ArrowRight },
  pushUp: { name: 'Push up', icon: ArrowUp },
  pushDown: { name: 'Push down', icon: ArrowDown },
  wipeLeft: { name: 'Wipe left', icon: ArrowLeft },
  wipeRight: { name: 'Wipe right', icon: ArrowRight },
  wipeUp: { name: 'Wipe up', icon: ArrowUp },
  wipeDown: { name: 'Wipe down', icon: ArrowDown },
  zoom: { name: 'Zoom', icon: ZoomIn },
  blur: { name: 'Blur', icon: Waves },
  circle: { name: 'Circle', icon: Circle },
  spin: { name: 'Spin', icon: RefreshCw }
}

export const EFFECT_NAMES: Record<EffectType, string> = {
  blur: 'Blur', shake: 'Shake', glitch: 'Glitch', flash: 'Flash', vhs: 'VHS', grain: 'Film grain',
  rgbSplit: 'RGB split', mirror: 'Mirror', zoomPulse: 'Zoom pulse', pixelate: 'Pixelate'
}

export const DEFAULT_TRANSITION = 0.6

/** The clip whose incoming transition a click in the Transitions tab should set. */
function transitionTarget(): Clip | null {
  const st = useEditor.getState()
  const p = st.project!
  if (st.transitionSel) return p.clips.find((c) => c.id === st.transitionSel) ?? null
  if (st.selection.length !== 1) return null
  const c = p.clips.find((x) => x.id === st.selection[0])
  if (!c || c.adjustment || c.effect) return null
  if (previousClip(p, c)) return c
  // Otherwise the cut after the selected clip.
  return p.clips.find((x) => x.trackId === c.trackId && x.id !== c.id && Math.abs(x.start - clipEnd(c)) < 0.05) ?? null
}

export function TransitionsPanel(): React.JSX.Element {
  const sel = useEditor((s) => s.transitionSel)
  const current = useEditor((s) => (s.transitionSel ? s.project?.clips.find((c) => c.id === s.transitionSel)?.transitionIn?.type : undefined))
  const apply = (type: TransitionType): void => {
    const b = transitionTarget()
    if (!b) {
      toast('Select a clip that touches another clip on the same track (or click a cut on the timeline).', 'info')
      return
    }
    setTransition(b.id, { type, duration: b.transitionIn?.duration ?? DEFAULT_TRANSITION })
    selectTransition(b.id)
  }
  return (
    <>
      <div className="panel-header">Transitions</div>
      <div className="panel-body">
        <p className="panel-hint">
          {sel ? 'Click a transition to change the selected one.' : 'Select a clip or click + on a cut in the timeline, then pick one.'}
        </p>
        <div className="tile-grid">
          {TRANSITIONS.map((t) => (
            <FxCard key={t} name={TRANSITION_INFO[t].name} active={current === t} transition={t} onClick={() => apply(t)} />
          ))}
        </div>
      </div>
    </>
  )
}

export function EffectsPanel(): React.JSX.Element {
  const selectedEffect = useEditor((s) => {
    if (s.selection.length !== 1) return undefined
    return s.project?.clips.find((c) => c.id === s.selection[0] && c.effect)
  })
  return (
    <>
      <div className="panel-header">Effects</div>
      <div className="panel-body">
        <p className="panel-hint">
          {selectedEffect
            ? 'Click an effect to change the selected effect layer.'
            : 'Adds an effect layer at the playhead. It affects everything below it.'}
        </p>
        <div className="tile-grid">
          {EFFECTS.map((e) => (
            <FxCard
              key={e}
              name={EFFECT_NAMES[e]}
              active={selectedEffect?.effect?.type === e}
              effect={e}
              onClick={() =>
                selectedEffect ? updateClip(selectedEffect.id, (c) => void (c.effect!.type = e)) : addEffectLayer(e)
              }
            />
          ))}
        </div>
      </div>
    </>
  )
}

export function TransitionInspector({ clipId }: { clipId: string }): React.JSX.Element | null {
  const project = useEditor((s) => s.project)!
  const b = project.clips.find((c) => c.id === clipId)
  const a = b ? previousClip(project, b) : undefined
  if (!b?.transitionIn || !a) return null
  const tr = b.transitionIn
  const max = Math.max(0.2, Math.min(clipDuration(a), clipDuration(b), 5))
  return (
    <>
      <div className="panel-header">Transition</div>
      <div className="panel-body">
        <div className="section">
          <div className="field">
            <label>Type</label>
            <select className="input" value={tr.type} onChange={(e) => setTransition(b.id, { ...tr, type: e.target.value as TransitionType })}>
              {TRANSITIONS.map((t) => (
                <option key={t} value={t}>
                  {TRANSITION_INFO[t].name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Duration</label>
            <SliderField
              value={tr.duration}
              min={0.1}
              max={max}
              step={0.1}
              decimals={1}
              suffix="s"
              onChange={(v) => setTransition(b.id, { ...tr, duration: v }, `trd-${b.id}`)}
            />
          </div>
          <p className="hint">The two clips overlap around the cut. If a clip has no extra footage, its first/last frame is held.</p>
          <button
            className="btn danger"
            onClick={() => {
              setTransition(b.id, null)
              selectTransition(null)
            }}
          >
            <Trash2 size={14} /> Remove transition
          </button>
        </div>
      </div>
    </>
  )
}

export function EffectInspector({ clip }: { clip: Clip }): React.JSX.Element {
  const fx = clip.effect!
  return (
    <>
      <div className="panel-header">Effect layer</div>
      <div className="panel-body">
        <div className="section">
          <p className="hint" style={{ marginTop: 0 }}>
            Applies to everything below it on the timeline while it plays. Stretch it on the timeline to make it longer.
          </p>
          <div className="field">
            <label>Effect</label>
            <select className="input" value={fx.type} onChange={(e) => updateClip(clip.id, (c) => void (c.effect!.type = e.target.value as EffectType))}>
              {EFFECTS.map((e) => (
                <option key={e} value={e}>
                  {EFFECT_NAMES[e]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Intensity</label>
            <SliderField
              value={fx.intensity}
              min={0}
              max={1}
              suffix="%"
              display={(v) => Math.round(v * 100)}
              parse={(v) => v / 100}
              onChange={(v) => updateClip(clip.id, (c) => void (c.effect!.intensity = v), `fx-${clip.id}`)}
            />
          </div>
        </div>
      </div>
    </>
  )
}
