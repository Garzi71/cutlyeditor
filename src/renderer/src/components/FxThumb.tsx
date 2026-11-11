// Live previews for the Transitions and Effects tiles: the real shaders on two sample scenes.
// Each tile shows a still frame and plays the animation while the mouse is over it.
import { useEffect, useRef } from 'react'
import type { EffectType, TransitionType } from '@shared/types'
import { renderEffect, renderTransition } from '../engine/fx'

const SW = 192
const SH = 120

let scenes: [HTMLCanvasElement, HTMLCanvasElement] | null = null
/** Two simple, colourful pictures (a cool landscape and a warm sunset) to show the effect on. */
export function sampleScenes(): [HTMLCanvasElement, HTMLCanvasElement] {
  if (scenes) return scenes
  const make = (sky: string[], sun: string, hills: string[], sunX: number): HTMLCanvasElement => {
    const c = document.createElement('canvas')
    c.width = SW
    c.height = SH
    const g = c.getContext('2d')!
    const grad = g.createLinearGradient(0, 0, 0, SH)
    sky.forEach((col, i) => grad.addColorStop(i / (sky.length - 1), col))
    g.fillStyle = grad
    g.fillRect(0, 0, SW, SH)
    g.fillStyle = sun
    g.beginPath()
    g.arc(SW * sunX, SH * 0.3, SH * 0.13, 0, Math.PI * 2)
    g.fill()
    hills.forEach((col, i) => {
      g.fillStyle = col
      g.beginPath()
      g.moveTo(0, SH)
      const base = SH * (0.62 + i * 0.13)
      for (let x = 0; x <= SW; x += 8) g.lineTo(x, base - Math.sin((x / SW) * Math.PI * (2 + i) + i * 1.7) * SH * 0.08)
      g.lineTo(SW, SH)
      g.fill()
    })
    return c
  }
  scenes = [
    make(['#7dd3fc', '#38bdf8', '#0e7490'], '#fef9c3', ['#155e75', '#164e63', '#083344'], 0.82),
    make(['#fdba74', '#f472b6', '#7c3aed'], '#fff7ed', ['#9d174d', '#6b21a8', '#3b0764'], 0.18)
  ]
  return scenes
}

/** Still frame per effect: the moment that differs most from the plain picture (found once). */
const bestTime = new Map<EffectType, number>()
function stillTime(effect: EffectType, a: HTMLCanvasElement): number {
  const known = bestTime.get(effect)
  if (known !== undefined) return known
  const w = 48
  const h = 30
  const probe = document.createElement('canvas')
  probe.width = w
  probe.height = h
  const ctx = probe.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(a, 0, 0, w, h)
  const base = ctx.getImageData(0, 0, w, h).data
  let best = 0.35
  let bestDiff = -1
  for (let t = 0.05; t < 2; t += 0.15) {
    ctx.drawImage(renderEffect(a, w, h, effect, 0.85, t), 0, 0, w, h)
    const d = ctx.getImageData(0, 0, w, h).data
    let diff = 0
    for (let i = 0; i < d.length; i += 4) diff += Math.abs(d[i] - base[i]) + Math.abs(d[i + 1] - base[i + 1]) + Math.abs(d[i + 2] - base[i + 2])
    if (diff > bestDiff) {
      bestDiff = diff
      best = t
    }
  }
  bestTime.set(effect, best)
  return best
}

type Props = { transition: TransitionType; effect?: undefined } | { effect: EffectType; transition?: undefined }

export default function FxThumb(props: Props & { playing: boolean }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const { transition, effect, playing } = props

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const [a, b] = sampleScenes()
    const draw = (time: number): void => {
      const dpr = window.devicePixelRatio || 1
      const w = Math.max(1, Math.round(cv.clientWidth * dpr))
      const h = Math.max(1, Math.round(cv.clientHeight * dpr))
      if (cv.width !== w || cv.height !== h) {
        cv.width = w
        cv.height = h
      }
      const out = transition
        ? // 0.4 s on A, 1 s transition, 0.4 s on B
          renderTransition(a, b, w, h, transition, Math.min(1, Math.max(0, (time % 1.8) - 0.4)))
        : renderEffect(a, w, h, effect!, 0.85, time % 2)
      cv.getContext('2d')!.drawImage(out, 0, 0, w, h)
    }
    if (!playing) {
      // Dips are shown a third of the way in, so the tile isn't a flat black / white square.
      draw(transition ? (transition.startsWith('dip') ? 0.4 + 0.33 : 0.9) : stillTime(effect!, a))
      return
    }
    let raf = 0
    const t0 = performance.now()
    const loop = (): void => {
      draw((performance.now() - t0) / 1000)
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [transition, effect, playing])

  return <canvas ref={ref} className="fx-canvas" />
}
