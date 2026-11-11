// Inspector panels for phase 4: keyframe buttons, speed, in/out animations and audio fades.
import { useRef, useState } from 'react'
import { Ban, ChevronLeft, ChevronRight, Diamond, Rewind, RotateCcw, Trash2 } from 'lucide-react'
import AnimThumb from './AnimThumb'
import type { AnimProp, Clip, ClipAnimType, Easing, SpeedSettings } from '@shared/types'
import { CLIP_ANIMS, clipDuration } from '@shared/types'
import { curveSpeedAt, timelineDuration } from '@shared/timing'
import { propAt } from '@shared/motion'
import { clearKeyframes, keyframeAt, setAnimated, setKeyframeEase, setSpeed, toggleKeyframe, updateClip, useEditor } from '../store'
import { player } from '../engine/player'
import { formatShort } from '../lib/util'
import { NumberField, Segmented, SliderField } from './Controls'

/** Time inside the clip at the playhead. */
export function useClipTau(clip: Clip): number {
  const playhead = useEditor((s) => s.playhead)
  return playhead - clip.start
}

/** Diamond next to a property: add/remove a keyframe at the playhead, jump between keyframes. */
export function KeyframeButton({ clip, prop, tau }: { clip: Clip; prop: AnimProp; tau: number }): React.JSX.Element {
  const list = clip.keyframes?.[prop] ?? []
  const here = keyframeAt(clip, prop, tau)
  const inside = tau >= -1e-3 && tau <= clipDuration(clip) + 1e-3
  const prev = [...list].reverse().find((k) => k.t < tau - 1e-3)
  const next = list.find((k) => k.t > tau + 1e-3)
  const go = (t: number): void => {
    player.pause()
    player.seek(clip.start + t)
  }
  return (
    <span className="kf-btns">
      {list.length > 0 && (
        <button className="icon-btn kf-nav" disabled={!prev} title="Previous keyframe" onClick={() => prev && go(prev.t)}>
          <ChevronLeft size={12} />
        </button>
      )}
      <button
        className={`icon-btn kf ${here ? 'on' : list.length ? 'animated' : ''}`}
        disabled={!inside}
        title={here ? 'Remove keyframe' : 'Add keyframe at the playhead'}
        onClick={() => toggleKeyframe(clip.id, prop, Math.max(0, tau), propAt(clip, prop, tau))}
      >
        <Diamond size={12} fill={here ? 'currentColor' : 'none'} />
      </button>
      {list.length > 0 && (
        <button className="icon-btn kf-nav" disabled={!next} title="Next keyframe" onClick={() => next && go(next.t)}>
          <ChevronRight size={12} />
        </button>
      )}
    </span>
  )
}

/** Slider/number row whose value follows keyframes at the playhead. */
export function AnimatedSlider(props: {
  clip: Clip
  prop: AnimProp
  label: string
  min: number
  max: number
  suffix?: string
  display?: (v: number) => number
  parse?: (v: number) => number
}): React.JSX.Element {
  const { clip, prop } = props
  const tau = useClipTau(clip)
  const value = propAt(clip, prop, tau)
  return (
    <div className="field">
      <label className="kf-label">
        {props.label}
        <KeyframeButton clip={clip} prop={prop} tau={tau} />
      </label>
      <SliderField
        value={value}
        min={props.min}
        max={props.max}
        suffix={props.suffix}
        display={props.display}
        parse={props.parse}
        onChange={(v) => setAnimated(clip.id, prop, Math.max(0, tau), v, `kf-${clip.id}-${prop}`)}
      />
    </div>
  )
}

export function AnimatedPosition({ clip }: { clip: Clip }): React.JSX.Element {
  const tau = useClipTau(clip)
  return (
    <div className="field">
      <label className="kf-label">
        Position
        <KeyframeButton clip={clip} prop="x" tau={tau} />
      </label>
      <div className="field-row">
        <NumberField label="X" value={propAt(clip, 'x', tau)} onChange={(v) => setAnimated(clip.id, 'x', Math.max(0, tau), v, `kf-${clip.id}-x`)} />
        <NumberField label="Y" value={propAt(clip, 'y', tau)} onChange={(v) => setAnimated(clip.id, 'y', Math.max(0, tau), v, `kf-${clip.id}-y`)} />
      </div>
    </div>
  )
}

/** Ease of the keyframes under the playhead + "remove all keyframes". */
export function KeyframeTools({ clip, props }: { clip: Clip; props: AnimProp[] }): React.JSX.Element | null {
  const tau = useClipTau(clip)
  const animated = props.filter((p) => (clip.keyframes?.[p]?.length ?? 0) > 0)
  if (!animated.length) return null
  const here = animated.map((p) => [p, keyframeAt(clip, p, tau)] as const).filter(([, k]) => !!k)
  return (
    <div className="kf-tools">
      {here.length > 0 ? (
        <>
          <span>Motion after this keyframe</span>
          <select
            className="input"
            value={here[0][1]!.ease}
            onChange={(e) => here.forEach(([p]) => setKeyframeEase(clip.id, p, tau, e.target.value as Easing))}
          >
            <option value="easeInOut">Smooth</option>
            <option value="linear">Linear</option>
            <option value="easeIn">Ease in</option>
            <option value="easeOut">Ease out</option>
            <option value="hold">Hold (jump)</option>
          </select>
        </>
      ) : (
        <span className="hint">Move the playhead onto a keyframe ◆ to change its motion.</span>
      )}
      <button className="icon-btn sm" title="Remove all keyframes" onClick={() => animated.forEach((p) => clearKeyframes(clip.id, p))}>
        <Trash2 size={13} />
      </button>
    </div>
  )
}

