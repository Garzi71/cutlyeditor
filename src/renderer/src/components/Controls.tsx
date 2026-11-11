// Small reusable inputs used by the inspector and dialogs.
import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { clamp } from '../lib/util'

/** Numeric input; drag the label left/right to scrub the value. */
export function NumberField(props: {
  value: number
  onChange: (v: number) => void
  label?: string
  step?: number
  min?: number
  max?: number
  decimals?: number
  suffix?: string
}): React.JSX.Element {
  const { value, onChange, label, step = 1, min = -Infinity, max = Infinity, decimals = 0, suffix } = props
  const [text, setText] = useState(value.toFixed(decimals))
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(value.toFixed(decimals))
  }, [value, decimals])

  const commitText = (): void => {
    const v = parseFloat(text.replace(',', '.'))
    if (!isNaN(v)) onChange(clamp(v, min, max))
    else setText(value.toFixed(decimals))
  }

  const onScrub = (e: React.PointerEvent): void => {
    const startX = e.clientX
    const start = value
    const move = (ev: PointerEvent): void => {
      const v = start + Math.round((ev.clientX - startX) / 2) * step
      onChange(clamp(v, min, max))
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="num">
      {label && <span onPointerDown={onScrub}>{label}</span>}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false
          commitText()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            onChange(clamp(value + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1), min, max))
          }
        }}
      />
      {suffix && <span>{suffix}</span>}
    </div>
  )
}

/** Slider + number box. */
export function SliderField(props: {
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  decimals?: number
  suffix?: string
  display?: (v: number) => number
  parse?: (v: number) => number
}): React.JSX.Element {
  const { value, onChange, min, max, step = 1, decimals = 0, suffix, display = (v) => v, parse = (v) => v } = props
  const shown = display(value)
  const lo = display(min)
  const hi = display(max)
  const pct = clamp(((shown - lo) / (hi - lo)) * 100, 0, 100)
  // Ranges that go below and above zero fill from the zero point (so "0" looks untouched).
  const bipolar = lo < 0 && hi > 0
  const zero = bipolar ? (-lo / (hi - lo)) * 100 : 0
  return (
    <div className="slider-row">
      <input
        type="range"
        className={bipolar ? 'bipolar' : undefined}
        min={lo}
        max={hi}
        step={step}
        value={shown}
        style={{
          ['--a' as string]: `${Math.min(zero, pct)}%`,
          ['--p' as string]: `${Math.max(zero, pct)}%`,
          ['--z' as string]: `calc(${zero}% - 1px)`
        }}
        onChange={(e) => onChange(parse(Number(e.target.value)))}
      />
      <NumberField
        value={shown}
        decimals={decimals}
        step={step}
        suffix={suffix}
        onChange={(v) => onChange(parse(v))}
      />
    </div>
  )
}

function readOpen(id: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem('sec:' + id)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

/** Inspector section that can be folded away (remembered per section). */
export function Section(props: {
  id: string
  title: React.ReactNode
  actions?: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(() => readOpen(props.id, props.defaultOpen ?? true))
  const toggle = (): void => {
    setOpen(!open)
    try {
      localStorage.setItem('sec:' + props.id, open ? '0' : '1')
    } catch {
      /* ignore */
    }
  }
  return (
    <div className={`section ${open ? '' : 'closed'}`}>
      <div className="section-title collapsible" onClick={toggle}>
        <span className="grow">
          <ChevronDown size={14} className="chev" />
          {props.title}
        </span>
        {open && props.actions && (
          <span className="title-actions" onClick={(e) => e.stopPropagation()}>
            {props.actions}
          </span>
        )}
      </div>
      {open && props.children}
    </div>
  )
}

/** Colour picker as a small swatch, optionally with the hex value next to it. */
export function ColorField(props: { value: string; onChange: (v: string) => void; compact?: boolean; title?: string }): React.JSX.Element {
  const swatch = (
    <label className="swatch" title={props.title ?? 'Pick a color'}>
      <input type="color" value={props.value} onChange={(e) => props.onChange(e.target.value)} />
      <span style={{ background: props.value }} />
    </label>
  )
  if (props.compact) return swatch
  return (
    <div className="color-field">
      {swatch}
      <span className="hex">{props.value.toUpperCase()}</span>
    </div>
  )
}

export function Segmented<T extends string | number>(props: {
  value: T
  options: { value: T; label: string; disabled?: boolean }[]
  onChange: (v: T) => void
}): React.JSX.Element {
  return (
    <div className="seg">
      {props.options.map((o) => (
        <button
          key={String(o.value)}
          className={o.value === props.value ? 'active' : ''}
          disabled={o.disabled}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
