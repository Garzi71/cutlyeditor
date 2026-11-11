// One function draws a frame of the project at time t. The preview and the export both use it,
// so everything (motion, transitions, text, color, effects) looks the same in both.
import type { Clip, MediaItem, Project, TransitionType } from '@shared/types'
import { clipDuration, clipEnd, fitSize } from '@shared/types'
import { poseAt } from '@shared/motion'
import { gradeIsActive } from './color'
import { colorProcessor } from './gl'
import { drawTextClip } from './text'
import { renderEffect, renderTransition } from './fx'

/** Returns something drawable for a media clip at timeline time t (or null if not ready yet). */
export type FrameSource = (c: Clip, m: MediaItem, t: number) => CanvasImageSource | null

type Ctx = CanvasRenderingContext2D

const ADJACENT = 0.05

/** The clip on the same track that ends where `c` starts. */
export function previousClip(p: Project, c: Clip): Clip | undefined {
  return p.clips.find((x) => x.trackId === c.trackId && x.id !== c.id && Math.abs(clipEnd(x) - c.start) < ADJACENT)
}

export interface TransitionWindow {
  a: Clip
  b: Clip
  start: number
  end: number
  type: TransitionType
}

/** Transition into clip `b`: centred on the cut, never longer than either clip. */
export function transitionWindow(p: Project, b: Clip): TransitionWindow | null {
  if (!b.transitionIn || b.transitionIn.duration <= 0) return null
  const a = previousClip(p, b)
  if (!a) return null
  const d = Math.min(b.transitionIn.duration, clipDuration(a), clipDuration(b))
  return { a, b, start: b.start - d / 2, end: b.start + d / 2, type: b.transitionIn.type }
}

/** Time span a clip is visible, including the extra frames it shows during transitions. */
export function visibleSpan(p: Project, c: Clip): [number, number] {
  let s = c.start
  let e = clipEnd(c)
  const into = transitionWindow(p, c)
  if (into) s = into.start
  const next = p.clips.find((x) => x.trackId === c.trackId && x.id !== c.id && Math.abs(x.start - e) < ADJACENT)
  const out = next ? transitionWindow(p, next) : null
  if (out && out.a.id === c.id) e = out.end
  return [s, e]
}

type Active = { kind: 'single'; clip: Clip } | { kind: 'transition'; w: TransitionWindow; progress: number }

function activeOnTrack(p: Project, trackId: string, t: number): Active | null {
  const clips = p.clips.filter((c) => c.trackId === trackId)
  for (const c of clips) {
    const w = transitionWindow(p, c)
    if (w && t >= w.start && t < w.end) return { kind: 'transition', w, progress: (t - w.start) / (w.end - w.start) }
  }
  const c = clips.find((x) => t >= x.start && t < clipEnd(x))
  return c ? { kind: 'single', clip: c } : null
}

/** Media clips whose picture is needed at time t (for decoding ahead / syncing video elements). */
export function neededMedia(p: Project, t: number): Clip[] {
  const out: Clip[] = []
  for (const track of p.tracks) {
    if (track.kind !== 'video' || track.hidden) continue
    const a = activeOnTrack(p, track.id, t)
    const list = !a ? [] : a.kind === 'single' ? [a.clip] : [a.w.a, a.w.b]
    for (const c of list) {
      const m = p.media.find((x) => x.id === c.mediaId)
      if (m && m.kind !== 'audio') out.push(c)
    }
  }
  return out
}

const layers: { canvas: HTMLCanvasElement; ctx: Ctx }[] = []
function layer(i: number, w: number, h: number): { canvas: HTMLCanvasElement; ctx: Ctx } {
  if (!layers[i]) {
    const canvas = document.createElement('canvas')
    layers[i] = { canvas, ctx: canvas.getContext('2d')! }
  }
  const l = layers[i]
  if (l.canvas.width !== w || l.canvas.height !== h) {
    l.canvas.width = w
    l.canvas.height = h
  }
  l.ctx.clearRect(0, 0, w, h)
  return l
}

/** Replace the whole canvas content with a processed version of itself. */
function replaceWith(ctx: Ctx, img: CanvasImageSource, W: number, H: number): void {
  ctx.save()
  ctx.globalCompositeOperation = 'copy'
  ctx.drawImage(img, 0, 0, W, H)
  ctx.restore()
}

function drawClip(ctx: Ctx, p: Project, c: Clip, t: number, W: number, H: number, source: FrameSource): void {
  const k = W / p.width
  const tau = t - c.start
  if (c.effect) {
    replaceWith(ctx, renderEffect(ctx.canvas, W, H, c.effect.type, c.effect.intensity, tau), W, H)
    return
  }
  if (c.adjustment) {
    const proc = gradeIsActive(c.color) ? colorProcessor() : null
    if (proc) replaceWith(ctx, proc.process(ctx.canvas, W, H, c.color!), W, H)
    return
  }
  const pose = poseAt(c, tau, p.width, p.height)
  if (c.text) {
    drawTextClip(ctx, c, c.in + tau, W, H, k, pose)
    return
  }
  const m = p.media.find((x) => x.id === c.mediaId)
  if (!m || m.kind === 'audio') return
  let src = source(c, m, t)
  if (!src) return
  const fit = fitSize(m.width, m.height, p.width, p.height)
  const w = fit.w * pose.scale * k
  const h = fit.h * pose.scale * k
  if (w < 0.5 || h < 0.5 || pose.opacity <= 0) return
  if (gradeIsActive(c.color)) {
    const proc = colorProcessor()
    const sw = (src as HTMLVideoElement).videoWidth || (src as HTMLCanvasElement).width || m.width
    // Process at most at the size it is drawn (cheaper), never larger than the source.
    const pw = Math.max(1, Math.min(sw || w, w, 2560))
    if (proc) src = proc.process(src as TexImageSource, pw, pw * (h / w), c.color!)
  }
  ctx.save()
  ctx.globalAlpha = pose.opacity
  if (pose.blur > 0) ctx.filter = `blur(${(pose.blur * k).toFixed(2)}px)`
  ctx.translate(W / 2 + pose.x * k, H / 2 + pose.y * k)
  ctx.rotate((pose.rotation * Math.PI) / 180)
  ctx.drawImage(src, -w / 2, -h / 2, w, h)
  ctx.restore()
}

/** Draw the frame at time t into ctx (canvas of size W x H). */
export function renderFrame(ctx: Ctx, p: Project, t: number, W: number, H: number, source: FrameSource): void {
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = p.background
  ctx.fillRect(0, 0, W, H)
  ctx.restore()
  const tracks = p.tracks.filter((tr) => tr.kind === 'video' && !tr.hidden).reverse()
  for (const track of tracks) {
    const a = activeOnTrack(p, track.id, t)
    if (!a) continue
    if (a.kind === 'single') {
      drawClip(ctx, p, a.clip, t, W, H, source)
      continue
    }
    const la = layer(0, W, H)
    const lb = layer(1, W, H)
    drawClip(la.ctx, p, a.w.a, t, W, H, source)
    drawClip(lb.ctx, p, a.w.b, t, W, H, source)
    ctx.drawImage(renderTransition(la.canvas, lb.canvas, W, H, a.w.type, a.progress), 0, 0, W, H)
  }
}
