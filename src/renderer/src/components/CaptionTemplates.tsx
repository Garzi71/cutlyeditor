// Grid of animated caption templates. Each card plays the real template on a short sample phrase,
// drawn with the same code as the preview and the export, so what you see is what you get.
import { useEffect, useRef } from 'react'
import { Check } from 'lucide-react'
import type { Clip } from '@shared/types'
import { CAPTION_TEMPLATES, templateStyle, type CaptionTemplate } from '../engine/captions'
import { drawTextClip } from '../engine/text'
import { ensureFont } from '../lib/fonts'

const SAMPLE = ['This', 'is', 'so', 'easy']
const WORD = 0.42
const PERIOD = SAMPLE.length * WORD + 0.9
// The last word stays until the loop restarts, so no tile is ever empty.
const wordAt = (i: number): { start: number; end: number } => ({
  start: 0.02 + i * WORD,
  end: i === SAMPLE.length - 1 ? PERIOD : 0.02 + (i + 1) * WORD
})

function sampleClip(t: CaptionTemplate): Clip {
  const { style } = templateStyle(t, 1080, 1920)
  return {
    id: 'sample-' + t.id,
    trackId: '',
    mediaId: '',
    start: 0,
    in: 0,
    out: PERIOD,
    volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    text: {
      content: SAMPLE.join(' '),
      style: { ...style, maxWidth: 0.92 },
      caption: true,
      words: SAMPLE.map((text, i) => ({ text, ...wordAt(i) }))
    }
  }
}

export default function CaptionTemplates({
  selected,
  onPick
}: {
  selected?: string
  onPick: (t: CaptionTemplate) => void
}): React.JSX.Element {
  const canvases = useRef<(HTMLCanvasElement | null)[]>([])

  useEffect(() => {
    const clips = CAPTION_TEMPLATES.map(sampleClip)
    for (const c of clips) void ensureFont(c.text!.style.font, c.text!.style.weight, c.text!.style.italic)
    let raf = 0
    const t0 = performance.now()
    const frame = (): void => {
      const time = Math.min(PERIOD - 0.05, Math.max(0.03, ((performance.now() - t0) / 1000) % PERIOD))
      clips.forEach((clip, i) => {
        const cv = canvases.current[i]
        if (!cv) return
        const dpr = window.devicePixelRatio || 1
        const w = Math.round(cv.clientWidth * dpr)
        const h = Math.round(cv.clientHeight * dpr)
        if (!w || !h) return
        if (cv.width !== w || cv.height !== h) {
          cv.width = w
          cv.height = h
        }
        const ctx = cv.getContext('2d')!
        ctx.clearRect(0, 0, w, h)
        drawTextClip(ctx, clip, time, w, h, w / 720)
      })
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="cap-tpl-grid">
      {CAPTION_TEMPLATES.map((t, i) => (
        <button key={t.id} className={`cap-tpl ${selected === t.id ? 'selected' : ''}`} title={t.name} onClick={() => onPick(t)}>
          <canvas ref={(el) => void (canvases.current[i] = el)} />
          <span className="cap-tpl-name">{t.name}</span>
          {selected === t.id && (
            <span className="cap-tpl-check">
              <Check size={11} strokeWidth={3} />
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
