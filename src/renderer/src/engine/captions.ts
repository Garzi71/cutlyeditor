// Turning recognised words into caption clips, and the text style presets.
import type { TextStyle, Word, WordFx } from '@shared/types'
import type { CaptionChunk } from '../store'
import { DEFAULT_TEXT_STYLE } from './text'

export type CaptionMode = 'tiktok' | 'classic'

const endsSentence = (w: string): boolean => /[.!?…]["»”]?$/.test(w)
const endsClause = (w: string): boolean => /[,;:–—]$/.test(w)

/**
 * TikTok: 1–3 words at a time, never across a pause or sentence end.
 * Classic: up to two lines of roughly `lineChars` characters.
 */
export function groupWords(words: Word[], mode: CaptionMode, lineChars: number): CaptionChunk[] {
  const chunks: CaptionChunk[] = []
  let cur: Word[] = []
  const flush = (): void => {
    if (cur.length) chunks.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur })
    cur = []
  }
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const prev = cur[cur.length - 1]
    if (prev) {
      const gap = w.start - prev.end
      const len = cur.reduce((a, x) => a + x.text.length + 1, 0) + w.text.length
      const tooLong =
        mode === 'tiktok'
          ? cur.length >= 3 || len > 18 || w.end - cur[0].start > 1.6
          : len > lineChars * 2 || w.end - cur[0].start > 6
      if (gap > 0.6 || tooLong) flush()
    }
    cur.push(w)
    if (endsSentence(w.text) || (mode === 'tiktok' && endsClause(w.text))) flush()
  }
  flush()
  // Close tiny gaps so captions don't blink between chunks; keep each on screen long enough.
  for (let i = 0; i < chunks.length; i++) {
    const next = chunks[i + 1]
    const minEnd = chunks[i].start + (mode === 'tiktok' ? 0.3 : 0.8)
    let end = Math.max(chunks[i].end, minEnd)
    if (next) {
      if (next.start - end < 0.35) end = next.start
      end = Math.min(end, next.start)
    }
    chunks[i].end = end
  }
  return chunks
}

export function captionStyle(mode: CaptionMode, projectW: number, projectH: number): { style: TextStyle; y: number } {
  const short = Math.min(projectW, projectH)
  const portrait = projectH > projectW
  if (mode === 'tiktok') {
    return {
      style: {
        ...DEFAULT_TEXT_STYLE,
        font: 'Montserrat',
        weight: 900,
        uppercase: true,
        size: Math.round(short * (portrait ? 0.085 : 0.075)),
        color: '#ffffff',
        highlight: '#ffe14d',
        stroke: '#000000',
        strokeWidth: Math.round(short * 0.008),
        shadow: true,
        backgroundOpacity: 0,
        maxWidth: 0.8
      },
      y: Math.round(projectH * (portrait ? 0.12 : 0.18))
    }
  }
  return {
    style: {
      ...DEFAULT_TEXT_STYLE,
      font: 'Inter',
      weight: 600,
      uppercase: false,
      size: Math.round(short * (portrait ? 0.05 : 0.048)),
      color: '#ffffff',
      highlight: '#ffffff',
      stroke: '#000000',
      strokeWidth: 0,
      shadow: false,
      background: '#000000',
      backgroundOpacity: 0.6,
      maxWidth: portrait ? 0.86 : 0.7
    },
    y: Math.round(projectH * (portrait ? 0.3 : 0.38))
  }
}

/** A caption look: style + word animation, sized for a 1080-wide portrait frame. */
export interface CaptionTemplate {
  id: string
  name: string
  group: CaptionMode // 'tiktok' = 1–3 words at a time, 'classic' = up to two lines
  style: Partial<TextStyle>
}

const fx = (f: Partial<WordFx>): WordFx => ({ show: 'all', enter: 'none', activeScale: 1, box: '', dim: 1, glow: false, ...f })

