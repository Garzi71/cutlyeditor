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

export interface Clip {
  id: string
  trackId: string
  mediaId: string
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
