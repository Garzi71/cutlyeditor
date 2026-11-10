// Data model shared by the main process (export) and the renderer (UI).
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

export interface Clip {
  id: string
  trackId: string
  /** Empty for text clips. */
  mediaId: string
  text?: TextData
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

export type ClipKind = MediaKind | 'text'

export function clipKind(p: Project, c: Clip): ClipKind | null {
  if (c.text) return 'text'
  return p.media.find((m) => m.id === c.mediaId)?.kind ?? null
}

export const clipDuration = (c: Clip): number => c.out - c.in
export const clipEnd = (c: Clip): number => c.start + c.out - c.in

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
  /** Pre-rendered text, one transparent PNG sequence per video track (rendered by the UI). */
  textLayers?: TextLayer[]
}

export interface TextLayer {
  trackId: string
  segments: { png: string; duration: number }[]
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

export interface RecentProject {
  path: string
  name: string
  openedAt: number
}
