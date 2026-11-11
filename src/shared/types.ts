// Data model shared by the main process (export) and the renderer (UI).
import { timelineDuration } from './timing'
// Times are always in seconds.

export type MediaKind = 'video' | 'audio' | 'image'

export interface MediaItem {
  id: string
  path: string
  name: string
  kind: MediaKind
  duration: number // 0 for images (unlimited)
  width: number
  height: number
  fps: number
  hasAudio: boolean
  size: number
}

/** Generated on the fly (cached on disk), never saved inside the project file. */
export interface MediaAssets {
  /** Thumbnail image paths; thumbnail i shows time duration * (i + 0.5) / count. */
  thumbnails: string[]
  /** Audio peaks, PEAKS_PER_SECOND values per second, 0..1 */
  peaks?: number[]
  loading: boolean
}

export const PEAKS_PER_SECOND = 50

export type TrackKind = 'video' | 'audio'

export interface Track {
  id: string
  kind: TrackKind
  muted: boolean
  hidden: boolean
  locked: boolean
}

export interface Transform {
  x: number // offset from the centre, in project pixels
  y: number
  scale: number // 1 = fit inside the frame
  rotation: number // degrees
  opacity: number // 0..1
}

export interface TextStyle {
  font: string
  size: number // project pixels
  weight: number
  italic: boolean
  uppercase: boolean
  color: string
  align: 'left' | 'center' | 'right'
  stroke: string
  strokeWidth: number // project pixels, 0 = none
  shadow: boolean
  background: string
  backgroundOpacity: number // 0 = no box
  highlight: string // colour of the word being spoken (captions)
  maxWidth: number // fraction of the frame width used for wrapping
}

/** A spoken word; times are in the clip's own time (same scale as clip.in / clip.out). */
export interface Word {
  text: string
  start: number
  end: number
}

export interface TextData {
  content: string
  style: TextStyle
  words?: Word[]
  caption?: boolean // created by auto captions
}

// ---------- color ----------

export const HSL_BANDS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const
export type HslBand = (typeof HSL_BANDS)[number]

/** Curve points [x, y] in 0..1, sorted by x, always including x = 0 and x = 1. */
export type CurvePoints = [number, number][]

export interface ColorAdjust {
  exposure: number // stops, -2..2
  contrast: number // -100..100 (the rest too)
  highlights: number
  shadows: number
  whites: number
  blacks: number
  temperature: number
  tint: number
  saturation: number
  vibrance: number
  sharpen: number // 0..100
  vignette: number // 0..100
}

export interface ColorGrade {
  adjust: ColorAdjust
  curves?: { master: CurvePoints; r: CurvePoints; g: CurvePoints; b: CurvePoints }
  hsl?: Partial<Record<HslBand, { h: number; s: number; l: number }>> // -100..100
  filter?: { id: string; intensity: number } // 0..1
  lut?: { path: string; name: string; intensity: number }
  /** Per-channel gain/offset from "match colors" (applied first). */
  match?: { gain: [number, number, number]; offset: [number, number, number]; ref: string }
}

// ---------- motion ----------

export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'hold'

/** `t` = seconds from the clip's start on the timeline. */
export interface Keyframe {
  t: number
  v: number
  ease: Easing
}

export const ANIM_PROPS = ['x', 'y', 'scale', 'rotation', 'opacity', 'volume'] as const
export type AnimProp = (typeof ANIM_PROPS)[number]

export interface SpeedSettings {
  rate: number // constant speed (ignored while a curve is set)
  /** Speed ramp: [progress 0..1 through the played source, speed multiplier]. */
  curve?: [number, number][]
  curveName?: string
  reverse?: boolean
}

export const TRANSITIONS = [
  'dissolve', 'dipBlack', 'dipWhite', 'pushLeft', 'pushRight', 'pushUp', 'pushDown',
  'wipeLeft', 'wipeRight', 'wipeUp', 'wipeDown', 'zoom', 'blur', 'circle', 'spin'
] as const
export type TransitionType = (typeof TRANSITIONS)[number]

export const CLIP_ANIMS = ['fade', 'zoomIn', 'zoomOut', 'slideLeft', 'slideRight', 'slideUp', 'slideDown', 'pop', 'spin', 'blur', 'typewriter'] as const
export type ClipAnimType = (typeof CLIP_ANIMS)[number]

export const EFFECTS = ['blur', 'shake', 'glitch', 'flash', 'vhs', 'grain', 'rgbSplit', 'mirror', 'zoomPulse', 'pixelate'] as const
export type EffectType = (typeof EFFECTS)[number]

