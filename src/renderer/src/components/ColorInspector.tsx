// "Color" tab for a video/photo clip or an adjustment layer.
import { useRef, useState } from 'react'
import { Copy, Link2, Loader2, RotateCcw, Upload, Wand2, X } from 'lucide-react'
import type { Clip, ColorAdjust, ColorGrade, CurvePoints, HslBand } from '@shared/types'
import { HSL_BANDS } from '@shared/types'
import { applyColorToAll, setClipColor, toast, useEditor } from '../store'
import { IDENTITY_CURVE, curveTable, defaultGrade, loadCube } from '../engine/color'
import { FILTERS } from '../engine/filters'
import { autoCorrect, matchColors } from '../engine/autocolor'
import { formatShort } from '../lib/util'
import { Section, SliderField } from './Controls'

const errMsg = (e: unknown): string => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export async function importLutInto(clipId: string | null, onNew: (grade: ColorGrade) => void): Promise<void> {
  const path = await window.api.openLutDialog()
  if (!path) return
  try {
    await loadCube(path)
  } catch (e) {
    toast(`Can't use this LUT: ${errMsg(e)}`, 'error')
    return
  }
  const lut = { path, name: path.split(/[\\/]/).pop()!.replace(/\.cube$/i, ''), intensity: 1 }
  const p = useEditor.getState().project!
  const clip = clipId ? p.clips.find((c) => c.id === clipId) : undefined
  if (clip) setClipColor(clip.id, { ...(clip.color ?? defaultGrade()), lut })
  else onNew({ ...defaultGrade(), lut })
}

