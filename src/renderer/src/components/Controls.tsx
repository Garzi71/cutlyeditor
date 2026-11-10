// Small reusable inputs used by the inspector and dialogs.
import { useEffect, useRef, useState } from 'react'
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
  const pct = ((shown - display(min)) / (display(max) - display(min))) * 100
  return (
    <div className="slider-row">
      <input
        type="range"
        min={display(min)}
        max={display(max)}
        step={step}
        value={shown}
        style={{ ['--p' as string]: `${clamp(pct, 0, 100)}%` }}
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
