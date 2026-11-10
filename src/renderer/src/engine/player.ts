// Real-time preview: keeps one <video>/<audio> element per clip near the playhead,
// keeps them in sync with a master clock and composites the frame onto a canvas.
import type { Clip, MediaItem, Project } from '@shared/types'
import { clipEnd, fitSize, projectDuration } from '@shared/types'
import { useEditor } from '../store'
import { mediaUrl } from '../lib/util'

interface ClipSource {
  el: HTMLVideoElement | HTMLAudioElement
  gain: GainNode | null
  mediaId: string
}

const PRELOAD_WINDOW = 3 // seconds ahead/behind the playhead that elements are kept alive
const DRIFT_PLAYING = 0.25

class Player {
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private sources = new Map<string, ClipSource>()
  private images = new Map<string, HTMLImageElement>()
  private audioCtx: AudioContext | null = null
  private clockStart = 0 // timeline time when playback started
  private clockT0 = 0 // performance.now() when playback started
  private raf = 0
  private frame = 0

  constructor() {
    const loop = (): void => {
      this.tick()
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
  }

  attach(canvas: HTMLCanvasElement | null): void {
    this.canvas = canvas
    this.ctx = canvas ? canvas.getContext('2d', { alpha: false }) : null
  }

  // ---------- transport ----------

  get time(): number {
    return useEditor.getState().playhead
  }

  play(): void {
    const st = useEditor.getState()
    if (!st.project) return
    const dur = projectDuration(st.project)
    if (dur <= 0) return
    let t = st.playhead
    if (t >= dur - 0.02) t = 0
    if (!this.audioCtx) this.audioCtx = new AudioContext()
    this.audioCtx.resume().catch(() => {})
    this.clockStart = t
    this.clockT0 = performance.now()
    useEditor.setState({ playhead: t, playing: true })
  }

  pause(): void {
    useEditor.setState({ playing: false })
    for (const s of this.sources.values()) if (!s.el.paused) s.el.pause()
  }

  toggle(): void {
    if (useEditor.getState().playing) this.pause()
    else this.play()
  }

  seek(t: number): void {
    const st = useEditor.getState()
    const max = st.project ? Math.max(0, projectDuration(st.project)) : 0
    const nt = Math.max(0, Math.min(t, Math.max(max, 0)))
    this.clockStart = nt
    this.clockT0 = performance.now()
    useEditor.setState({ playhead: nt })
  }

  step(frames: number): void {
    const st = useEditor.getState()
    if (!st.project) return
    this.pause()
    this.seek(Math.round((st.playhead + frames / st.project.fps) * st.project.fps) / st.project.fps)
  }

  // ---------- main loop ----------

  private tick(): void {
    const st = useEditor.getState()
    const p = st.project
    if (!p) {
      if (this.sources.size) this.disposeAll()
      return
    }
    let t = st.playhead
    if (st.playing) {
      t = this.clockStart + (performance.now() - this.clockT0) / 1000
      const dur = projectDuration(p)
      if (t >= dur) {
        t = dur
        useEditor.setState({ playhead: t })
        this.pause()
      } else {
        useEditor.setState({ playhead: t })
      }
    }
    this.syncSources(p, t, st.playing)
    this.draw(p, t)
    if (++this.frame % 60 === 0) this.collect(p, t)
  }

  private mediaOf(p: Project, c: Clip): MediaItem | undefined {
    return p.media.find((m) => m.id === c.mediaId)
  }

  private source(c: Clip, m: MediaItem): ClipSource {
    let s = this.sources.get(c.id)
    if (s && s.mediaId === m.id) return s
    if (s) this.dispose(c.id)
    const el = m.kind === 'audio' ? new Audio() : document.createElement('video')
    el.crossOrigin = 'anonymous'
    el.preload = 'auto'
    if (el instanceof HTMLVideoElement) el.playsInline = true
    el.src = mediaUrl(m.path)
    el.currentTime = c.in
    let gain: GainNode | null = null
    if (!this.audioCtx) this.audioCtx = new AudioContext()
    if (m.kind === 'audio' || m.hasAudio) {
      try {
        const node = this.audioCtx.createMediaElementSource(el)
        gain = this.audioCtx.createGain()
        node.connect(gain).connect(this.audioCtx.destination)
      } catch {
        gain = null
      }
    }
    s = { el, gain, mediaId: m.id }
    this.sources.set(c.id, s)
    return s
  }

  private image(m: MediaItem): HTMLImageElement {
    let img = this.images.get(m.id)
    if (!img) {
      img = new Image()
      img.crossOrigin = 'anonymous'
      img.src = mediaUrl(m.path)
      this.images.set(m.id, img)
    }
    return img
  }

  private syncSources(p: Project, t: number, playing: boolean): void {
    for (const c of p.clips) {
      const m = this.mediaOf(p, c)
      if (!m || m.kind === 'image') continue
      const end = clipEnd(c)
      const near = t >= c.start - PRELOAD_WINDOW && t < end + 0.5
      if (!near) continue
      const s = this.source(c, m)
      const el = s.el
      const track = p.tracks.find((tr) => tr.id === c.trackId)
      const active = t >= c.start && t < end
      const audible = !track?.muted && c.volume > 0
      if (s.gain) s.gain.gain.value = audible ? c.volume : 0
      else el.volume = audible ? Math.min(1, c.volume) : 0

      if (active) {
        const want = c.in + (t - c.start)
        if (playing) {
          if (el.paused) {
            if (Math.abs(el.currentTime - want) > 0.05) el.currentTime = want
            el.play().catch(() => {})
          } else if (Math.abs(el.currentTime - want) > DRIFT_PLAYING) {
            el.currentTime = want
          }
        } else {
          if (!el.paused) el.pause()
          if (!el.seeking && Math.abs(el.currentTime - want) > 0.5 / p.fps) el.currentTime = want
        }
      } else {
        if (!el.paused) el.pause()
        // Get the first frame ready just before the clip starts.
        if (t < c.start && !el.seeking && Math.abs(el.currentTime - c.in) > 0.05) el.currentTime = c.in
      }
    }
  }

  private draw(p: Project, t: number): void {
    const canvas = this.canvas
    const ctx = this.ctx
    if (!canvas || !ctx) return
    if (canvas.width !== p.width || canvas.height !== p.height) {
      canvas.width = p.width
      canvas.height = p.height
    }
    ctx.fillStyle = p.background
    ctx.fillRect(0, 0, p.width, p.height)
    const videoTracks = p.tracks.filter((tr) => tr.kind === 'video' && !tr.hidden).reverse()
    for (const track of videoTracks) {
      for (const c of p.clips) {
        if (c.trackId !== track.id || t < c.start || t >= clipEnd(c)) continue
        const m = this.mediaOf(p, c)
        if (!m || m.kind === 'audio') continue
        let src: CanvasImageSource | null = null
        if (m.kind === 'image') {
          const img = this.image(m)
          if (img.complete && img.naturalWidth) src = img
        } else {
          const s = this.sources.get(c.id)
          if (s && (s.el as HTMLVideoElement).readyState >= 2) src = s.el as HTMLVideoElement
        }
        if (!src) continue
        const tr = c.transform
        const fit = fitSize(m.width, m.height, p.width, p.height)
        const w = fit.w * tr.scale
        const h = fit.h * tr.scale
        ctx.save()
        ctx.globalAlpha = tr.opacity
        ctx.translate(p.width / 2 + tr.x, p.height / 2 + tr.y)
        ctx.rotate((tr.rotation * Math.PI) / 180)
        ctx.drawImage(src, -w / 2, -h / 2, w, h)
        ctx.restore()
      }
    }
  }

  /** Free elements of clips that are far from the playhead or were deleted. */
  private collect(p: Project, t: number): void {
    const byId = new Map(p.clips.map((c) => [c.id, c]))
    for (const id of [...this.sources.keys()]) {
      const c = byId.get(id)
      if (!c || t < c.start - PRELOAD_WINDOW * 2 || t > clipEnd(c) + PRELOAD_WINDOW * 2) this.dispose(id)
    }
    const mediaIds = new Set(p.media.map((m) => m.id))
    for (const id of [...this.images.keys()]) if (!mediaIds.has(id)) this.images.delete(id)
  }

  private dispose(id: string): void {
    const s = this.sources.get(id)
    if (!s) return
    s.el.pause()
    s.el.removeAttribute('src')
    s.el.load()
    s.gain?.disconnect()
    this.sources.delete(id)
  }

  private disposeAll(): void {
    for (const id of [...this.sources.keys()]) this.dispose(id)
    this.images.clear()
  }
}

export const player = new Player()