export const CAPTION_TEMPLATES: CaptionTemplate[] = [
  {
    id: 'karaoke',
    name: 'Karaoke',
    group: 'tiktok',
    style: { font: 'Montserrat', weight: 900, uppercase: true, size: 92, color: '#ffffff', highlight: '#ffe14d', stroke: '#000000', strokeWidth: 9, shadow: true, fx: fx({}) }
  },
  {
    id: 'pop',
    name: 'Pop',
    group: 'tiktok',
    style: { font: 'Montserrat', weight: 900, uppercase: true, size: 92, color: '#ffffff', highlight: '#3dff8b', stroke: '#000000', strokeWidth: 9, shadow: true, fx: fx({ enter: 'pop', activeScale: 1.14 }) }
  },
  {
    id: 'box',
    name: 'Highlight box',
    group: 'tiktok',
    style: { font: 'Poppins', weight: 800, uppercase: false, size: 84, color: '#ffffff', highlight: '#ffffff', strokeWidth: 0, shadow: true, fx: fx({ box: '#7c3aed', activeScale: 1.06 }) }
  },
  {
    id: 'one',
    name: 'One word',
    group: 'tiktok',
    style: { font: 'Anton', weight: 400, uppercase: true, size: 140, color: '#ffffff', highlight: '#ffffff', stroke: '#000000', strokeWidth: 10, shadow: true, fx: fx({ show: 'current', enter: 'zoom' }) }
  },
  {
    id: 'build',
    name: 'Build up',
    group: 'tiktok',
    style: { font: 'Montserrat', weight: 800, uppercase: false, size: 86, color: '#ffffff', highlight: '#ffffff', strokeWidth: 0, shadow: true, fx: fx({ show: 'spoken', enter: 'slide' }) }
  },
  {
    id: 'bounce',
    name: 'Bounce',
    group: 'tiktok',
    style: { font: 'Poppins', weight: 800, uppercase: true, size: 88, color: '#ffffff', highlight: '#ff4d6d', stroke: '#000000', strokeWidth: 8, shadow: true, fx: fx({ show: 'spoken', enter: 'bounce', activeScale: 1.08 }) }
  },
  {
    id: 'neon',
    name: 'Neon',
    group: 'tiktok',
    style: { font: 'Oswald', weight: 700, uppercase: true, size: 96, color: '#e9fbff', highlight: '#22e4ff', strokeWidth: 0, shadow: false, fx: fx({ glow: true, activeScale: 1.08, dim: 0.55 }) }
  },
  {
    id: 'soft',
    name: 'Soft karaoke',
    group: 'tiktok',
    style: { font: 'Inter', weight: 800, uppercase: false, size: 84, color: '#ffffff', highlight: '#ffffff', strokeWidth: 0, shadow: true, fx: fx({ dim: 0.38 }) }
  },
  {
    id: 'news',
    name: 'Red box',
    group: 'tiktok',
    style: { font: 'Archivo Black', weight: 400, uppercase: true, size: 80, color: '#ffffff', highlight: '#ffffff', strokeWidth: 0, shadow: true, fx: fx({ box: '#e11d48', enter: 'pop', activeScale: 1.05 }) }
  },
  {
    id: 'glow',
    name: 'Glow pop',
    group: 'tiktok',
    style: { font: 'Montserrat', weight: 900, uppercase: true, size: 90, color: '#ffffff', highlight: '#ffb21a', strokeWidth: 0, shadow: true, fx: fx({ show: 'spoken', enter: 'pop', glow: true, activeScale: 1.1 }) }
  },
  {
    id: 'elegant',
    name: 'Elegant',
    group: 'tiktok',
    style: { font: 'Playfair Display', weight: 700, italic: true, uppercase: false, size: 88, color: '#ffffff', highlight: '#f5d27a', strokeWidth: 0, shadow: true, fx: fx({ show: 'spoken', enter: 'fade' }) }
  },
  {
    id: 'classic',
    name: 'Subtitles',
    group: 'classic',
    style: { font: 'Inter', weight: 600, uppercase: false, size: 54, color: '#ffffff', highlight: '#ffffff', strokeWidth: 0, shadow: false, background: '#000000', backgroundOpacity: 0.6 }
  }
]

/** A template's style sized for the project, and where captions go (y offset from the centre). */
export function templateStyle(t: CaptionTemplate, projectW: number, projectH: number): { style: TextStyle; y: number } {
  const short = Math.min(projectW, projectH)
  const portrait = projectH > projectW
  const k = (short / 1080) * (portrait ? 1 : 0.88)
  const style: TextStyle = {
    ...DEFAULT_TEXT_STYLE,
    backgroundOpacity: 0,
    italic: false,
    ...t.style,
    fx: t.style.fx ? { ...t.style.fx } : undefined,
    size: Math.round((t.style.size ?? DEFAULT_TEXT_STYLE.size) * k),
    strokeWidth: Math.round((t.style.strokeWidth ?? 0) * k),
    maxWidth: t.group === 'classic' ? (portrait ? 0.86 : 0.7) : 0.8
  }
  const y = Math.round(projectH * (t.group === 'classic' ? (portrait ? 0.3 : 0.38) : portrait ? 0.12 : 0.18))
  return { style, y }
}

/** Rough characters per line for classic captions, from the frame shape. */
export function lineCharsFor(projectW: number, projectH: number): number {
  return projectH > projectW ? 26 : 42
}

export interface TextPreset {
  name: string
  style: Partial<TextStyle>
}

export const TEXT_PRESETS: TextPreset[] = [
  { name: 'Basic', style: { font: 'Inter', weight: 600, strokeWidth: 0, shadow: true } },
  { name: 'Bold outline', style: { font: 'Montserrat', weight: 900, uppercase: true, strokeWidth: 8, stroke: '#000000' } },
  { name: 'Yellow pop', style: { font: 'Montserrat', weight: 900, uppercase: true, color: '#ffe14d', strokeWidth: 8, stroke: '#000000' } },
  { name: 'Boxed', style: { font: 'Poppins', weight: 700, strokeWidth: 0, shadow: false, backgroundOpacity: 0.85, background: '#000000' } },
  { name: 'White box', style: { font: 'Poppins', weight: 800, color: '#111111', strokeWidth: 0, shadow: false, backgroundOpacity: 1, background: '#ffffff' } },
  { name: 'Headline', style: { font: 'Bebas Neue', weight: 400, size: 130, strokeWidth: 0, shadow: true } },
  { name: 'Impact', style: { font: 'Anton', weight: 400, uppercase: true, size: 110, color: '#ff4d6d', strokeWidth: 6, stroke: '#ffffff' } },
  { name: 'Elegant', style: { font: 'Playfair Display', weight: 700, italic: true, strokeWidth: 0, shadow: true } },
  { name: 'Retro', style: { font: 'Lobster', weight: 400, size: 96, color: '#ff9f1c', strokeWidth: 5, stroke: '#2b1b0e' } },
  { name: 'Neon', style: { font: 'Oswald', weight: 700, uppercase: true, color: '#7df9ff', strokeWidth: 3, stroke: '#0047ff', shadow: true } }
]

export const LANGUAGES = [
  { code: 'auto', label: 'Detect automatically' },
  { code: 'cs', label: 'Czech' },
  { code: 'sk', label: 'Slovak' },
  { code: 'en', label: 'English' },
  { code: 'de', label: 'German' },
  { code: 'pl', label: 'Polish' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'it', label: 'Italian' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'ru', label: 'Russian' }
]