export default function ColorInspector({ clip }: { clip: Clip }): React.JSX.Element {
  const project = useEditor((s) => s.project)!
  const g: ColorGrade = clip.color ?? defaultGrade()
  const a = g.adjust
  const [busy, setBusy] = useState<'auto' | 'match' | null>(null)
  const [band, setBand] = useState<HslBand>('red')
  const isAdj = !!clip.adjustment
  const others = project.clips.filter((c) => {
    if (c.id === clip.id || c.text || c.adjustment) return false
    const m = project.media.find((x) => x.id === c.mediaId)
    return m && m.kind !== 'audio'
  })
  const [matchRef, setMatchRef] = useState<string>(others[0]?.id ?? '')

  const update = (fn: (d: ColorGrade) => void, key?: string): void => {
    const next: ColorGrade = structuredClone(g)
    fn(next)
    setClipColor(clip.id, next, key)
  }
  const setA = (k: keyof ColorAdjust, v: number): void => update((d) => void (d.adjust[k] = v), `col-${clip.id}-${k}`)

  const slider = (k: keyof ColorAdjust, label: string, min = -100, max = 100, step = 1): React.JSX.Element => (
    <div className="field" key={k}>
      <label onDoubleClick={() => setA(k, 0)} title="Double-click to reset">
        {label}
      </label>
      <SliderField value={a[k]} min={min} max={max} step={step} decimals={step < 1 ? 2 : 0} onChange={(v) => setA(k, v)} />
    </div>
  )

  const runAuto = async (): Promise<void> => {
    setBusy('auto')
    try {
      setClipColor(clip.id, await autoCorrect(project, clip))
      toast('Colors corrected. Fine-tune with the sliders below.', 'success')
    } catch (e) {
      toast(`Auto color failed: ${errMsg(e)}`, 'error')
    } finally {
      setBusy(null)
    }
  }
  const runMatch = async (): Promise<void> => {
    const ref = project.clips.find((c) => c.id === matchRef)
    if (!ref) return
    setBusy('match')
    try {
      setClipColor(clip.id, await matchColors(project, ref, clip))
      toast('Colors matched to the reference clip.', 'success')
    } catch (e) {
      toast(`Matching failed: ${errMsg(e)}`, 'error')
    } finally {
      setBusy(null)
    }
  }
  const clipName = (c: Clip): string => `${project.media.find((m) => m.id === c.mediaId)?.name ?? 'Clip'} · ${formatShort(c.start)}`
  const filter = g.filter ? FILTERS.find((f) => f.id === g.filter!.id) : undefined
  const hsl = g.hsl?.[band] ?? { h: 0, s: 0, l: 0 }
  const setHsl = (k: 'h' | 's' | 'l', v: number): void =>
    update((d) => {
      d.hsl = d.hsl ?? {}
      d.hsl[band] = { ...(d.hsl[band] ?? { h: 0, s: 0, l: 0 }), [k]: v }
    }, `hsl-${clip.id}-${band}-${k}`)

  return (
    <>
      {!isAdj && (
        <div className="section">
          <div className="btn-row">
            <button className="btn primary" disabled={!!busy} onClick={runAuto}>
              {busy === 'auto' ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />} Auto color
            </button>
            <button className="btn" title="Reset all color settings" onClick={() => setClipColor(clip.id, undefined)}>
              <RotateCcw size={14} /> Reset
            </button>
          </div>
          {g.match ? (
            <div className="chip-row">
              <Link2 size={13} /> Matched to {clipName(project.clips.find((c) => c.id === g.match!.ref) ?? clip)}
              <button className="icon-btn sm" title="Remove match" onClick={() => update((d) => void delete d.match)}>
                <X size={13} />
              </button>
            </div>
          ) : (
            others.length > 0 && (
              <div className="match-row">
                <select className="input" value={matchRef} onChange={(e) => setMatchRef(e.target.value)}>
                  {others.map((c) => (
                    <option key={c.id} value={c.id}>
                      {clipName(c)}
                    </option>
                  ))}
                </select>
                <button className="btn" disabled={!!busy || !matchRef} onClick={runMatch} title="Make this clip look like the chosen one">
                  {busy === 'match' ? <Loader2 size={14} className="spin" /> : <Link2 size={14} />} Match
                </button>
              </div>
            )
          )}
          <button
            className="btn block"
            style={{ marginTop: 8, marginBottom: 10 }}
            onClick={() => {
              const n = applyColorToAll(clip.id)
              toast(`Color copied to ${n} other clip${n === 1 ? '' : 's'}`, 'success')
            }}
          >
            <Copy size={14} /> Apply this look to all clips
          </button>
        </div>
      )}

      <div className="section">
        <div className="section-title">Filter &amp; LUT</div>
        {filter ? (
          <div className="field">
            <label>{filter.name}</label>
            <div className="color-slider" style={{ gridTemplateColumns: '1fr 28px' }}>
              <SliderField
                value={g.filter!.intensity}
                min={0}
                max={1}
                suffix="%"
                display={(v) => Math.round(v * 100)}
                parse={(v) => v / 100}
                onChange={(v) => update((d) => void (d.filter!.intensity = v), `flt-${clip.id}`)}
              />
              <button className="icon-btn sm" title="Remove filter" onClick={() => update((d) => void delete d.filter)}>
                <X size={13} />
              </button>
            </div>
          </div>
        ) : (
          <p className="hint" style={{ marginTop: -4 }}>
            Pick a filter in the Filters tab on the left.
          </p>
        )}
        {g.lut ? (
          <div className="field">
            <label title={g.lut.path}>{g.lut.name}</label>
            <div className="color-slider" style={{ gridTemplateColumns: '1fr 28px' }}>
              <SliderField
                value={g.lut.intensity}
                min={0}
                max={1}
                suffix="%"
                display={(v) => Math.round(v * 100)}
                parse={(v) => v / 100}
                onChange={(v) => update((d) => void (d.lut!.intensity = v), `lut-${clip.id}`)}
              />
              <button className="icon-btn sm" title="Remove LUT" onClick={() => update((d) => void delete d.lut)}>
                <X size={13} />
              </button>
            </div>
          </div>
        ) : (
          <button className="btn" style={{ width: '100%', marginBottom: 12 }} onClick={() => importLutInto(clip.id, () => {})}>
            <Upload size={14} /> Import LUT (.cube)
          </button>
        )}
      </div>

      <Section id="color-light" title="Light">
        {slider('exposure', 'Exposure', -2, 2, 0.05)}
        {slider('contrast', 'Contrast')}
        {slider('highlights', 'Highlights')}
        {slider('shadows', 'Shadows')}
        {slider('whites', 'Whites')}
        {slider('blacks', 'Blacks')}
      </Section>

      <Section id="color-color" title="Color">
        {slider('temperature', 'Temperature')}
        {slider('tint', 'Tint')}
        {slider('saturation', 'Saturation')}
        {slider('vibrance', 'Vibrance')}
      </Section>

      <Section
        id="color-hsl"
        title="HSL"
        defaultOpen={false}
        actions={
          g.hsl && (
            <button className="icon-btn sm" title="Reset HSL" onClick={() => update((d) => void delete d.hsl)}>
              <RotateCcw size={14} />
            </button>
          )
        }
      >
        <div className="hsl-bands">
          {HSL_BANDS.map((b) => {
            const v = g.hsl?.[b]
            const changed = !!v && (v.h || v.s || v.l)
            return (
              <button
                key={b}
                className={`hsl-swatch ${band === b ? 'active' : ''} ${changed ? 'changed' : ''}`}
                style={{ background: BAND_COLORS[b] }}
                title={b}
                onClick={() => setBand(b)}
              />
            )
          })}
        </div>
        <div className="field">
          <label>{band[0].toUpperCase() + band.slice(1)} hue</label>
          <SliderField value={hsl.h} min={-100} max={100} onChange={(v) => setHsl('h', v)} />
        </div>
        <div className="field">
          <label>Saturation</label>
          <SliderField value={hsl.s} min={-100} max={100} onChange={(v) => setHsl('s', v)} />
        </div>
        <div className="field">
          <label>Luminance</label>
          <SliderField value={hsl.l} min={-100} max={100} onChange={(v) => setHsl('l', v)} />
        </div>
      </Section>

      <Section
        id="color-curves"
        title="Curves"
        defaultOpen={false}
        actions={
          g.curves && (
            <button className="icon-btn sm" title="Reset curves" onClick={() => update((d) => void delete d.curves)}>
              <RotateCcw size={14} />
            </button>
          )
        }
      >
        <CurvesEditor
          curves={g.curves}
          onChange={(curves, key) => update((d) => void (d.curves = curves), key ? `crv-${clip.id}-${key}` : undefined)}
          onReset={() => update((d) => void delete d.curves)}
        />
      </Section>

      <Section id="color-effects" title="Details" defaultOpen={false}>
        {slider('sharpen', 'Sharpen', 0, 100)}
        {slider('vignette', 'Vignette', 0, 100)}
      </Section>
    </>
  )
}

