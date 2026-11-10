// Right panel for a selected text / caption clip.
import { useEffect, useState } from 'react'
import { AlignCenter, AlignLeft, AlignRight, CaseUpper, Italic, RotateCcw, Sparkles } from 'lucide-react'
import type { Clip, TextStyle } from '@shared/types'
import { applyTextStyleToTrack, defaultTransform, toast, updateClip, useEditor } from '../store'
import { BUNDLED_FONTS, getSystemFonts, weightsFor } from '../lib/fonts'
import { NumberField, SliderField } from './Controls'

const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin', 200: 'Extra light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black'
}

export default function TextInspector({ clip }: { clip: Clip }): React.JSX.Element {
  const data = clip.text!
  const s = data.style
  const tr = clip.transform
  const [systemFonts, setSystemFonts] = useState<string[]>([])
  const captionsOnTrack = useEditor(
    (st) => st.project?.clips.filter((c) => c.trackId === clip.trackId && c.text).length ?? 0
  )

  useEffect(() => {
    getSystemFonts().then(setSystemFonts)
  }, [])

  const setStyle = <K extends keyof TextStyle>(key: K, value: TextStyle[K]): void =>
    updateClip(clip.id, (c) => {
      c.text!.style[key] = value
    }, `ts-${clip.id}-${key}`)
  const setTr = (field: keyof Clip['transform'], v: number): void =>
    updateClip(clip.id, (c) => {
      c.transform[field] = v
    }, `tr-${clip.id}-${field}`)

  const bundled = BUNDLED_FONTS.some((f) => f.family === s.font)
  const weights = bundled ? weightsFor(s.font) : [400, 700]

  return (
    <>
      <div className="insp-tabs">
        <button className="insp-tab active">{data.caption ? 'Caption' : 'Text'}</button>
      </div>
      <div className="panel-body">
        <div className="section">
          <textarea
            className="input text-area"
            value={data.content}
            rows={3}
            spellCheck={false}
            onChange={(e) =>
              updateClip(clip.id, (c) => {
                c.text!.content = e.target.value
              }, `txt-${clip.id}`)
            }
          />
          {data.caption && captionsOnTrack > 1 && (
            <button
              className="btn"
              style={{ width: '100%', marginBottom: 12 }}
              onClick={() => {
                const n = applyTextStyleToTrack(clip.id)
                toast(`Style applied to ${n} other caption${n === 1 ? '' : 's'}`, 'success')
              }}
            >
              <Sparkles size={14} /> Apply this style to all captions
            </button>
          )}
        </div>

        <div className="section">
          <div className="section-title">Font</div>
          <div className="field">
            <label>Family</label>
            <select
              className="input"
              value={s.font}
              onChange={(e) => {
                const f = e.target.value
                const ws = BUNDLED_FONTS.find((x) => x.family === f)?.weights ?? [400, 700]
                updateClip(clip.id, (c) => {
                  c.text!.style.font = f
                  if (!ws.includes(c.text!.style.weight)) c.text!.style.weight = ws[ws.length - 1]
                })
              }}
            >
              <optgroup label="Included">
                {BUNDLED_FONTS.map((f) => (
                  <option key={f.family} value={f.family} style={{ fontFamily: f.family }}>
                    {f.family}
                  </option>
                ))}
              </optgroup>
              {systemFonts.length > 0 && (
                <optgroup label="Installed on this PC">
                  {systemFonts.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </optgroup>
              )}
              {!bundled && !systemFonts.includes(s.font) && <option value={s.font}>{s.font}</option>}
            </select>
          </div>
          <div className="field">
            <label>Weight</label>
            <select className="input" value={s.weight} onChange={(e) => setStyle('weight', Number(e.target.value))}>
              {weights.map((w) => (
                <option key={w} value={w}>
                  {WEIGHT_NAMES[w] ?? w}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Size</label>
            <SliderField value={s.size} min={10} max={300} onChange={(v) => setStyle('size', v)} />
          </div>
          <div className="field">
            <label>Style</label>
            <div className="toggle-row">
              <button className={`icon-btn ${s.italic ? 'active on' : ''}`} title="Italic" onClick={() => setStyle('italic', !s.italic)}>
                <Italic size={15} />
              </button>
              <button className={`icon-btn ${s.uppercase ? 'active on' : ''}`} title="Uppercase" onClick={() => setStyle('uppercase', !s.uppercase)}>
                <CaseUpper size={16} />
              </button>
              <span className="sep-v" />
              {(['left', 'center', 'right'] as const).map((a) => {
                const Icon = a === 'left' ? AlignLeft : a === 'center' ? AlignCenter : AlignRight
                return (
                  <button key={a} className={`icon-btn ${s.align === a ? 'active on' : ''}`} title={`Align ${a}`} onClick={() => setStyle('align', a)}>
                    <Icon size={15} />
                  </button>
                )
              })}
            </div>
          </div>
          <div className="field">
            <label>Line width</label>
            <SliderField
              value={s.maxWidth}
              min={0.2}
              max={1}
              suffix="%"
              display={(v) => Math.round(v * 100)}
              parse={(v) => v / 100}
              onChange={(v) => setStyle('maxWidth', v)}
            />
          </div>
        </div>

        <div className="section">
          <div className="section-title">Colors</div>
          <div className="field">
            <label>Text</label>
            <ColorInput value={s.color} onChange={(v) => setStyle('color', v)} />
          </div>
          {data.words && (
            <div className="field">
              <label>Spoken word</label>
              <ColorInput value={s.highlight} onChange={(v) => setStyle('highlight', v)} />
            </div>
          )}
          <div className="field">
            <label>Outline</label>
            <div className="color-slider">
              <ColorInput value={s.stroke} onChange={(v) => setStyle('stroke', v)} />
              <SliderField value={s.strokeWidth} min={0} max={30} onChange={(v) => setStyle('strokeWidth', v)} />
            </div>
          </div>
          <div className="field">
            <label>Background</label>
            <div className="color-slider">
              <ColorInput value={s.background} onChange={(v) => setStyle('background', v)} />
              <SliderField
                value={s.backgroundOpacity}
                min={0}
                max={1}
                suffix="%"
                display={(v) => Math.round(v * 100)}
                parse={(v) => v / 100}
                onChange={(v) => setStyle('backgroundOpacity', v)}
              />
            </div>
          </div>
          <div className="field">
            <label>Shadow</label>
            <label className="switch">
              <input type="checkbox" checked={s.shadow} onChange={(e) => setStyle('shadow', e.target.checked)} />
              <span />
            </label>
          </div>
        </div>

        <div className="section">
          <div className="section-title">
            Transform
            <button className="icon-btn sm" title="Reset" onClick={() => updateClip(clip.id, (c) => void (c.transform = defaultTransform()))}>
              <RotateCcw size={14} />
            </button>
          </div>
          <div className="field">
            <label>Scale</label>
            <SliderField
              value={tr.scale}
              min={0.05}
              max={4}
              suffix="%"
              display={(v) => Math.round(v * 100)}
              parse={(v) => v / 100}
              onChange={(v) => setTr('scale', v)}
            />
          </div>
          <div className="field">
            <label>Position</label>
            <div className="field-row">
              <NumberField label="X" value={tr.x} onChange={(v) => setTr('x', v)} />
              <NumberField label="Y" value={tr.y} onChange={(v) => setTr('y', v)} />
            </div>
          </div>
          <div className="field">
            <label>Rotate</label>
            <SliderField value={tr.rotation} min={-180} max={180} suffix="°" onChange={(v) => setTr('rotation', v)} />
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
              onChange={(v) => setTr('opacity', v)}
            />
          </div>
        </div>
      </div>
    </>
  )
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }): React.JSX.Element {
  return <input type="color" className="color-input" value={value} onChange={(e) => onChange(e.target.value)} />
}