export interface Clip {
  id: string
  trackId: string
  /** Empty for text clips, adjustment and effect layers. */
  mediaId: string
  text?: TextData
  /** Adjustment layer: colors everything below it on the timeline while it is active. */
  adjustment?: boolean
  /** Effect layer: applies a video effect to everything below it while active. */
  effect?: { type: EffectType; intensity: number } // 0..1
  color?: ColorGrade
  speed?: SpeedSettings
  keyframes?: Partial<Record<AnimProp, Keyframe[]>>
  /** Transition from the previous clip on the same track (which must end where this one starts). */
  transitionIn?: { type: TransitionType; duration: number }
  animIn?: { type: ClipAnimType; duration: number }
  animOut?: { type: ClipAnimType; duration: number }
  /** Remove the background behind people (AI matting). */
  removeBg?: boolean
  /** Noise reduction strength 0..1 (RNNoise). */
  denoise?: number
  /** Audio fades in seconds. */
  fadeIn?: number
  fadeOut?: number
  start: number // position on the timeline
  in: number // start inside the source media
  out: number // end inside the source media
  volume: number // 0..2
  transform: Transform
}

export interface Project {
  version: 1
  name: string
  width: number
  height: number
  fps: number
  background: string
  media: MediaItem[]
  tracks: Track[]
  clips: Clip[]
}

export type ClipKind = MediaKind | 'text' | 'adjustment' | 'effect'

/** Clips that are not backed by a media file. */
export const isGenerated = (c: Clip): boolean => !!c.text || !!c.adjustment || !!c.effect

const evenPx = (n: number): number => Math.max(2, Math.round(n / 2) * 2)

/** Pixel size a media clip is scaled to in an export of width W (before rotation). Shared by UI and exporter. */
export function clipOutputSize(p: Project, m: MediaItem, c: Clip, W: number): { w: number; h: number } {
  const k = W / p.width
  const fit = fitSize(m.width, m.height, p.width, p.height)
  return { w: evenPx(fit.w * c.transform.scale * k), h: evenPx(fit.h * c.transform.scale * k) }
}

export function clipKind(p: Project, c: Clip): ClipKind | null {
  if (c.effect) return 'effect'
  if (c.adjustment) return 'adjustment'
  if (c.text) return 'text'
  return p.media.find((m) => m.id === c.mediaId)?.kind ?? null
}

/** Duration on the timeline (takes speed into account). */
export const clipDuration = (c: Clip): number => timelineDuration(c)
export const clipEnd = (c: Clip): number => c.start + timelineDuration(c)

export function projectDuration(p: Project): number {
  return p.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0)
}

/** Size of the media drawn "contain" inside the frame, before the clip's own scale. */
export function fitSize(mw: number, mh: number, fw: number, fh: number): { w: number; h: number } {
  if (!mw || !mh) return { w: fw, h: fh }
  const s = Math.min(fw / mw, fh / mh)
  return { w: mw * s, h: mh * s }
}

export interface ExportSettings {
  outputPath: string
  width: number
  height: number
  fps: number
  codec: 'h264' | 'hevc'
  quality: 'high' | 'medium' | 'low'
  useGpu: boolean
  /** When the output shape differs from the project: crop to fill, blurred background, or black bars. */
  fit?: 'crop' | 'blur' | 'bars'
}

/** The export asks the main process for source frames of a clip with this. */
export interface FrameRequest {
  key: string // one decoder per key
  kind: 'video' | 'image'
  path: string // media file, or its reversed copy
  start: number // first source time to decode (seconds in `path`)
  step: number // source seconds between decoded frames
  w: number
  h: number
}

// ---------- speech to text ----------

export interface WhisperStatus {
  cpuEngine: boolean
  gpuEngine: boolean
  model: boolean
  nvidia: boolean
  sizes: { cpu: number; gpu: number; model: number }
}

export interface WhisperProgress {
  stage: 'download' | 'audio' | 'transcribe' | 'done' | 'error'
  label?: string
  percent: number
  error?: string
}

export interface TranscribeOptions {
  language: string // 'auto' or ISO code
  useGpu: boolean
}

export interface ExportProgress {
  percent: number
  fps?: number
  etaSeconds?: number
  done?: boolean
  error?: string
  cancelled?: boolean
}

export interface SystemInfo {
  ffmpegOk: boolean
  ffmpegVersion: string
  nvenc: boolean
}

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error'
  currentVersion: string
  version?: string
  notes?: string
  percent?: number
  error?: string
}

/** A reusable project: media clips point at numbered slots that the user fills with their own files. */
export interface Template {
  version: 1
  name: string
  description: string
  width: number
  height: number
  fps: number
  background: string
  slots: { id: string; kind: 'video' | 'image' | 'any'; label: string }[]
  tracks: Track[]
  clips: Clip[] // media clips use a slot id as mediaId
}

export interface TemplateInfo {
  path: string | null // null for built-in templates
  template: Template
}

export interface RecentProject {
  path: string
  name: string
  openedAt: number
}