const BAND_COLORS: Record<HslBand, string> = {
  red: '#e53935', orange: '#fb8c00', yellow: '#fdd835', green: '#43a047', aqua: '#00acc1', blue: '#1e88e5', purple: '#8e24aa', magenta: '#d81b60'
}

type Channel = 'master' | 'r' | 'g' | 'b'
const CH_COLOR: Record<Channel, string> = { master: '#ffffff', r: '#ff5c5c', g: '#4cd964', b: '#4da3ff' }
const SIZE = 236

function CurvesEditor(props: {
  curves: ColorGrade['curves']
  onChange: (c: NonNullable<ColorGrade['curves']>, key?: string) => void
  onReset: () => void
}): React.JSX.Element {
  const [ch, setCh] = useState<Channel>('master')
  const svgRef = useRef<SVGSVGElement>(null)
  const curves = props.curves ?? { master: IDENTITY_CURVE, r: IDENTITY_CURVE, g: IDENTITY_CURVE, b: IDENTITY_CURVE }
  const pts = curves[ch]
  const table = curveTable(pts)
  let d = ''
  for (let i = 0; i <= 64; i++) {
    const x = i / 64
    const y = table[Math.round(x * (table.length - 1))]
    d += `${i ? 'L' : 'M'}${(x * SIZE).toFixed(1)} ${((1 - Math.min(1, Math.max(0, y))) * SIZE).toFixed(1)} `
  }

  const toPoint = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect()
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))]
  }
  const setPts = (next: CurvePoints, key?: string): void => props.onChange({ ...curves, [ch]: next }, key)

  const onDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    const [x, y] = toPoint(e)
    const r = svgRef.current!.getBoundingClientRect()
    const near = pts.findIndex((p) => Math.hypot((p[0] - x) * r.width, (p[1] - y) * r.height) < 10)
    let list: CurvePoints = pts.map((p) => [p[0], p[1]])
    let idx = near
    if (idx < 0) {
      list.push([x, y])
      list.sort((p, q) => p[0] - q[0])
      idx = list.findIndex((p) => p[0] === x && p[1] === y)
    }
    const key = `${ch}-${Date.now()}`
    setPts(list, key)
    const move = (ev: PointerEvent): void => {
      const [mx, my] = toPoint(ev)
      list = list.map((p) => [p[0], p[1]])
      const isEnd = idx === 0 || idx === list.length - 1
      const lo = idx > 0 ? list[idx - 1][0] + 0.01 : 0
      const hi = idx < list.length - 1 ? list[idx + 1][0] - 0.01 : 1
      list[idx] = [isEnd ? list[idx][0] : Math.min(hi, Math.max(lo, mx)), my]
      setPts(list, key)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onDouble = (e: React.MouseEvent): void => {
    const [x, y] = toPoint(e)
    const r = svgRef.current!.getBoundingClientRect()
    const i = pts.findIndex((p) => Math.hypot((p[0] - x) * r.width, (p[1] - y) * r.height) < 10)
    if (i > 0 && i < pts.length - 1) setPts(pts.filter((_, k) => k !== i))
  }

  return (
    <>
      <div className="curve-tabs">
        <div style={{ display: 'flex', gap: 2 }}>
          {(['master', 'r', 'g', 'b'] as Channel[]).map((c) => (
            <button
              key={c}
              className={`curve-tab ${ch === c ? 'active' : ''}`}
              style={{ color: CH_COLOR[c] }}
              onClick={() => setCh(c)}
            >
              {c === 'master' ? 'All' : c.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <svg
        ref={svgRef}
        className="curves"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        onPointerDown={onDown}
        onDoubleClick={onDouble}
      >
        {[0.25, 0.5, 0.75].map((v) => (
          <g key={v}>
            <line x1={v * SIZE} y1={0} x2={v * SIZE} y2={SIZE} />
            <line x1={0} y1={v * SIZE} x2={SIZE} y2={v * SIZE} />
          </g>
        ))}
        <line x1={0} y1={SIZE} x2={SIZE} y2={0} className="diag" />
        <path d={d} style={{ stroke: CH_COLOR[ch] }} />
        {pts.map((p, i) => (
          <circle key={i} cx={p[0] * SIZE} cy={(1 - p[1]) * SIZE} r={5} style={{ stroke: CH_COLOR[ch] }} />
        ))}
      </svg>
      <p className="hint" style={{ margin: '6px 0 10px' }}>
        Click to add a point, drag to move, double-click to remove.
      </p>
    </>
  )
}
