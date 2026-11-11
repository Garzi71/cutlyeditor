// Draws text clips. The same code renders the live preview and the exported video,
// so captions look identical in both.
import type { Clip, TextData, TextStyle } from '@shared/types'
import type { Pose } from '@shared/motion'

export const DEFAULT_TEXT_STYLE: TextStyle = {
  font: 'Montserrat',
  size: 80,
  weight: 800,
  italic: false,
  uppercase: false,
  color: '#ffffff',
  align: 'center',
  stroke: '#000000',
  strokeWidth: 6,
  shadow: true,
  background: '#000000',
  backgroundOpacity: 0,
  highlight: '#ffe14d',
  maxWidth: 0.85
}

interface Token {
  text: string
  width: number
  wordIndex: number // index into data.words, -1 if unknown
}

interface Line {
  tokens: Token[]
  width: number
}

export interface TextLayout {
  lines: Line[]
  width: number
  height: number
  lineHeight: number
  spaceWidth: number
  font: string
  pad: number
}

let measureCtx: CanvasRenderingContext2D | null = null
function mctx(): CanvasRenderingContext2D {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')!
  return measureCtx
}

export function fontString(s: TextStyle, k = 1): string {
  return `${s.italic ? 'italic ' : ''}${s.weight} ${Math.max(1, s.size * k)}px "${s.font}", "Segoe UI", sans-serif`
}

/** Word-wrap the text. `k` scales project pixels to output pixels; `frameW` is in output pixels. */
export function layoutText(data: TextData, frameW: number, k = 1): TextLayout {
  const s = data.style
  const ctx = mctx()
  const font = fontString(s, k)
  ctx.font = font
  const content = s.uppercase ? data.content.toUpperCase() : data.content
  const spaceWidth = ctx.measureText(' ').width
  const maxW = frameW * s.maxWidth
  // Map visible words to spoken words only when they correspond 1:1 (i.e. text not edited).
  const mapWords = !!data.words && data.words.length === content.replace(/\n/g, ' ').split(/\s+/).filter(Boolean).length
  let wordIndex = 0
  const lines: Line[] = []
  for (const para of content.split('\n')) {
    let line: Line = { tokens: [], width: 0 }
    for (const w of para.split(/[ \t]+/).filter(Boolean)) {
      const width = ctx.measureText(w).width
      const extra = line.tokens.length ? spaceWidth + width : width
      if (line.tokens.length && line.width + extra > maxW) {
        lines.push(line)
        line = { tokens: [], width: 0 }
      }
      line.width += line.tokens.length ? spaceWidth + width : width
      line.tokens.push({ text: w, width, wordIndex: mapWords ? wordIndex : -1 })
      wordIndex++
    }
    lines.push(line)
  }
  const lineHeight = s.size * k * 1.18
  const pad = s.backgroundOpacity > 0 ? s.size * k * 0.35 : 0
  const width = Math.max(1, ...lines.map((l) => l.width)) + pad * 2
  const height = lines.length * lineHeight + pad * 2
  return { lines, width, height, lineHeight, spaceWidth, font, pad }
}

/** Size of the text box in project pixels (before the clip's scale). */
export function measureTextClip(data: TextData, projectWidth: number): { w: number; h: number } {
  const l = layoutText(data, projectWidth, 1)
  const outline = data.style.strokeWidth * 2
  return { w: l.width + outline, h: l.height + outline }
}

export function activeWord(data: TextData, localTime: number): number {
  if (!data.words) return -1
  for (let i = 0; i < data.words.length; i++) {
    const w = data.words[i]
    if (localTime >= w.start && localTime < w.end) return i
    // Between two words: keep the previous one lit so the highlight doesn't flicker.
    const next = data.words[i + 1]
    if (next && localTime >= w.end && localTime < next.start) return i
  }
  return -1
}

/** How long a word's entrance animation lasts (seconds). */
const ENTER = 0.22

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
const easeOutCubic = (p: number): number => 1 - Math.pow(1 - p, 3)
const easeOutBack = (p: number): number => {
  const c = 1.9
  return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2)
}
const easeOutBounce = (p: number): number => {
  const n = 7.5625
  const d = 2.75
  if (p < 1 / d) return n * p * p
  if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75
  if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375
  return n * (p -= 2.625 / d) * p + 0.984375
}

