// Right panel for a selected text / caption clip.
import { useEffect, useState } from 'react'
import { AlignCenter, AlignLeft, AlignRight, CaseUpper, Italic, RotateCcw, Sparkles } from 'lucide-react'
import type { Clip, TextStyle, WordFx } from '@shared/types'
import { applyTextStyleToTrack, applyTextTemplate, defaultTransform, toast, updateClip, useEditor } from '../store'
import { BUNDLED_FONTS, getSystemFonts, weightsFor } from '../lib/fonts'
import { ColorField, Segmented, SliderField } from './Controls'
import CaptionTemplates from './CaptionTemplates'
import { templateStyle } from '../engine/captions'
import { AnimatedPosition, AnimatedSlider, AnimationPanel, KeyframeTools } from './MotionPanels'

const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'Extra light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semibold',
  700: 'Bold',
  800: 'Extra bold',
  900: 'Black'
}

type TextTab = 'text' | 'templates' | 'motion'
let lastTextTab: TextTab = 'text'

export default function TextInspector({ clip }: { clip: Clip }): React.JSX.Element {
  const data = clip.text!
  const s = data.style
  const tr = clip.transform
  const [systemFonts, setSystemFonts] = useState<string[]>([])
  const captionsOnTrack = useEditor((st) => st.project?.clips.filter((c) => c.trackId === clip.trackId && c.text).length ?? 0)

  useEffect(() => {
    getSystemFonts().then(setSystemFonts)
  }, [])

  const setStyle = <K extends keyof TextStyle>(key: K, value: TextStyle[K]): void =>
    updateClip(
      clip.id,
      (c) => {
        c.text!.style[key] = value
      },
      `ts-${clip.id}-${key}`
    )
  const setTr = (field: keyof Clip['transform'], v: number): void =>
    updateClip(
      clip.id,
      (c) => {
        c.transform[field] = v
      },
      `tr-${clip.id}-${field}`
    )

  const [tab, setTabState] = useState<TextTab>(lastTextTab)
  const setTab = (t: TextTab): void => {
    lastTextTab = t
    setTabState(t)
  }

  const bundled = BUNDLED_FONTS.some((f) => f.family === s.font)
  const weights = bundled ? weightsFor(s.font) : [400, 700]

  return (
    <>
      <div className="insp-tabs">
        {(
          [
            ['text', data.caption ? 'Caption' : 'Text'],
            ['templates', 'Templates'],
            ['motion', 'Motion']
          ] as [TextTab, string][]
        ).map(([id, label]) => (
          <button key={id} className={`insp-tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="panel-body">
        {tab === 'templates' && (
          <>
            <WordAnimation clip={clip} />
            <div className="section">
              <p className="hint" style={{ margin: '0 0 12px', lineHeight: 1.5 }}>
                {data.caption ? 'Click a style to use it for all captions on this track.' : 'Click a style to use it for this text.'}
              </p>
              <CaptionTemplates
                onPick={(t) => {
                  const p = useEditor.getState().project!
                  const n = applyTextTemplate(clip.id, templateStyle(t, p.width, p.height).style)
                  toast(n > 1 ? `${t.name} applied to ${n} captions` : `${t.name} applied`, 'success')
                }}
              />
            </div>
          </>
        )}
        {tab === 'text' && (
          <>
            <div className="section">
              <textarea
                className="input text-area"
                value={data.content}
                rows={3}
                spellCheck={false}
                onChange={(e) =>
                  updateClip(
                    clip.id,
                    (c) => {
                      c.text!.content = e.target.value
                    },
                    `txt-${clip.id}`
                  )
                }
              />
              {data.caption && captionsOnTrack > 1 && (
                <button
                  className="btn block"
                  style={{ marginBottom: 10 }}
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
                  <button
                    className={`icon-btn ${s.italic ? 'active on' : ''}`}
                    title="Italic"
                    onClick={() => setStyle('italic', !s.italic)}
                  >
                    <Italic size={15} />
                  </button>
                  <button
                    className={`icon-btn ${s.uppercase ? 'active on' : ''}`}
                    title="Uppercase"
                    onClick={() => setStyle('uppercase', !s.uppercase)}
                  >
                    <CaseUpper size={16} />
                  </button>
                  <span className="sep-v" />
                  {(['left', 'center', 'right'] as const).map((a) => {
                    const Icon = a === 'left' ? AlignLeft : a === 'center' ? AlignCenter : AlignRight
                    return (
                      <button
                        key={a}
                        className={`icon-btn ${s.align === a ? 'active on' : ''}`}
                        title={`Align ${a}`}
                        onClick={() => setStyle('align', a)}
                      >
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
              {(data.words || s.fx) && (
                <div className="field">
                  <label>Current word</label>
                  <ColorInput value={s.highlight} onChange={(v) => setStyle('highlight', v)} />
                </div>
              )}
              <div className="field">
                <label>Outline</label>
                <div className="color-slider">
                  <ColorInput compact value={s.stroke} onChange={(v) => setStyle('stroke', v)} />
                  <SliderField value={s.strokeWidth} min={0} max={30} onChange={(v) => setStyle('strokeWidth', v)} />
                </div>
              </div>
              <div className="field">
                <label>Background</label>
                <div className="color-slider">
                  <ColorInput compact value={s.background} onChange={(v) => setStyle('background', v)} />
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
          </>
        )}
        {tab === 'motion' && (
          <>
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
              <AnimatedSlider
                clip={clip}
                prop="scale"
                label="Scale"
                min={0.05}
                max={4}
                suffix="%"
                display={(v) => Math.round(v * 100)}
                parse={(v) => v / 100}
              />
              <AnimatedPosition clip={clip} />
              <AnimatedSlider clip={clip} prop="rotation" label="Rotate" min={-180} max={180} suffix="°" />
              <AnimatedSlider
                clip={clip}
                prop="opacity"
                label="Opacity"
                min={0}
                max={1}
                suffix="%"
                display={(v) => Math.round(v * 100)}
                parse={(v) => v / 100}
              />
              <KeyframeTools clip={clip} props={['x', 'y', 'scale', 'rotation', 'opacity']} />
            </div>
            <AnimationPanel clip={clip} />
          </>
        )}
      </div>
    </>
  )
}

const DEFAULT_FX: WordFx = {
  show: 'all',
  enter: 'pop',
  activeScale: 1.1,
  box: '',
  dim: 1,
  glow: false
}

/** Word-by-word animation (used by caption templates; plain text gets evenly timed words). */
function WordAnimation({ clip }: { clip: Clip }): React.JSX.Element {
  const s = clip.text!.style
  const fx = s.fx
  const setFx = (patch: Partial<WordFx> | null, key?: string): void =>
    updateClip(
      clip.id,
      (c) => {
        const st = c.text!.style
        st.fx = patch === null ? undefined : { ...(st.fx ?? DEFAULT_FX), ...patch }
      },
      key ? `fx-${clip.id}-${key}` : undefined
    )

  return (
    <div className="section">
      <div className="section-title">
        Word animation
        <label className="switch">
          <input type="checkbox" checked={!!fx} onChange={(e) => setFx(e.target.checked ? {} : null)} />
          <span />
        </label>
      </div>
      {!fx ? (
        <p className="hint">
          {clip.text!.words ? 'Animate each word as it is spoken.' : 'Words appear one after another while the text is on screen.'}
        </p>
      ) : (
        <>
          <div className="field">
            <label>Show</label>
            <Segmented
              value={fx.show}
              onChange={(v) => setFx({ show: v })}
              options={[
                { value: 'all', label: 'All' },
                { value: 'spoken', label: 'Build' },
                { value: 'current', label: 'One' }
              ]}
            />
          </div>
          <div className="field">
            <label>Entrance</label>
            <select className="input" value={fx.enter} onChange={(e) => setFx({ enter: e.target.value as WordFx['enter'] })}>
              <option value="none">None</option>
              <option value="pop">Pop</option>
              <option value="bounce">Bounce</option>
              <option value="slide">Slide up</option>
              <option value="fade">Fade</option>
              <option value="zoom">Zoom</option>
            </select>
          </div>
          <div className="field">
            <label>Word size</label>
            <SliderField
              value={fx.activeScale}
              min={1}
              max={1.6}
              suffix="%"
              display={(v) => Math.round(v * 100)}
              parse={(v) => v / 100}
              onChange={(v) => setFx({ activeScale: v }, 'scale')}
            />
          </div>
          {fx.show === 'all' && (
            <div className="field">
              <label>Upcoming</label>
              <SliderField
                value={fx.dim}
                min={0}
                max={1}
                suffix="%"
                display={(v) => Math.round(v * 100)}
                parse={(v) => v / 100}
                onChange={(v) => setFx({ dim: v }, 'dim')}
              />
            </div>
          )}
          <div className="field">
            <label>Word box</label>
            <div className="color-slider">
              <label className="switch">
                <input type="checkbox" checked={!!fx.box} onChange={(e) => setFx({ box: e.target.checked ? '#7c3aed' : '' })} />
                <span />
              </label>
              {fx.box && <ColorInput compact value={fx.box} onChange={(v) => setFx({ box: v }, 'box')} />}
            </div>
          </div>
          <div className="field">
            <label>Glow</label>
            <label className="switch">
              <input type="checkbox" checked={fx.glow} onChange={(e) => setFx({ glow: e.target.checked })} />
              <span />
            </label>
          </div>
        </>
      )}
    </div>
  )
}

function ColorInput(props: { value: string; onChange: (v: string) => void; compact?: boolean }): React.JSX.Element {
  return <ColorField {...props} />
}