// ---------------- speed ----------------

const CURVE_PRESETS: { name: string; curve: [number, number][] }[] = [
  { name: 'Montage', curve: [[0, 1], [0.2, 3], [0.4, 0.4], [0.6, 0.4], [0.8, 3], [1, 1]] },
  { name: 'Hero', curve: [[0, 1.5], [0.35, 1.5], [0.45, 0.2], [0.65, 0.2], [0.75, 1.5], [1, 1.5]] },
  { name: 'Bullet', curve: [[0, 3], [0.4, 3], [0.5, 0.15], [0.6, 3], [1, 3]] },
  { name: 'Jump cut', curve: [[0, 1], [0.3, 1], [0.35, 6], [0.65, 6], [0.7, 1], [1, 1]] },
  { name: 'Flash in', curve: [[0, 6], [0.3, 1], [1, 1]] },
  { name: 'Flash out', curve: [[0, 1], [0.7, 1], [1, 6]] },
  { name: 'Slow start', curve: [[0, 0.3], [0.4, 1], [1, 1]] }
]

/** Slider position (0..1000) <-> speed on a log scale 0.1x .. 100x. */
const toSlider = (r: number): number => Math.round(((Math.log10(r) + 1) / 3) * 1000)
const fromSlider = (v: number): number => Math.round(Math.pow(10, (v / 1000) * 3 - 1) * 100) / 100

export function SpeedPanel({ clip }: { clip: Clip }): React.JSX.Element {
  const sp: SpeedSettings = clip.speed ?? { rate: 1 }
  const mode = sp.curve ? 'curve' : 'normal'
  const set = (next: SpeedSettings, key?: string): void => setSpeed(clip.id, next, key)
  const D = timelineDuration(clip)
  return (
    <div className="section">
      <Segmented
        value={mode}
        onChange={(m) => set(m === 'normal' ? { rate: sp.rate, reverse: sp.reverse } : { ...sp, curve: CURVE_PRESETS[0].curve, curveName: CURVE_PRESETS[0].name })}
        options={[
          { value: 'normal', label: 'Normal' },
          { value: 'curve', label: 'Curve (ramp)' }
        ]}
      />
      <div style={{ height: 14 }} />
      {mode === 'normal' ? (
        <div className="field">
          <label>Speed</label>
          <div className="slider-row">
            <input
              type="range"
              min={0}
              max={1000}
              value={toSlider(sp.rate)}
              style={{ ['--p' as string]: `${toSlider(sp.rate) / 10}%` }}
              onChange={(e) => set({ ...sp, rate: fromSlider(Number(e.target.value)) }, `spd-${clip.id}`)}
            />
            <NumberField value={sp.rate} decimals={2} step={0.1} min={0.1} max={100} suffix="×" onChange={(v) => set({ ...sp, rate: v }, `spd-${clip.id}`)} />
          </div>
        </div>
      ) : (
        <>
          <div className="preset-chips">
            {CURVE_PRESETS.map((p) => (
              <button key={p.name} className={`chip ${sp.curveName === p.name ? 'active' : ''}`} onClick={() => set({ ...sp, curve: p.curve, curveName: p.name })}>
                {p.name}
              </button>
            ))}
          </div>
          <SpeedCurveEditor curve={sp.curve!} onChange={(curve, key) => set({ ...sp, curve, curveName: 'Custom' }, key)} />
        </>
      )}
      <div className="info-grid" style={{ marginTop: 12 }}>
        <span>Duration</span>
        <b>
          {formatShort(D)} ({D.toFixed(2)} s)
        </b>
      </div>
      <div className="btn-row">
        <button className={`btn ${sp.reverse ? 'primary' : ''}`} onClick={() => set({ ...sp, reverse: !sp.reverse })}>
          <Rewind size={14} /> {sp.reverse ? 'Reversed' : 'Reverse'}
        </button>
        <button className="btn" onClick={() => setSpeed(clip.id, undefined)}>
          <RotateCcw size={14} /> Reset
        </button>
      </div>
      <p className="hint">Voices keep their pitch when sped up or slowed down.</p>
    </div>
  )
}

const CW = 236
const CH = 120
const yOf = (v: number): number => CH / 2 - (Math.log10(Math.max(0.1, Math.min(10, v))) * CH) / 2 // 0.1x bottom, 10x top
const vOf = (y: number): number => Math.round(Math.pow(10, ((CH / 2 - y) * 2) / CH) * 100) / 100

