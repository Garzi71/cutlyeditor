// Central app state (zustand) + all editing operations.
// Every change to the project goes through `commit`, which records undo history.
import { create } from 'zustand'
import { produce, type Draft } from 'immer'
import type { Clip, MediaAssets, MediaItem, Project, TextData, TextStyle, Track, TrackKind } from '@shared/types'
import { clipEnd } from '@shared/types'
import { uid } from './lib/util'

type Recipe = (d: Draft<Project>) => void

export interface Toast {
  id: string
  kind: 'info' | 'error' | 'success'
  text: string
}

interface EditorState {
  project: Project | null
  projectPath: string | null
  dirty: boolean
  past: Project[]
  future: Project[]
  lastKey: string | null
  lastTime: number

  assets: Record<string, MediaAssets>
  selection: string[]
  playhead: number
  playing: boolean
  pxPerSec: number
  snapping: boolean
  importing: number
  toasts: Toast[]
  exportOpen: boolean
}

export const useEditor = create<EditorState>(() => ({
  project: null,
  projectPath: null,
  dirty: false,
  past: [],
  future: [],
  lastKey: null,
  lastTime: 0,
  assets: {},
  selection: [],
  playhead: 0,
  playing: false,
  pxPerSec: 60,
  snapping: true,
  importing: 0,
  toasts: [],
  exportOpen: false
}))

const get = useEditor.getState
const set = useEditor.setState

// ---------------- history ----------------

/**
 * Apply a change to the project. Changes with the same `key` made within a short time
 * (e.g. while dragging a slider or a clip) are merged into one undo step.
 */
export function commit(recipe: Recipe, key?: string): void {
  const { project, past, lastKey, lastTime } = get()
  if (!project) return
  const next = produce(project, recipe)
  if (next === project) return
  const now = performance.now()
  const merge = !!key && key === lastKey && now - lastTime < 1500
  set({
    project: next,
    past: merge ? past : [...past.slice(-199), project],
    future: [],
    dirty: true,
    lastKey: key ?? null,
    lastTime: now
  })
}

export function undo(): void {
  const { past, project, future } = get()
  if (!past.length || !project) return
  set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future], dirty: true, lastKey: null })
  cleanSelection()
}

export function redo(): void {
  const { past, project, future } = get()
  if (!future.length || !project) return
  set({ project: future[0], future: future.slice(1), past: [...past, project], dirty: true, lastKey: null })
  cleanSelection()
}

function cleanSelection(): void {
  const { project, selection } = get()
  if (!project) return
  const ids = new Set(project.clips.map((c) => c.id))
  set({ selection: selection.filter((id) => ids.has(id)) })
}

// ---------------- toasts ----------------

export function toast(text: string, kind: Toast['kind'] = 'info'): void {
  const t = { id: uid(), kind, text }
  set({ toasts: [...get().toasts, t] })
  setTimeout(() => set({ toasts: get().toasts.filter((x) => x.id !== t.id) }), kind === 'error' ? 7000 : 3500)
}

// ---------------- project lifecycle ----------------

export function newProject(name: string, width: number, height: number, fps: number): void {
  const project: Project = {
    version: 1,
    name,
    width,
    height,
    fps,
    background: '#000000',
    media: [],
    tracks: [
      { id: uid(), kind: 'video', muted: false, hidden: false, locked: false },
      { id: uid(), kind: 'audio', muted: false, hidden: false, locked: false }
    ],
    clips: []
  }
  openProjectState(project, null)
}

export function openProjectState(project: Project, path: string | null): void {
  set({
    project,
    projectPath: path,
    dirty: false,
    past: [],
    future: [],
    lastKey: null,
    selection: [],
    playhead: 0,
    playing: false,
    assets: {}
  })
  for (const m of project.media) loadAssets(m)
}

export function closeProject(): void {
  set({ project: null, projectPath: null, dirty: false, past: [], future: [], selection: [], playing: false })
}

export async function saveProject(saveAs = false): Promise<boolean> {
  const { project, projectPath } = get()
  if (!project) return false
  try {
    const path = await window.api.saveProject(project, projectPath, saveAs)
    if (!path) return false
    set({ projectPath: path, dirty: false })
    toast('Project saved', 'success')
    return true
  } catch (e) {
    toast(`Could not save: ${(e as Error).message}`, 'error')
    return false
  }
}

