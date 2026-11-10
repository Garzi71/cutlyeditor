// Draws text clips. The same code renders the live preview and the exported video,
// so captions look identical in both.
import type { Clip, TextData, TextStyle } from '@shared/types'

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
  k: number
): void {
  const data = clip.text
  if (!data || !data.content.trim()) return
  const s = data.style
  const tr = clip.transform
  const layout = layoutText(data, canvasW, k)
  const lit = activeWord(data, localTime)

  ctx.save()
  ctx.globalAlpha = tr.opacity
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
    const r = Math.min(s.size * k * 0.25, height / 2)
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

  const drawPass = (pass: 'stroke' | 'fill'): void => {
    layout.lines.forEach((line, li) => {
      const y = top + pad + lineHeight * (li + 0.5)
      let x =
        s.align === 'left' ? left + pad : s.align === 'right' ? left + width - pad - line.width : -line.width / 2
      for (const t of line.tokens) {
        if (pass === 'stroke') {
          ctx.strokeText(t.text, x, y)
        } else {
          ctx.fillStyle = t.wordIndex >= 0 && t.wordIndex === lit ? s.highlight : s.color
          ctx.fillText(t.text, x, y)
        }
        x += t.width + layout.spaceWidth
      }
    })
  }

  if (s.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.55)'
    ctx.shadowBlur = s.size * k * 0.12
    ctx.shadowOffsetY = s.size * k * 0.04
  }
  if (s.strokeWidth > 0) {
    ctx.strokeStyle = s.stroke
    ctx.lineWidth = s.strokeWidth * 2 * k
    drawPass('stroke')
    ctx.shadowColor = 'transparent'
  }
  drawPass('fill')
  ctx.restore()
}

/** Times (clip-local) where the picture of this text clip changes (word highlight). */
export function textChangePoints(data: TextData): number[] {
  if (!data.words || data.style.highlight.toLowerCase() === data.style.color.toLowerCase()) return []
  const pts: number[] = []
  for (const w of data.words) pts.push(w.start, w.end)
  return pts
}
