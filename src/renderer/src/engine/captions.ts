// Turning recognised words into caption clips, and the text style presets.
import type { TextStyle, Word } from '@shared/types'
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