function SpeedCurveEditor({ curve, onChange }: { curve: [number, number][]; onChange: (c: [number, number][], key?: string) => void }): React.JSX.Element {
  const svg = useRef<SVGSVGElement>(null)
  let d = ''
  for (let i = 0; i <= 60; i++) {
    const u = i / 60
    d += `${i ? 'L' : 'M'}${(u * CW).toFixed(1)} ${yOf(curveSpeedAt(curve, u)).toFixed(1)} `
  }
  const drag = (e: React.PointerEvent, i: number): void => {
    e.preventDefault()
    const r = svg.current!.getBoundingClientRect()
    const key = `curve-${Date.now()}`
    const move = (ev: PointerEvent): void => {
      const y = Math.min(CH, Math.max(0, ((ev.clientY - r.top) / r.height) * CH))
      const x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width))
      const next = curve.map((p) => [p[0], p[1]] as [number, number])
      const lo = i > 0 ? next[i - 1][0] + 0.02 : 0
      const hi = i < next.length - 1 ? next[i + 1][0] - 0.02 : 1
      next[i] = [i === 0 ? 0 : i === next.length - 1 ? 1 : Math.min(hi, Math.max(lo, x)), vOf(y)]
      onChange(next, key)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <svg ref={svg} className="speed-curve" viewBox={`0 0 ${CW} ${CH}`}>
      <line x1={0} x2={CW} y1={CH / 2} y2={CH / 2} className="one" />
      <text x={4} y={CH / 2 - 4}>1×</text>
      <text x={4} y={11}>10×</text>
      <text x={4} y={CH - 4}>0.1×</text>
      <path d={d} />
      {curve.map((p, i) => (
        <circle key={i} cx={p[0] * CW} cy={yOf(p[1])} r={5} onPointerDown={(e) => drag(e, i)}>
          <title>{p[1]}×</title>
        </circle>
      ))}
    </svg>
  )
}

// ---------------- in / out animations ----------------

const ANIM_LABEL: Record<ClipAnimType, string> = {
  fade: 'Fade', zoomIn: 'Zoom in', zoomOut: 'Zoom out', slideLeft: 'Slide left', slideRight: 'Slide right',
  slideUp: 'Slide up', slideDown: 'Slide down', pop: 'Pop', spin: 'Spin', blur: 'Blur', typewriter: 'Typewriter'
}

function AnimTile(props: { type: ClipAnimType | null; out: boolean; active: boolean; onClick: () => void }): React.JSX.Element {
  const [hover, setHover] = useState(false)
  const name = props.type ? ANIM_LABEL[props.type] : 'None'
  return (
    <button
      className={`tile ${props.active ? 'active' : ''}`}
      title={name}
      onClick={props.onClick}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <div className="tile-thumb anim-thumb">
        {props.type ? <AnimThumb type={props.type} out={props.out} playing={hover} /> : <Ban size={18} />}
      </div>
      <span className="tile-name">{name}</span>
    </button>
  )
}

export function AnimationPanel({ clip }: { clip: Clip }): React.JSX.Element {
  const types = CLIP_ANIMS.filter((t) => t !== 'typewriter' || !!clip.text)
  const D = clipDuration(clip)
  const row = (which: 'animIn' | 'animOut', title: string): React.JSX.Element => {
    const a = clip[which]
    return (
      <div className="section">
        <div className="section-title">{title}</div>
        <div className="anim-grid">
          <AnimTile type={null} out={which === 'animOut'} active={!a} onClick={() => updateClip(clip.id, (c) => void delete c[which])} />
          {types.map((t) => (
            <AnimTile
              key={t}
              type={t}
              out={which === 'animOut'}
              active={a?.type === t}
              onClick={() =>
                updateClip(clip.id, (c) => {
                  c[which] = { type: t, duration: a?.duration ?? Math.min(t === 'typewriter' ? 1.5 : 0.6, D / 2) }
                })
              }
            />
          ))}
        </div>
        {a && (
          <div className="field" style={{ marginTop: 12 }}>
            <label>Duration</label>
            <SliderField
              value={a.duration}
              min={0.1}
              max={Math.max(0.2, Math.min(5, D))}
              step={0.1}
              decimals={1}
              suffix="s"
              onChange={(v) => updateClip(clip.id, (c) => void (c[which]!.duration = v), `anim-${clip.id}-${which}`)}
            />
          </div>
        )}
      </div>
    )
  }
  return (
    <>
      {row('animIn', 'In animation')}
      {row('animOut', 'Out animation')}
    </>
  )
}

export function AudioFades({ clip }: { clip: Clip }): React.JSX.Element {
  const D = clipDuration(clip)
  const fade = (which: 'fadeIn' | 'fadeOut', label: string): React.JSX.Element => (
    <div className="field">
      <label>{label}</label>
      <SliderField
        value={clip[which] ?? 0}
        min={0}
        max={Math.max(0.5, Math.min(10, D / 2))}
        step={0.1}
        decimals={1}
        suffix="s"
        onChange={(v) => updateClip(clip.id, (c) => void (c[which] = v || undefined), `fade-${clip.id}-${which}`)}
      />
    </div>
  )
  return (
    <>
      {fade('fadeIn', 'Fade in')}
      {fade('fadeOut', 'Fade out')}
    </>
  )
}