export async function openProjectFile(path?: string): Promise<void> {
  try {
    const r = await window.api.openProject(path)
    if (r) openProjectState(r.project, r.path)
  } catch (e) {
    toast(`Could not open project: ${(e as Error).message}`, 'error')
  }
}

// ---------------- media ----------------

export function loadAssets(m: MediaItem): void {
  set({ assets: { ...get().assets, [m.id]: { thumbnails: [], loading: true } } })
  const thumbs = window.api.thumbnails(m.path, m.kind, m.duration).catch(() => [] as string[])
  const peaks =
    m.kind === 'audio' || (m.kind === 'video' && m.hasAudio)
      ? window.api.peaks(m.path).catch(() => undefined)
      : Promise.resolve(undefined)
  Promise.all([thumbs, peaks]).then(([thumbnails, pk]) => {
    set({ assets: { ...get().assets, [m.id]: { thumbnails, peaks: pk, loading: false } } })
  })
}

export async function importPaths(paths: string[]): Promise<MediaItem[]> {
  const out: MediaItem[] = []
  set({ importing: get().importing + paths.length })
  for (const path of paths) {
    try {
      const existing = get().project?.media.find((m) => m.path.toLowerCase() === path.toLowerCase())
      if (existing) {
        out.push(existing)
        continue
      }
      const info = await window.api.probe(path)
      const item: MediaItem = { ...info, id: uid() }
      commit((d) => {
        d.media.push(item)
      })
      loadAssets(item)
      out.push(item)
    } catch (e) {
      const reason = (e as Error).message
        .replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
        .split('\n')[0]
        .split(': ')
        .pop()
      toast(`Can't import ${path.split(/[\\/]/).pop()}: ${reason}`, 'error')
    } finally {
      set({ importing: get().importing - 1 })
    }
  }
  return out
}

export function removeMedia(mediaId: string): void {
  commit((d) => {
    d.media = d.media.filter((m) => m.id !== mediaId)
    d.clips = d.clips.filter((c) => c.mediaId !== mediaId)
    pruneTracks(d)
  })
  cleanSelection()
}

// ---------------- tracks ----------------

/** Display order: all video tracks (top to bottom), then all audio tracks. */
export function orderedTracks(p: Project | Draft<Project>): Track[] {
  return [...p.tracks.filter((t) => t.kind === 'video'), ...p.tracks.filter((t) => t.kind === 'audio')] as Track[]
}

/** The main track is the bottom video track (like CapCut) / the first audio track. */
export function mainTrack(p: Project | Draft<Project>, kind: TrackKind): Track | undefined {
  const list = p.tracks.filter((t) => t.kind === kind) as Track[]
  return kind === 'video' ? list[list.length - 1] : list[0]
}

export function trackKindFor(m: MediaItem): TrackKind {
  return m.kind === 'audio' ? 'audio' : 'video'
}

export function insertTrack(d: Draft<Project>, kind: TrackKind, relativeTo?: string, where: 'above' | 'below' = 'above'): Track {
  const t: Track = { id: uid(), kind, muted: false, hidden: false, locked: false }
  let idx = relativeTo ? d.tracks.findIndex((x) => x.id === relativeTo) : -1
  if (idx === -1) {
    // New video tracks go on top of the video group, new audio tracks at the bottom.
    idx = kind === 'video' ? d.tracks.findIndex((x) => x.kind === 'video') : d.tracks.length
    if (idx === -1) idx = 0
    d.tracks.splice(idx, 0, t)
  } else {
    d.tracks.splice(where === 'above' ? idx : idx + 1, 0, t)
  }
  return t
}

/** Remove empty tracks, but always keep at least one video and one audio track. */
export function pruneTracks(d: Draft<Project>): void {
  const used = new Set(d.clips.map((c) => c.trackId))
  for (const kind of ['video', 'audio'] as const) {
    const ofKind = d.tracks.filter((t) => t.kind === kind)
    const empty = ofKind.filter((t) => !used.has(t.id))
    const keepOne = empty.length === ofKind.length ? (kind === 'video' ? empty[empty.length - 1] : empty[0]) : null
    const remove = new Set(empty.filter((t) => t !== keepOne).map((t) => t.id))
    d.tracks = d.tracks.filter((t) => !remove.has(t.id))
  }
}

