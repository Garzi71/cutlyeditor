// Real-time preview: keeps one <video>/<audio> element per clip near the playhead, keeps them in sync
// with a master clock (speed, ramps, reverse, transition overlaps) and draws frames with the compositor.
import type { Clip, MediaItem, Project } from '@shared/types'
import { clipEnd, projectDuration } from '@shared/types'
import { rateAt, sourceTimeAt, speedOf } from '@shared/timing'
import { volumeAt } from '@shared/motion'
import { toast, useEditor } from '../store'
import { mediaUrl } from '../lib/util'
import { renderFrame, visibleSpan } from './compositor'

interface ClipSource {
  el: HTMLVideoElement | HTMLAudioElement
  gain: GainNode | null
  key: string // media path (or reverse proxy path) the element plays
  /** Noise-reduced copy of the sound, played instead of the element's own audio. */
  clean?: { el: HTMLAudioElement; gain: GainNode | null; key: string }
}

const PRELOAD_WINDOW = 3 // seconds ahead/behind the playhead that elements are kept alive
const DRIFT_PLAYING = 0.25
const MIN_RATE = 0.0625 // HTMLMediaElement limits
const MAX_RATE = 16

// ---------- reversed copies of media (for reverse playback) ----------

const proxies = new Map<string, string | 'pending' | 'error'>()

/** Path of the reversed copy of a media file, starting its creation if needed (null while not ready). */
export function reverseProxy(m: MediaItem): string | null {
  const hit = proxies.get(m.path)
  if (hit && hit !== 'pending' && hit !== 'error') return hit
  if (!hit) {
    proxies.set(m.path, 'pending')
    toast(`Preparing reverse playback of ${m.name}…`, 'info')
    window.api
      .reverseProxy(m.path, m.duration, m.hasAudio)
      .then((p) => {
        proxies.set(m.path, p)
        toast(`Reverse ready: ${m.name}`, 'success')
      })
      .catch((e) => {
        proxies.set(m.path, 'error')
        toast(`Could not reverse ${m.name}: ${(e as Error).message}`, 'error')
      })
  }
  return null
}

// ---------- noise-reduced copies (preview of "Reduce noise") ----------

const cleanAudio = new Map<string, string | 'pending' | 'error'>()

