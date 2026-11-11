// Export loop: every output frame is drawn by the same compositor as the preview, with source frames
// decoded by ffmpeg in the main process, then streamed to the encoder.
import type { Clip, ExportSettings, FrameRequest, MediaItem, Project } from '@shared/types'
import { fitSize, projectDuration } from '@shared/types'
import { sourceTimeAt, speedOf } from '@shared/timing'
import { maxScale } from '@shared/motion'
import { neededMedia, renderFrame, visibleSpan } from './compositor'
import { ensureFont } from '../lib/fonts'

export interface ExportProgressInfo {
  percent: number
  fps: number
  etaSeconds?: number
}

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2)

interface ClipFrames {
  req: FrameRequest
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  image: ImageData
  end: number // timeline time after which the clip is no longer needed
}

export async function runExport(
  project: Project,
  settings: ExportSettings,
  onProgress: (p: ExportProgressInfo) => void,
  isCancelled: () => boolean
): Promise<void> {
  const W = settings.width
  const H = settings.height
  const fps = settings.fps
  const total = projectDuration(project)
  const frames = Math.max(1, Math.round(total * fps))
  // The project is drawn at its own shape (RW x RH). If the output has another shape (e.g. a 16:9
  // project exported for TikTok), it is then cropped / fitted into W x H.
  const sameShape = Math.abs(W / H - project.width / project.height) < 0.01
  const fit = settings.fit ?? 'blur'
  const sc = sameShape ? W / project.width : fit === 'crop' ? Math.max(W / project.width, H / project.height) : Math.min(W / project.width, H / project.height)
  const RW = sameShape ? W : even(project.width * sc)
  const RH = sameShape ? H : even(project.height * sc)
  const k = RW / project.width

  // Fonts must be loaded before text is drawn into an export frame.
  await Promise.all(
    project.clips.filter((c) => c.text).map((c) => ensureFont(c.text!.style.font, c.text!.style.weight, c.text!.style.italic))
  )

  await window.api.exportBegin(project, settings)
  const reversed = new Map<string, string>()
  const clipFrames = new Map<string, ClipFrames>()
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const scene = sameShape ? canvas : document.createElement('canvas')
  scene.width = RW
  scene.height = RH
  const sctx = sameShape ? ctx : scene.getContext('2d')!

  const fileTime = (c: Clip, m: MediaItem, t: number): number => {
    const src = Math.min(Math.max(0, sourceTimeAt(c, t - c.start)), Math.max(0, m.duration - 0.02))
    return speedOf(c).reverse ? Math.max(0, m.duration - src) : src
  }

  const setup = async (c: Clip, m: MediaItem): Promise<ClipFrames> => {
    const fit = fitSize(m.width, m.height, project.width, project.height)
    const s = maxScale(c)
    const w = even(Math.min(m.width || fit.w * s * k, fit.w * s * k))
    const h = even(Math.min(m.height || fit.h * s * k, fit.h * s * k))
    const [vs, ve] = visibleSpan(project, c)
    let path = m.path
    const sp = speedOf(c)
    if (m.kind === 'video' && sp.reverse) {
      if (!reversed.has(m.path)) reversed.set(m.path, await window.api.reverseProxy(m.path, m.duration, m.hasAudio))
      path = reversed.get(m.path)!
    }
    // Constant speed >= 1: output frames land exactly on a step of rate/fps, so decode only those.
    // Ramps and slow motion: decode every source frame and pick the one on screen, like the preview.
    const srcStep = 1 / Math.max(1, m.fps || fps)
    const step = !sp.curve?.length && sp.rate >= 1 ? Math.max(sp.rate / fps, srcStep) : srcStep
    const req: FrameRequest = {
      key: c.id,
      kind: m.kind === 'image' ? 'image' : 'video',
      path,
      start: m.kind === 'image' ? 0 : fileTime(c, m, vs),
      step,
      w,
      h
    }
    const fc = document.createElement('canvas')
    fc.width = w
    fc.height = h
    const fctx = fc.getContext('2d')!
    return { req, canvas: fc, ctx: fctx, image: fctx.createImageData(w, h), end: ve }
  }

  const started = performance.now()
  try {
    for (let f = 0; f < frames; f++) {
      if (isCancelled()) throw new Error('cancelled')
      const t = f / fps
      const needed = neededMedia(project, t)
      await Promise.all(
        needed.map(async (c) => {
          const m = project.media.find((x) => x.id === c.mediaId)!
          let cf = clipFrames.get(c.id)
          if (!cf) {
            cf = await setup(c, m)
            clipFrames.set(c.id, cf)
          }
          const data = await window.api.exportFrame(cf.req, m.kind === 'image' ? 0 : fileTime(c, m, t))
          if (data && data.length === cf.image.data.length) {
            cf.image.data.set(data)
            cf.ctx.putImageData(cf.image, 0, 0)
          }
        })
      )
      // Free decoders of clips that are over.
      for (const [id, cf] of clipFrames) {
        if (t > cf.end + 0.5) {
          window.api.exportRelease(id)
          clipFrames.delete(id)
        }
      }
      renderFrame(sctx, project, t, RW, RH, (c) => clipFrames.get(c.id)?.canvas ?? null)
      if (!sameShape) placeScene(ctx, scene, W, H, fit)
      const px = ctx.getImageData(0, 0, W, H).data
      await window.api.exportWrite(new Uint8Array(px.buffer, px.byteOffset, px.byteLength))
      if (f % 5 === 0 || f === frames - 1) {
        const elapsed = (performance.now() - started) / 1000
        const rate = (f + 1) / Math.max(0.001, elapsed)
        onProgress({ percent: ((f + 1) / frames) * 100, fps: rate, etaSeconds: (frames - f - 1) / rate })
      }
    }
    await window.api.exportFinish()
  } catch (e) {
    await window.api.cancelExport()
    throw e
  }
}

/** Put the project-shaped frame into an output of another shape. */
function placeScene(ctx: CanvasRenderingContext2D, scene: HTMLCanvasElement, W: number, H: number, fit: 'crop' | 'blur' | 'bars'): void {
  const cover = Math.max(W / scene.width, H / scene.height)
  const contain = Math.min(W / scene.width, H / scene.height)
  const draw = (s: number): void => {
    const w = scene.width * s
    const h = scene.height * s
    ctx.drawImage(scene, (W - w) / 2, (H - h) / 2, w, h)
  }
  ctx.save()
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  if (fit === 'crop') {
    draw(cover)
  } else {
    if (fit === 'blur') {
      // Same picture, zoomed to fill, blurred and a little darker behind the real one (TikTok style).
      ctx.filter = `blur(${Math.round(Math.max(W, H) / 40)}px) brightness(0.75)`
      draw(cover * 1.1)
      ctx.filter = 'none'
    }
    draw(contain)
  }
  ctx.restore()
}