export function toggleTrack(trackId: string, flag: 'muted' | 'hidden' | 'locked'): void {
  commit((d) => {
    const t = d.tracks.find((x) => x.id === trackId)
    if (t) t[flag] = !t[flag]
  })
}

// ---------------- clips ----------------

export function overlaps(clips: Clip[], trackId: string, start: number, end: number, ignoreId?: string): boolean {
  return clips.some((c) => c.trackId === trackId && c.id !== ignoreId && c.start < end - 1e-4 && clipEnd(c) > start + 1e-4)
}

/** Closest start time to `desired` where a clip of length `dur` fits on the track without overlapping. */
export function findFreeStart(clips: Clip[], trackId: string, desired: number, dur: number, ignoreId?: string): number {
  const others = clips.filter((c) => c.trackId === trackId && c.id !== ignoreId)
  const candidates = [Math.max(0, desired)]
  for (const o of others) candidates.push(clipEnd(o), o.start - dur)
  let best = Infinity
  let bestDist = Infinity
  for (const c of candidates) {
    if (c < 0) continue
    if (overlaps(others, trackId, c, c + dur)) continue
    const dist = Math.abs(c - desired)
    if (dist < bestDist) {
      best = c
      bestDist = dist
    }
  }
  return best === Infinity ? Math.max(0, desired) : best
}

export const IMAGE_DEFAULT_DURATION = 5

export function defaultTransform(): Clip['transform'] {
  return { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }
}

/**
 * Put a media item on the timeline.
 * - with `trackId`: on that track, or on a new track next to it if it doesn't fit
 * - without: on the first track of the right kind that has room, else a new track
 */
export function addClip(mediaId: string, opts: { start?: number; trackId?: string; newTrack?: boolean } = {}): void {
  const { project, playhead } = get()
  if (!project) return
  const m = project.media.find((x) => x.id === mediaId)
  if (!m) return
  const kind = trackKindFor(m)
  const dur = m.kind === 'image' ? IMAGE_DEFAULT_DURATION : m.duration
  const start = Math.max(0, opts.start ?? playhead)
  const id = uid()

  commit((d) => {
    let target: Track | undefined
    const requested = opts.trackId ? d.tracks.find((t) => t.id === opts.trackId) : undefined
    if (opts.newTrack) {
      target = insertTrack(d, kind, requested?.kind === kind ? requested.id : undefined, kind === 'video' ? 'above' : 'below')
    } else if (requested && requested.kind === kind) {
      target = overlaps(d.clips as Clip[], requested.id, start, start + dur)
        ? insertTrack(d, kind, requested.id, kind === 'video' ? 'above' : 'below')
        : (requested as Track)
    } else {
      const candidates = [mainTrack(d, kind), ...orderedTracks(d).filter((t) => t.kind === kind)].filter(Boolean) as Track[]
      target = candidates.find((t) => !t.locked && !overlaps(d.clips as Clip[], t.id, start, start + dur))
      if (!target) target = insertTrack(d, kind)
    }
    d.clips.push({
      id,
      trackId: target.id,
      mediaId,
      start,
      in: 0,
      out: dur,
      volume: 1,
      transform: defaultTransform()
    })
  })
  set({ selection: [id] })
}

// ---------------- text ----------------

export const TEXT_DEFAULT_DURATION = 3

/** Find a video track (not the main one) that only holds text and has room, or create one on top. */
function textTrackFor(d: Draft<Project>, start: number, end: number): Track {
  const main = mainTrack(d, 'video')
  const candidates = d.tracks.filter(
    (t) =>
      t.kind === 'video' &&
      t.id !== main?.id &&
      !t.locked &&
      d.clips.filter((c) => c.trackId === t.id).every((c) => !!c.text)
  ) as Track[]
  return (
    candidates.find((t) => !overlaps(d.clips as Clip[], t.id, start, end)) ?? insertTrack(d, 'video')
  )
}

export function addTextClip(data: TextData, opts: { start?: number; duration?: number; y?: number } = {}): void {
  const { project, playhead } = get()
  if (!project) return
  const start = Math.max(0, opts.start ?? playhead)
  const dur = opts.duration ?? TEXT_DEFAULT_DURATION
  const id = uid()
  commit((d) => {
    const track = textTrackFor(d, start, start + dur)
    d.clips.push({
      id,
      trackId: track.id,
      mediaId: '',
      text: JSON.parse(JSON.stringify(data)),
      start,
      in: 0,
      out: dur,
      volume: 1,
      transform: { ...defaultTransform(), y: opts.y ?? 0 }
    })
  })
  set({ selection: [id] })
}