function denoisedCopy(file: string, strength: number): string | null {
  const key = `${file}|${Math.round(strength * 10) / 10}`
  const hit = cleanAudio.get(key)
  if (hit && hit !== 'pending' && hit !== 'error') return hit
  if (!hit) {
    cleanAudio.set(key, 'pending')
    window.api
      .denoisedAudio(file, strength)
      .then((p) => cleanAudio.set(key, p))
      .catch(() => cleanAudio.set(key, 'error'))
  }
  return null
}

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
    for (const s of this.sources.values()) {
      if (!s.el.paused) s.el.pause()
      if (s.clean && !s.clean.el.paused) s.clean.el.pause()
    }
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

  /** Advance the clock, sync media elements and draw one frame. */
  tick(force = false): void {
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
    // Nothing to see while the window is hidden (saves GPU, e.g. during a long export).
    if (document.hidden && !force) return
    if (this.ctx && this.canvas) {
      if (this.canvas.width !== p.width || this.canvas.height !== p.height) {
        this.canvas.width = p.width
        this.canvas.height = p.height
      }
      renderFrame(this.ctx, p, t, p.width, p.height, (c, m) => this.frameOf(c, m))
    }
    if (++this.frame % 60 === 0) this.collect(p, t)
  }

  private frameOf(c: Clip, m: MediaItem): CanvasImageSource | null {
    if (m.kind === 'image') {
      const img = this.image(m)
      return img.complete && img.naturalWidth ? img : null
    }
    const s = this.sources.get(c.id)
    return s && (s.el as HTMLVideoElement).readyState >= 2 ? (s.el as HTMLVideoElement) : null
  }

  private source(c: Clip, m: MediaItem, key: string): ClipSource {
    let s = this.sources.get(c.id)
    if (s && s.key === key) return s
    if (s) this.dispose(c.id)
    const el = m.kind === 'audio' ? new Audio() : document.createElement('video')
    el.crossOrigin = 'anonymous'
    el.preload = 'auto'
    el.preservesPitch = true
    if (el instanceof HTMLVideoElement) el.playsInline = true
    el.src = mediaUrl(key)
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
    s = { el, gain, key }
    this.sources.set(c.id, s)
    return s
  }

  private connect(el: HTMLMediaElement): GainNode | null {
    if (!this.audioCtx) this.audioCtx = new AudioContext()
    try {
      const node = this.audioCtx.createMediaElementSource(el)
      const gain = this.audioCtx.createGain()
      node.connect(gain).connect(this.audioCtx.destination)
      return gain
    } catch {
      return null
    }
  }

  /** Play a noise-reduced copy next to the clip's element (null = use the element's own sound). */
  private cleanSource(s: ClipSource, file: string | null): ClipSource['clean'] {
    if (!file) {
      if (s.clean) this.dropClean(s)
      return undefined
    }
    if (s.clean && s.clean.key === file) return s.clean
    if (s.clean) this.dropClean(s)
    const el = new Audio()
    el.crossOrigin = 'anonymous'
    el.preload = 'auto'
    el.preservesPitch = true
    el.src = mediaUrl(file)
    s.clean = { el, gain: this.connect(el), key: file }
    return s.clean
  }

  private dropClean(s: ClipSource): void {
    if (!s.clean) return
    s.clean.el.pause()
    s.clean.el.removeAttribute('src')
    s.clean.el.load()
    s.clean.gain?.disconnect()
    s.clean = undefined
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
      const m = p.media.find((x) => x.id === c.mediaId)
      if (!m || m.kind === 'image' || c.text || c.adjustment || c.effect) continue
      const track = p.tracks.find((tr) => tr.id === c.trackId)
      const [vs, ve] = m.kind === 'video' && !track?.hidden ? visibleSpan(p, c) : [c.start, clipEnd(c)]
      const near = t >= vs - PRELOAD_WINDOW && t < ve + 0.5
      if (!near) continue

      const sp = speedOf(c)
      let key = m.path
      let reversed = false
      if (sp.reverse) {
        const proxy = reverseProxy(m)
        if (proxy) {
          key = proxy
          reversed = true
        }
      }
      const s = this.source(c, m, key)
      const el = s.el
      const tau = t - c.start
      const audible = t >= c.start && t < clipEnd(c) && !track?.muted
      const vol = audible ? volumeAt(c, tau) : 0
      const cleanFile = c.denoise && (m.kind === 'audio' || m.hasAudio) ? denoisedCopy(key, c.denoise) : null
      const clean = this.cleanSource(s, cleanFile)
      const own = clean ? 0 : vol
      if (s.gain) s.gain.gain.value = own
      else el.volume = Math.min(1, own)
      if (clean) {
        if (clean.gain) clean.gain.gain.value = vol
        else clean.el.volume = Math.min(1, vol)
      }

      const active = t >= vs && t < ve
      if (clean) this.follow(clean.el, el, playing && active)
      if (!active) {
        if (!el.paused) el.pause()
        // Get the first frame ready just before the clip appears.
        const first = this.elementTime(c, m, vs - c.start, reversed)
        if (t < vs && !el.seeking && Math.abs(el.currentTime - first) > 0.05) el.currentTime = first
        continue
      }
      const want = this.elementTime(c, m, tau, reversed)
      // Playing forward through the file at this rate (a reversed proxy also plays forward).
      const rate = sp.reverse && !reversed ? -1 : rateAt(c, tau)
      const smooth = playing && rate >= MIN_RATE && rate <= MAX_RATE && want > 0.02 && want < m.duration - 0.05
      if (smooth) {
        if (Math.abs(el.playbackRate - rate) > 0.01) el.playbackRate = rate
        if (el.paused) {
          if (Math.abs(el.currentTime - want) > 0.05) el.currentTime = want
          el.play().catch(() => {})
        } else if (Math.abs(el.currentTime - want) > DRIFT_PLAYING * Math.max(1, rate)) {
          el.currentTime = want
        }
      } else {
        // Paused, extreme speeds, reverse without its copy, or frozen frames: show the exact frame.
        if (!el.paused) el.pause()
        if (!el.seeking && Math.abs(el.currentTime - want) > 0.5 / p.fps) el.currentTime = want
      }
    }
  }

  /** Keep an audio copy at the same position, speed and play state as the clip's element. */
  private follow(audio: HTMLAudioElement, master: HTMLMediaElement, playing: boolean): void {
    if (Math.abs(audio.playbackRate - master.playbackRate) > 0.01) audio.playbackRate = master.playbackRate
    if (Math.abs(audio.currentTime - master.currentTime) > 0.12) audio.currentTime = master.currentTime
    if (playing && !master.paused && audio.paused) audio.play().catch(() => {})
    if ((!playing || master.paused) && !audio.paused) audio.pause()
  }

  /** Position in the element's file for clip time tau (frozen at the media's ends). */
  private elementTime(c: Clip, m: MediaItem, tau: number, reversedFile: boolean): number {
    const src = Math.min(Math.max(0, sourceTimeAt(c, tau)), Math.max(0, m.duration - 0.04))
    return reversedFile ? Math.max(0, m.duration - src) : src
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
    this.dropClean(s)
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