/**
 * Word times for animated text. Captions have real ones; plain text with a word animation gets
 * evenly spaced times (each word ~0.4 s, all shown by 80 % of the clip).
 */
export function wordTimes(data: TextData, clipIn: number, clipOut: number): TextData['words'] {
  if (data.words || !data.style.fx) return data.words
  const tokens = data.content.split(/\s+/).filter(Boolean)
  if (!tokens.length) return undefined
  const per = Math.min(0.4, ((clipOut - clipIn) * 0.8) / tokens.length)
  return tokens.map((text, i) => ({
    text,
    start: clipIn + i * per,
    end: i === tokens.length - 1 ? Math.max(clipOut, clipIn + (i + 1) * per) : clipIn + (i + 1) * per
  }))
}

/**
 * Draw a text clip.
 * @param localTime time inside the clip (clip.in + time since clip.start)
 * @param k project pixels -> canvas pixels
 */
export function drawTextClip(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  clip: Clip,
  localTime: number,
  canvasW: number,
  canvasH: number,
  k: number,
  pose?: Pose
): void {
  let data = clip.text
  if (!data || !data.content.trim()) return
  const s = data.style
  const fx = s.fx
  if (fx && !data.words) data = { ...data, words: wordTimes(data, clip.in, clip.out) }
  let lit = activeWord(data, localTime)
  if (fx?.show === 'current') {
    // Only the word being spoken, centred on its own.
    const all = data.words
    if (lit < 0 || !all) return
    const w = all[lit]
    data = { ...data, content: w.text, words: [w] }
    lit = 0
  }
  const words = data.words
  const tr = pose ?? { ...clip.transform, blur: 0, reveal: 1 }
  const layout = layoutText(data, canvasW, k)
  // Typewriter: only the first characters are shown (layout stays the same, so nothing jumps).
  const totalChars = layout.lines.reduce((a, l) => a + l.tokens.reduce((b, t) => b + t.text.length + 1, 0), 0)
  const charBudget = tr.reveal >= 1 ? Infinity : Math.floor(totalChars * tr.reveal)
  const size = s.size * k

  ctx.save()
  ctx.globalAlpha = tr.opacity
  if (tr.blur > 0) ctx.filter = `blur(${(tr.blur * k).toFixed(2)}px)`
  ctx.translate(canvasW / 2 + tr.x * k, canvasH / 2 + tr.y * k)
  ctx.rotate((tr.rotation * Math.PI) / 180)
  ctx.scale(tr.scale, tr.scale)

  const { width, height, lineHeight, pad } = layout
  const left = -width / 2
  const top = -height / 2

  if (s.backgroundOpacity > 0) {
    ctx.save()
    ctx.globalAlpha = tr.opacity * s.backgroundOpacity
    ctx.fillStyle = s.background
    const r = Math.min(size * 0.25, height / 2)
    ctx.beginPath()
    ctx.roundRect(left, top, width, height, r)
    ctx.fill()
    ctx.restore()
  }

  ctx.font = layout.font
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.lineJoin = 'round'
  ctx.miterLimit = 2

  // Where every word goes, and how it looks right now.
  interface Placed {
    text: string
    x: number // centre
    y: number
    line: number
    w: number
    active: boolean
    alpha: number
    scale: number
    dy: number
  }
  const placed: Placed[] = []
  let charsLeft = charBudget
  layout.lines.forEach((line, li) => {
    const y = top + pad + lineHeight * (li + 0.5)
    let x = s.align === 'left' ? left + pad : s.align === 'right' ? left + width - pad - line.width : -line.width / 2
    for (const t of line.tokens) {
      if (charsLeft <= 0) break
      const text = charsLeft < t.text.length ? t.text.slice(0, charsLeft) : t.text
      charsLeft -= t.text.length + 1
      const p: Placed = { text, x: x + t.width / 2, y, line: li, w: ctx.measureText(text).width, active: false, alpha: 1, scale: 1, dy: 0 }
      x += t.width + layout.spaceWidth
      const w = t.wordIndex >= 0 ? words?.[t.wordIndex] : undefined
      if (w) {
        p.active = t.wordIndex === lit
        const spoken = localTime >= w.start
        if (fx) {
          if (fx.show === 'spoken' && !spoken) continue
          if (fx.show === 'all' && !spoken && !p.active) p.alpha = fx.dim
          // Entrance: words that appear animate in; with all words visible, the current one is emphasised.
          const e = spoken ? clamp01((localTime - w.start) / ENTER) : 1
          if (e < 1 && fx.enter !== 'none') {
            const appearing = fx.show !== 'all'
            if (fx.enter === 'pop') {
              p.scale = appearing ? 0.4 + 0.6 * easeOutBack(e) : 1 + 0.25 * Math.sin(Math.PI * e)
              if (appearing) p.alpha *= clamp01(e * 3)
            } else if (fx.enter === 'bounce') {
              p.dy = appearing ? -size * 0.6 * (1 - easeOutBounce(e)) : -size * 0.18 * Math.sin(Math.PI * e)
              if (appearing) p.alpha *= clamp01(e * 4)
            } else if (fx.enter === 'slide') {
              p.dy = size * 0.45 * (1 - easeOutCubic(e))
              if (appearing) p.alpha *= easeOutCubic(e)
            } else if (fx.enter === 'fade') {
              if (appearing) p.alpha *= easeOutCubic(e)
            } else if (fx.enter === 'zoom') {
              p.scale = 1 + (appearing ? 0.7 : 0.3) * (1 - easeOutCubic(e))
              if (appearing) p.alpha *= clamp01(e * 2.5)
            }
          }
          if (p.active && fx.activeScale !== 1)
            p.scale *= 1 + (fx.activeScale - 1) * easeOutCubic(clamp01((localTime - w.start) / 0.1))
        }
      }
      placed.push(p)
    }
  })

  // A bigger or boxed current word pushes its neighbours aside instead of overlapping them.
  for (const p of placed) {
    if (!p.active || (p.scale <= 1 && !fx?.box)) continue
    const grow = (Math.max(1, p.scale) - 1) * (p.w / 2) + (fx?.box ? size * 0.16 * p.scale : 0)
    for (const q of placed) if (q !== p && q.line === p.line) q.x += q.x < p.x ? -grow : grow
  }

  const shadowOn = (): void => {
    if (!s.shadow) return
    ctx.shadowColor = 'rgba(0,0,0,0.55)'
    ctx.shadowBlur = size * 0.12
    ctx.shadowOffsetY = size * 0.04
  }
  const shadowOff = (): void => {
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetY = 0
  }
  const at = (p: Placed, draw: () => void): void => {
    if (p.alpha <= 0.001) return
    ctx.save()
    ctx.globalAlpha = tr.opacity * p.alpha
    ctx.translate(p.x, p.y + p.dy)
    if (p.scale !== 1) ctx.scale(p.scale, p.scale)
    draw()
    ctx.restore()
  }
  const box = (p: Placed): void =>
    at(p, () => {
      const px = size * 0.16
      const h = size * 1.12
      ctx.fillStyle = fx!.box
      ctx.beginPath()
      ctx.roundRect(-p.w / 2 - px, -h / 2, p.w + px * 2, h, size * 0.2)
      ctx.fill()
    })
  const stroke = (p: Placed): void => at(p, () => ctx.strokeText(p.text, -p.w / 2, 0))
  const fill = (p: Placed): void =>
    at(p, () => {
      const on = p.active && !!words
      ctx.fillStyle = on ? s.highlight : s.color
      if (on && fx?.glow) {
        ctx.shadowColor = s.highlight
        ctx.shadowBlur = size * 0.45
        ctx.shadowOffsetY = 0
        ctx.fillText(p.text, -p.w / 2, 0)
      }
      ctx.fillText(p.text, -p.w / 2, 0)
    })

  // The current word is drawn last so its box, outline and size sit on top of its neighbours.
  for (const group of [placed.filter((p) => !p.active), placed.filter((p) => p.active)]) {
    if (fx?.box) for (const p of group) if (p.active) box(p)
    shadowOn()
    if (s.strokeWidth > 0) {
      ctx.strokeStyle = s.stroke
      ctx.lineWidth = s.strokeWidth * 2 * k
      for (const p of group) stroke(p)
      shadowOff()
    }
    for (const p of group) fill(p)
    shadowOff()
  }
  ctx.restore()
}

/** Times (clip-local) where the picture of this text clip changes (word highlight). */
export function textChangePoints(data: TextData): number[] {
  if (!data.words || data.style.highlight.toLowerCase() === data.style.color.toLowerCase()) return []
  const pts: number[] = []
  for (const w of data.words) pts.push(w.start, w.end)
  return pts
}