export interface CaptionChunk {
  start: number // timeline seconds
  end: number
  words: { text: string; start: number; end: number }[] // timeline seconds
}

/** Put generated captions on a new track on top. One undo step. */
export function addCaptions(chunks: CaptionChunk[], style: TextStyle, y: number): void {
  if (!chunks.length) return
  commit((d) => {
    const track = insertTrack(d, 'video')
    for (const ch of chunks) {
      const dur = Math.max(0.1, ch.end - ch.start)
      d.clips.push({
        id: uid(),
        trackId: track.id,
        mediaId: '',
        text: {
          content: ch.words.map((w) => w.text).join(' '),
          style: { ...style },
          caption: true,
          // stored in clip time (clip.in = 0 at clip.start)
          words: ch.words.map((w) => ({ text: w.text, start: w.start - ch.start, end: w.end - ch.start }))
        },
        start: ch.start,
        in: 0,
        out: dur,
        volume: 1,
        transform: { ...defaultTransform(), y }
      })
    }
  })
  set({ selection: [] })
}

/** Copy the style and position of one text clip to all other text clips on the same track. */
export function applyTextStyleToTrack(clipId: string): number {
  const p = get().project
  const src = p?.clips.find((c) => c.id === clipId)
  if (!src?.text) return 0
  let n = 0
  commit((d) => {
    for (const c of d.clips) {
      if (c.id === src.id || c.trackId !== src.trackId || !c.text) continue
      c.text.style = { ...src.text!.style }
      c.transform = { ...src.transform }
      n++
    }
  })
  return n
}

export function updateClip(id: string, recipe: (c: Draft<Clip>) => void, key?: string): void {
  commit((d) => {
    const c = d.clips.find((x) => x.id === id)
    if (c) recipe(c)
  }, key)
}

export function isClipLocked(p: Project, c: Clip): boolean {
  return !!p.tracks.find((t) => t.id === c.trackId)?.locked
}

/** Split the selected clips (or every clip) under time t. */
export function splitAt(t: number): void {
  const { project, selection } = get()
  if (!project) return
  const under = project.clips.filter(
    (c) => !isClipLocked(project, c) && c.start + 0.01 < t && clipEnd(c) - 0.01 > t
  )
  const selected = under.filter((c) => selection.includes(c.id))
  const targets = selected.length ? selected : under
  if (!targets.length) return
  const newIds: string[] = []
  commit((d) => {
    for (const tc of targets) {
      const c = d.clips.find((x) => x.id === tc.id)
      if (!c) continue
      const cut = c.in + (t - c.start)
      const right: Clip = { ...JSON.parse(JSON.stringify(c)), id: uid(), start: t, in: cut }
      c.out = cut
      d.clips.push(right)
      newIds.push(right.id)
    }
  })
  set({ selection: newIds })
}

export function deleteSelection(): void {
  const { project, selection } = get()
  if (!project || !selection.length) return
  commit((d) => {
    d.clips = d.clips.filter((c) => !selection.includes(c.id) || isClipLocked(project, c as Clip))
    pruneTracks(d)
  })
  set({ selection: [] })
}

export function duplicateSelection(): void {
  const { project, selection } = get()
  if (!project || !selection.length) return
  const ids: string[] = []
  commit((d) => {
    for (const id of selection) {
      const c = d.clips.find((x) => x.id === id)
      if (!c) continue
      const dur = c.out - c.in
      const copy: Clip = { ...JSON.parse(JSON.stringify(c)), id: uid() }
      copy.start = findFreeStart(d.clips as Clip[], c.trackId, clipEnd(c), dur)
      d.clips.push(copy)
      ids.push(copy.id)
    }
  })
  set({ selection: ids })
}

export function select(id: string | null, additive = false): void {
  if (!id) return set({ selection: [] })
  const { selection } = get()
  if (additive) {
    set({ selection: selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id] })
  } else if (!selection.includes(id) || selection.length > 1) {
    set({ selection: [id] })
  }
}
