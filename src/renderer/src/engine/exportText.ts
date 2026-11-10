// Before an export, every text track is rendered into transparent full-frame PNGs,
// one per visual change (clip start/end, highlighted word). ffmpeg then overlays them.
import type { Project, TextLayer } from '@shared/types'
import { clipEnd, projectDuration } from '@shared/types'
import { ensureFont } from '../lib/fonts'
import { activeWord, drawTextClip, textChangePoints } from './text'

export async function renderTextLayers(
  project: Project,
  W: number,
  H: number,
  onProgress: (fraction: number) => void
): Promise<TextLayer[]> {
  await window.api.newExportTemp()
  const textClips = project.clips.filter((c) => c.text && c.text.content.trim())
  if (!textClips.length) return []

  const fonts = new Set(textClips.map((c) => `${c.text!.style.font}|${c.text!.style.weight}|${c.text!.style.italic}`))
  await Promise.all([...fonts].map((f) => {
    const [family, weight, italic] = f.split('|')
    return ensureFont(family, Number(weight), italic === 'true')
  }))

  const total = projectDuration(project)
  const k = W / project.width
  const canvas = new OffscreenCanvas(W, H)
  const ctx = canvas.getContext('2d')!
  let fileNo = 0
  const save = async (): Promise<string> => {
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    return window.api.writeExportTemp(`text-${fileNo++}.png`, new Uint8Array(await blob.arrayBuffer()))
  }
  ctx.clearRect(0, 0, W, H)
  const blank = await save()

  const tracks = project.tracks.filter((t) => t.kind === 'video' && !t.hidden && textClips.some((c) => c.trackId === t.id))
  // For progress: number of segments over all tracks (approximate).
  const workTotal = textClips.reduce((a, c) => a + 2 + textChangePoints(c.text!).length, 0) || 1
  let work = 0

  const layers: TextLayer[] = []
  for (const track of tracks) {
    const clips = textClips.filter((c) => c.trackId === track.id).sort((a, b) => a.start - b.start)
    const times = new Set<number>([0, total])
    const r = (t: number): number => Math.round(t * 1000) / 1000
    for (const c of clips) {
      times.add(r(c.start))
      times.add(r(clipEnd(c)))
      for (const p of textChangePoints(c.text!)) {
        const t = c.start + (p - c.in)
        if (t > c.start && t < clipEnd(c)) times.add(r(t))
      }
    }
    const sorted = [...times].filter((t) => t >= 0 && t <= total).sort((a, b) => a - b)
    const segments: TextLayer['segments'] = []
    let lastKey = ''
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i]
      const b = sorted[i + 1]
      if (b - a < 0.0005) continue
      const mid = (a + b) / 2
      const c = clips.find((x) => mid >= x.start && mid < clipEnd(x))
      const local = c ? c.in + (mid - c.start) : 0
      const key = c ? `${c.id}|${activeWord(c.text!, local)}` : 'blank'
      if (key === lastKey && segments.length) {
        segments[segments.length - 1].duration += b - a
        continue
      }
      lastKey = key
      let png = blank
      if (c) {
        ctx.clearRect(0, 0, W, H)
        drawTextClip(ctx, c, local, W, H, k)
        png = await save()
        work++
        if (work % 5 === 0) onProgress(Math.min(1, work / workTotal))
      }
      segments.push({ png, duration: b - a })
    }
    layers.push({ trackId: track.id, segments })
  }
  onProgress(1)
  return layers
}
