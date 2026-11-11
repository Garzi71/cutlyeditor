// Bottom panel: multi-track timeline with ruler, playhead, clip move/trim, snapping and zoom.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Blend, Copy, Eye, EyeOff, Film, Lock, Magnet, Maximize2, Music, Palette, Plus, Redo2, Scissors, SlidersHorizontal, Sparkles, Trash2, Type, Undo2,
  Unlock, Volume2,
  VolumeX, ZoomIn, ZoomOut
} from 'lucide-react'
import type { AnimProp, Clip, MediaAssets, MediaItem, Track, TrackKind } from '@shared/types'
import { PEAKS_PER_SECOND, clipDuration, clipEnd, projectDuration } from '@shared/types'
import { player } from '../engine/player'
import {
  addClip, commit, deleteSelection, duplicateSelection, findFreeStart, importPaths, insertTrack, isClipLocked, selectTransition, setTransition,
  mainTrack, orderedTracks, overlaps, pruneTracks, redo, select, splitAt, toggleTrack, undo, updateClip, useEditor
} from '../store'
import { clamp, formatShort, mediaUrl } from '../lib/util'
import { gradeIsActive } from '../engine/color'
import { adjustPlayed, rateAt, sourceTimeAt, speedOf } from '@shared/timing'
import { FILTERS } from '../engine/filters'
import { previousClip } from '../engine/compositor'
import { DEFAULT_TRANSITION, EFFECT_NAMES } from './FxPanels'

const HEADER_W = 150
/** Space between the track headers and time 0, so the playhead and first clip aren't under the header. */
const LANE_PAD = 12
const RULER_H = 28
const NEW_ZONE_H = 14
const NEW_ZONE_DRAG_H = 40
/** Track heights by what is on them. */
const LANE_H = { main: 64, overlay: 52, slim: 36, audio: 46 }
const MIN_PPS = 2
const MAX_PPS = 400
const MIN_CLIP = 0.1
/** Text clips behave like images on the timeline (any length, no source limits). */
const TEXT_MEDIA: MediaItem = {
  id: '', path: '', name: 'Text', kind: 'image', duration: 0, width: 0, height: 0, fps: 30, hasAudio: false, size: 0
}

type DragMode = 'move' | 'l' | 'r'

export default function Timeline(): React.JSX.Element {
  const project = useEditor((s) => s.project)!
  const pps = useEditor((s) => s.pxPerSec)
  const snapping = useEditor((s) => s.snapping)
  const selection = useEditor((s) => s.selection)
  const transitionSel = useEditor((s) => s.transitionSel)
  const silencePreview = useEditor((s) => s.silencePreview)
  const assets = useEditor((s) => s.assets)
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ left: 0, width: 1000 })
  const [snapLine, setSnapLine] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const tracks = orderedTracks(project)
  const duration = projectDuration(project)
  const laneViewW = Math.max(100, view.width - HEADER_W - LANE_PAD)
  // A little room after the end to drop clips, but no scrollbar when everything fits.
  const contentSec = Math.max(duration + Math.max(5, (laneViewW * 0.25) / pps), laneViewW / pps)
  const contentW = contentSec * pps
  const mediaById = useMemo(() => new Map(project.media.map((m) => [m.id, m])), [project.media])
  const main = mainTrack(project, 'video')
  const visStart = view.left / pps
  const visEnd = (view.left + laneViewW) / pps

  // ---- scroll / resize / zoom ----
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = (): void => {
      setView({ left: el.scrollLeft, width: el.clientWidth })
      setScrolled(el.scrollTop > 2)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    el.addEventListener('scroll', update)
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey) {
        e.preventDefault()
        const rect = el.getBoundingClientRect()
        const x = e.clientX - rect.left - HEADER_W - LANE_PAD
        const cur = useEditor.getState().pxPerSec
        const t = (el.scrollLeft + x) / cur
        const next = clamp(cur * Math.pow(1.0015, -e.deltaY), MIN_PPS, MAX_PPS)
        useEditor.setState({ pxPerSec: next })
        requestAnimationFrame(() => (el.scrollLeft = t * next - x))
      } else if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault()
        el.scrollLeft += e.deltaY
      } else if (e.shiftKey) {
        e.preventDefault()
        el.scrollTop += e.deltaY
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', update)
      el.removeEventListener('wheel', onWheel)
    }
  }, [])

  // Keep the main track in view when tracks are added (scroll as little as needed), and bring a
  // newly selected clip into view.
  const trackCount = project.tracks.length
  useEffect(() => {
    const el = scrollRef.current
    const row = el?.querySelector('.tl-row.main') as HTMLElement | null
    if (!el || !row) return
    const bottom = row.offsetTop + row.offsetHeight
    if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
  }, [trackCount])
  const selKey = selection.join(',')
  useEffect(() => {
    const el = scrollRef.current
    const clip = el?.querySelector('.clip.selected') as HTMLElement | null
    if (!el || !clip) return
    const row = clip.closest('.tl-row') as HTMLElement
    const top = row.offsetTop - RULER_H
    const bottom = row.offsetTop + row.offsetHeight
    if (top < el.scrollTop) el.scrollTop = top
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
  }, [selKey])
  const [scrolled, setScrolled] = useState(false)

  const setZoom = (next: number): void => {
    const el = scrollRef.current
    const t = useEditor.getState().playhead
    const nextPps = clamp(next, MIN_PPS, MAX_PPS)
    useEditor.setState({ pxPerSec: nextPps })
    if (el) requestAnimationFrame(() => (el.scrollLeft = Math.max(0, t * nextPps - laneViewW / 2)))
  }
  const fit = (): void => {
    if (duration <= 0) return
    useEditor.setState({ pxPerSec: clamp((laneViewW * 0.95) / duration, MIN_PPS, MAX_PPS) })
    if (scrollRef.current) scrollRef.current.scrollLeft = 0
  }

  // ---- time <-> screen ----
  const timeAt = (clientX: number): number => {
    const el = scrollRef.current!
    const rect = el.getBoundingClientRect()
    return Math.max(0, (clientX - rect.left - HEADER_W - LANE_PAD + el.scrollLeft) / useEditor.getState().pxPerSec)
  }

  const snapPoints = (excludeId?: string): number[] => {
    const st = useEditor.getState()
    if (!st.snapping || !st.project) return []
    const pts = [0, st.playhead]
    for (const c of st.project.clips) if (c.id !== excludeId) pts.push(c.start, clipEnd(c))
    return pts
  }

  // ---- scrubbing (ruler / empty lane) ----
  const startScrub = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    if (useEditor.getState().playing) player.pause()
    player.seek(timeAt(e.clientX))
    const move = (ev: PointerEvent): void => player.seek(timeAt(ev.clientX))
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ---- clip dragging / trimming ----
  const beginClipDrag = useCallback((e: React.PointerEvent, clipId: string, mode: DragMode) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const st = useEditor.getState()
    const p = st.project!
    const orig = p.clips.find((c) => c.id === clipId)
    if (!orig) return
    select(clipId, e.shiftKey || e.ctrlKey)
    if (isClipLocked(p, orig)) return
    const m = orig.text || orig.adjustment || orig.effect ? TEXT_MEDIA : p.media.find((x) => x.id === orig.mediaId)
    if (!m) return
    const kind: TrackKind = m.kind === 'audio' ? 'audio' : 'video'
    const pps0 = st.pxPerSec
    const thr = 8 / pps0
    const pts = snapPoints(clipId)
    const dur = clipDuration(orig)
    const sx = e.clientX
    const sy = e.clientY
    const key = `drag-${clipId}-${Date.now()}`
    let moved = false
    let toNewTrack = false

    const snap = (t: number): number | null => {
      let best: number | null = null
      let bd = thr
      for (const s of pts) {
        const d = Math.abs(s - t)
        if (d < bd) {
          bd = d
          best = s
        }
      }
      return best
    }
    const sameTrack = p.clips.filter((c) => c.trackId === orig.trackId && c.id !== orig.id)
    const prevEnd = sameTrack.filter((c) => clipEnd(c) <= orig.start + 1e-4).reduce((a, c) => Math.max(a, clipEnd(c)), 0)
    const nextStart = sameTrack.filter((c) => c.start >= clipEnd(orig) - 1e-4).reduce((a, c) => Math.min(a, c.start), Infinity)

    const move = (ev: PointerEvent): void => {
      const dx = ev.clientX - sx
      if (!moved && Math.abs(dx) < 3 && Math.abs(ev.clientY - sy) < 3) return
      if (!moved) setDraggingId(clipId)
      moved = true
      const dt = dx / pps0

      if (mode === 'move') {
        let ns = Math.max(0, orig.start + dt)
        const s1 = snap(ns)
        const s2 = snap(ns + dur)
        let line: number | null = null
        if (s1 !== null && (s2 === null || Math.abs(s1 - ns) <= Math.abs(s2 - (ns + dur)))) {
          ns = s1
          line = s1
        } else if (s2 !== null && s2 - dur >= 0) {
          ns = s2 - dur
          line = s2
        }
        setSnapLine(line)
        let trackId = useEditor.getState().project!.clips.find((c) => c.id === clipId)?.trackId ?? orig.trackId
        toNewTrack = false
        const hit = document.elementsFromPoint(ev.clientX, ev.clientY) as HTMLElement[]
        const lane = hit.find((el) => el.dataset?.trackId)
        const zone = hit.find((el) => el.dataset?.newTrack)
        if (lane) {
          const t = useEditor.getState().project!.tracks.find((x) => x.id === lane.dataset.trackId)
          if (t && t.kind === kind && !t.locked) trackId = t.id
        } else if (zone && zone.dataset.newTrack === kind) {
          toNewTrack = true
        }
        setDropTarget(toNewTrack ? `new-${kind}` : null)
        updateClip(clipId, (c) => {
          c.start = ns
          c.trackId = trackId
        }, key)
      } else {
        // Trimming works in timeline time; the source range changes by the clip's speed at that edge.
        const unlimited = m.kind === 'image'
        const rev = !!speedOf(orig).reverse
        const origEnd = clipEnd(orig)
        if (mode === 'l') {
          const rate = rateAt(orig, 0)
          const avail = unlimited ? Infinity : rev ? m.duration - orig.out : orig.in
          const lo = Math.max(prevEnd, orig.start - avail / rate)
          const hi = origEnd - MIN_CLIP
          let ns = clamp(orig.start + dt, lo, hi)
          const sn = snap(ns)
          if (sn !== null && sn >= lo && sn <= hi) ns = sn
          setSnapLine(sn)
          const dTau = orig.start - ns // > 0: the clip gets longer
          const io = adjustPlayed(orig, 'head', dTau * rate)
          updateClip(clipId, (c) => {
            c.in = io.in
            c.out = io.out
            c.start = ns
            // Keyframes stay on the same picture.
            if (orig.keyframes) {
              for (const k of Object.keys(orig.keyframes) as AnimProp[]) c.keyframes![k] = orig.keyframes[k]!.map((f) => ({ ...f, t: f.t + dTau }))
            }
          }, key)
        } else {
          const rate = rateAt(orig, clipDuration(orig))
          const avail = unlimited ? Infinity : rev ? orig.in : m.duration - orig.out
          const lo = orig.start + MIN_CLIP
          const hi = Math.min(nextStart, origEnd + avail / rate)
          let ne = clamp(origEnd + dt, lo, hi)
          const sn = snap(ne)
          if (sn !== null && sn >= lo && sn <= hi) ne = sn
          setSnapLine(sn)
          const io = adjustPlayed(orig, 'tail', (ne - origEnd) * rate)
          updateClip(clipId, (c) => {
            c.in = io.in
            c.out = io.out
          }, key)
        }
      }
    }

    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      window.removeEventListener('blur', up)
      setSnapLine(null)
      setDropTarget(null)
      setDraggingId(null)
      if (!moved) return
      commit((d) => {
        const c = d.clips.find((x) => x.id === clipId)
        if (!c) return
        if (toNewTrack) {
          c.trackId = insertTrack(d, kind).id
        } else if (mode === 'move' && overlaps(d.clips as Clip[], c.trackId, c.start, c.start + dur, c.id)) {
          c.start = findFreeStart(d.clips as Clip[], c.trackId, c.start, dur, c.id)
        }
        pruneTracks(d)
      }, key)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    // Never leave a drag "stuck" if the mouse is released outside the window.
    window.addEventListener('pointercancel', up)
    window.addEventListener('blur', up)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- dropping media from the library / Explorer ----
  const onDragOver = (e: React.DragEvent, target: string): void => {
    const types = e.dataTransfer.types
    if (types.includes('application/x-cutly-media') || types.includes('Files')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      if (dropTarget !== target) setDropTarget(target)
    }
  }

  const onDrop = async (e: React.DragEvent, target: { trackId?: string; newTrack?: boolean }): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(null)
    let start = timeAt(e.clientX)
    const pts = snapPoints()
    const near = pts.find((p) => Math.abs(p - start) < 8 / pps)
    if (near !== undefined) start = near
    const mediaId = e.dataTransfer.getData('application/x-cutly-media')
    if (mediaId) {
      addClip(mediaId, { start, ...target })
      return
    }
    const paths = Array.from(e.dataTransfer.files).map((f) => window.api.pathForFile(f)).filter(Boolean)
    const items = await importPaths(paths)
    for (const m of items) {
      addClip(m.id, { start, ...target })
      start += m.kind === 'image' ? 5 : m.duration
    }
  }

  const newZone = (kind: TrackKind): React.JSX.Element => (
    <div className="tl-row tl-newtrack" style={{ height: dropTarget !== null || draggingId ? NEW_ZONE_DRAG_H : NEW_ZONE_H }}>
      <div className="tl-head" />
      <div
        className={`tl-lane ${dropTarget === `new-${kind}` ? 'drop' : ''}`}
        data-new-track={kind}
        style={{ width: contentW }}
        onPointerDown={(e) => {
          useEditor.setState({ selection: [] })
          startScrub(e)
        }}
        onDragOver={(e) => onDragOver(e, `new-${kind}`)}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(e) => onDrop(e, { newTrack: true })}
      />
    </div>
  )

  const hasSel = selection.length > 0

  return (
    <div className="panel timeline" style={{ ['--header-w' as string]: `${HEADER_W}px`, ['--lane-pad' as string]: `${LANE_PAD}px` }}>
      <div className="tl-toolbar">
        <button className="icon-btn" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
          <Undo2 size={16} />
        </button>
        <button className="icon-btn" title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={redo}>
          <Redo2 size={16} />
        </button>
        <div className="sep" />
        <button className="icon-btn" title="Split at playhead (S)" onClick={() => splitAt(useEditor.getState().playhead)}>
          <Scissors size={16} />
        </button>
        <button className="icon-btn" title="Duplicate (Ctrl+D)" disabled={!hasSel} onClick={duplicateSelection}>
          <Copy size={16} />
        </button>
        <button className="icon-btn" title="Delete (Del)" disabled={!hasSel} onClick={deleteSelection}>
          <Trash2 size={16} />
        </button>
        <div className="spacer" />
        <button
          className={`icon-btn ${snapping ? 'active' : ''}`}
          title="Snapping"
          onClick={() => useEditor.setState({ snapping: !snapping })}
        >
          <Magnet size={16} />
        </button>
        <div className="sep" />
        <div className="zoom">
          <button className="icon-btn sm" title="Zoom out" onClick={() => setZoom(pps / 1.5)}>
            <ZoomOut size={16} />
          </button>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round((Math.log(pps / MIN_PPS) / Math.log(MAX_PPS / MIN_PPS)) * 1000)}
            style={{ ['--p' as string]: `${(Math.log(pps / MIN_PPS) / Math.log(MAX_PPS / MIN_PPS)) * 100}%` }}
            onChange={(e) => setZoom(MIN_PPS * Math.pow(MAX_PPS / MIN_PPS, Number(e.target.value) / 1000))}
          />
          <button className="icon-btn sm" title="Zoom in" onClick={() => setZoom(pps * 1.5)}>
            <ZoomIn size={16} />
          </button>
        </div>
        <button className="icon-btn" title="Fit timeline" onClick={fit}>
          <Maximize2 size={16} />
        </button>
      </div>

      <div className={`tl-scroll ${scrolled ? 'scrolled' : ''}`} ref={scrollRef}>
        <div className="tl-content" style={{ width: HEADER_W + LANE_PAD + contentW }}>
          <div className="tl-ruler-row" style={{ height: RULER_H }}>
            <div className="tl-corner" />
            <Ruler pps={pps} from={visStart} to={visEnd} width={LANE_PAD + contentW} fps={project.fps} onPointerDown={startScrub} />
          </div>

          {newZone('video')}
          {tracks.map((t) => {
            const on = project.clips.filter((c) => c.trackId === t.id)
            const isMain = t.id === main?.id
            const isText = on.length > 0 && on.every((c) => !!c.text)
            const isAdjust = on.length > 0 && on.every((c) => !!c.adjustment)
            const isEffect = on.length > 0 && on.every((c) => !!c.effect)
            const hasSound = t.kind === 'audio' || on.some((c) => mediaById.get(c.mediaId)?.hasAudio)
            const h =
              t.kind === 'audio' ? LANE_H.audio : isMain ? LANE_H.main : isText || isAdjust || isEffect ? LANE_H.slim : LANE_H.overlay
            return (
            <TrackRow
              key={t.id}
              track={t}
              isMain={isMain}
              isText={isText}
              isAdjust={isAdjust}
              isEffect={isEffect}
              hasSound={hasSound}
              height={h}
              width={LANE_PAD + contentW}
              drop={dropTarget === t.id}
              onLanePointerDown={(e) => {
                useEditor.setState({ selection: [] })
                startScrub(e)
              }}
              onDragOver={(e) => onDragOver(e, t.id)}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(e) => onDrop(e, { trackId: t.id })}
            >
              {project.clips
                .filter((c) => c.trackId === t.id)
                .map((c) => {
                  const m = c.text || c.adjustment || c.effect ? TEXT_MEDIA : mediaById.get(c.mediaId)
                  if (!m) return null
                  return (
                    <ClipView
                      key={c.id}
                      clip={c}
                      media={m}
                      assets={assets[m.id]}
                      track={t}
                      pps={pps}
                      height={h - 6}
                      selected={selection.includes(c.id)}
                      dragging={draggingId === c.id}
                      visStart={visStart}
                      visEnd={visEnd}
                      locked={t.locked}
                      onDragStart={beginClipDrag}
                      silence={silencePreview?.clipId === c.id ? silencePreview.ranges : undefined}
                    />
                  )
                })}
              {t.kind === 'video' &&
                project.clips
                  .filter((c) => c.trackId === t.id && !c.adjustment && !c.effect && previousClip(project, c))
                  .map((c) => (
                    <button
                      key={'cut' + c.id}
                      className={`cut-marker ${c.transitionIn ? 'has' : ''} ${transitionSel === c.id ? 'selected' : ''}`}
                      style={{ left: c.start * pps }}
                      title={c.transitionIn ? 'Transition (click to edit)' : 'Add a transition'}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => {
                        if (!c.transitionIn) setTransition(c.id, { type: 'dissolve', duration: DEFAULT_TRANSITION })
                        selectTransition(c.id)
                      }}
                    >
                      {c.transitionIn ? <Blend size={11} /> : <Plus size={11} />}
                    </button>
                  ))}
              {isMain && project.clips.length === 0 && (
                <div className="lane-empty" style={{ left: view.left + 6 - LANE_PAD, width: laneViewW + LANE_PAD - 12 }}>
                  <Film size={16} /> Drag media here to start editing
                </div>
              )}
            </TrackRow>
            )
          })}
          {newZone('audio')}

          {snapLine !== null && <div className="snap-line" style={{ left: HEADER_W + LANE_PAD + snapLine * pps, top: RULER_H }} />}
          <PlayheadLine pps={pps} scrollRef={scrollRef} laneViewW={laneViewW} />
        </div>
      </div>
    </div>
  )
}

// ---------------- ruler ----------------

const STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600]

function Ruler(props: {
  pps: number
  from: number
  to: number
  width: number
  fps: number
  onPointerDown: (e: React.PointerEvent) => void
}): React.JSX.Element {
  const { pps, from, to, width, fps } = props
  const major = STEPS.find((s) => s * pps >= 90) ?? 3600
  const minor = major / (major === 0.25 || major === 15 ? 5 : major === 1 && pps * major > 200 ? 10 : 5)
  const ticks: React.JSX.Element[] = []
  const first = Math.floor(from / minor)
  const last = Math.ceil(to / minor) + 1
  for (let i = first; i <= last; i++) {
    const t = i * minor
    const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6
    ticks.push(<div key={i} className={`tick ${isMajor ? 'major' : ''}`} style={{ left: t * pps }} />)
    if (isMajor) {
      const label =
        major < 1 ? `${formatShort(Math.floor(t))}:${String(Math.round((t % 1) * fps)).padStart(2, '0')}f` : formatShort(t)
      ticks.push(
        <div key={`l${i}`} className="tick-label" style={{ left: t * pps }}>
          {label}
        </div>
      )
    }
  }
  return (
    <div className="tl-ruler" style={{ width }} onPointerDown={props.onPointerDown}>
      {ticks}
      <PlayheadKnob pps={pps} onPointerDown={props.onPointerDown} />
    </div>
  )
}

function PlayheadKnob({ pps, onPointerDown }: { pps: number; onPointerDown: (e: React.PointerEvent) => void }): React.JSX.Element {
  const t = useEditor((s) => s.playhead)
  return (
    <div className="playhead" style={{ left: t * pps, zIndex: 9 }}>
      <div className="playhead-knob" onPointerDown={onPointerDown} />
    </div>
  )
}

function PlayheadLine(props: {
  pps: number
  scrollRef: React.RefObject<HTMLDivElement | null>
  laneViewW: number
}): React.JSX.Element {
  const t = useEditor((s) => s.playhead)
  const playing = useEditor((s) => s.playing)
  const { pps, scrollRef, laneViewW } = props
  // Follow the playhead while playing.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !playing) return
    const x = t * pps
    if (x > el.scrollLeft + laneViewW - 40 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - laneViewW * 0.1)
  }, [t, playing, pps, laneViewW, scrollRef])
  return <div className="playhead" style={{ left: HEADER_W + LANE_PAD + t * pps, top: RULER_H, zIndex: 4 }} />
}

// ---------------- tracks ----------------

function TrackRow(props: {
  track: Track
  isMain: boolean
  isText: boolean
  isAdjust: boolean
  isEffect: boolean
  hasSound: boolean
  height: number
  width: number
  drop: boolean
  children: React.ReactNode
  onLanePointerDown: (e: React.PointerEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
}): React.JSX.Element {
  const { track: t } = props
  return (
    <div className={`tl-row ${props.isMain ? 'main' : ''} ${t.hidden ? 'hidden' : ''}`} style={{ height: props.height }}>
      <div className="tl-head">
        <div className={`track-label ${props.isMain ? 'main' : ''}`}>
          {props.isEffect ? <Sparkles size={13} /> : props.isAdjust ? <SlidersHorizontal size={13} /> : props.isText ? <Type size={13} /> : t.kind === 'video' ? <Film size={13} /> : <Music size={13} />}
          {props.isMain ? 'Main' : props.isEffect ? 'Effects' : props.isAdjust ? 'Adjust' : props.isText ? 'Text' : t.kind === 'video' ? 'Overlay' : 'Audio'}
        </div>
        <button className={`icon-btn sm ${t.locked ? 'active' : ''}`} title={t.locked ? 'Unlock track' : 'Lock track'} onClick={() => toggleTrack(t.id, 'locked')}>
          {t.locked ? <Lock size={13} /> : <Unlock size={13} />}
        </button>
        {t.kind === 'video' ? (
          <button className={`icon-btn sm ${t.hidden ? 'active' : ''}`} title={t.hidden ? 'Show track' : 'Hide track'} onClick={() => toggleTrack(t.id, 'hidden')}>
            {t.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        ) : (
          <span />
        )}
        {props.hasSound ? (
          <button className={`icon-btn sm ${t.muted ? 'active mute' : ''}`} title={t.muted ? 'Unmute track' : 'Mute track'} onClick={() => toggleTrack(t.id, 'muted')}>
            {t.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>
        ) : (
          <span />
        )}
      </div>
      <div
        className={`tl-lane ${props.drop ? 'drop' : ''} ${t.locked ? 'locked' : ''}`}
        data-track-id={t.id}
        style={{ width: props.width }}
        onPointerDown={(e) => e.target === e.currentTarget && props.onLanePointerDown(e)}
        onDragOver={props.onDragOver}
        onDragLeave={props.onDragLeave}
        onDrop={props.onDrop}
      >
        {props.children}
      </div>
    </div>
  )
}

// ---------------- clips ----------------

const ClipView = memo(function ClipView(props: {
  clip: Clip
  media: MediaItem
  assets?: MediaAssets
  track: Track
  pps: number
  height: number
  selected: boolean
  dragging: boolean
  locked: boolean
  visStart: number
  visEnd: number
  onDragStart: (e: React.PointerEvent, id: string, mode: DragMode) => void
  silence?: [number, number][]
}): React.JSX.Element {
  const { clip: c, media: m, assets, pps, height, track } = props
  const left = c.start * pps
  const width = Math.max(2, clipDuration(c) * pps)
  const isAdj = !!c.adjustment || !!c.effect
  const isText = !!c.text || isAdj
  const kindClass = c.effect ? 'text effect' : isAdj ? 'text adjust' : c.text ? 'text' : m.kind === 'audio' ? 'audio' : m.kind === 'image' ? 'image video' : 'video'
  const showWave = !isText && !!assets?.peaks && (m.kind === 'audio' || m.hasAudio)
  const filterName = c.color?.filter ? FILTERS.find((f) => f.id === c.color!.filter!.id)?.name : undefined
  const label = c.effect ? `Effect · ${EFFECT_NAMES[c.effect.type]}` : isAdj ? `Adjustment${filterName ? ` · ${filterName}` : c.color?.lut ? ` · ${c.color.lut.name}` : ''}` : c.text ? c.text.content : m.name

  return (
    <div
      className={`clip ${kindClass} ${props.selected ? 'selected' : ''} ${props.dragging ? 'dragging' : ''} ${props.locked ? 'locked' : ''} ${track.hidden ? 'track-hidden' : ''}`}
      style={{ left, width }}
      onPointerDown={(e) => props.onDragStart(e, c.id, 'move')}
    >
      {m.kind !== 'audio' && assets && assets.thumbnails.length > 0 && (
        <Thumbs clip={c} media={m} thumbs={assets.thumbnails} pps={pps} height={height} visStart={props.visStart} visEnd={props.visEnd} />
      )}
      {showWave && (
        <Waveform peaks={assets!.peaks!} from={c.in} to={c.out} widthPx={width} />
      )}
      <div className="clip-label">
        {c.text && <Type size={11} style={{ flexShrink: 0, marginTop: 2 }} />}
        {c.effect ? (
          <Sparkles size={11} style={{ flexShrink: 0, marginTop: 2 }} />
        ) : (
          isAdj && <SlidersHorizontal size={11} style={{ flexShrink: 0, marginTop: 2 }} />
        )}
        {!isText && gradeIsActive(c.color) && <Palette size={11} style={{ flexShrink: 0, marginTop: 2 }} />}
        <span className="name">{label}</span>
        {!isText && <span className="dur">{formatShort(clipDuration(c))}</span>}
      </div>
      {!isText && (track.muted || c.volume === 0) && m.kind !== 'image' && (
        <div className="clip-muted">
          <VolumeX size={12} />
        </div>
      )}
      {props.silence?.map(([a, b], i) => (
        <div key={'s' + i} className="clip-silence" style={{ left: (a - c.start) * pps, width: Math.max(1, (b - a) * pps) }} />
      ))}
      {props.selected && c.keyframes && (
        <div className="clip-kfs">
          {[...new Set(Object.values(c.keyframes).flatMap((list) => (list ?? []).map((k) => Math.round(k.t * 100) / 100)))].map((t) => (
            <span key={t} className="clip-kf" style={{ left: t * pps }} />
          ))}
        </div>
      )}
      {!props.locked && (
        <>
          <div className="trim l" onPointerDown={(e) => props.onDragStart(e, c.id, 'l')} />
          <div className="trim r" onPointerDown={(e) => props.onDragStart(e, c.id, 'r')} />
        </>
      )}
    </div>
  )
})

/** Filmstrip: only the thumbnails inside the visible part of the timeline are rendered. */
function Thumbs(props: {
  clip: Clip
  media: MediaItem
  thumbs: string[]
  pps: number
  height: number
  visStart: number
  visEnd: number
}): React.JSX.Element {
  const { clip: c, media: m, thumbs, pps, height } = props
  const aspect = m.width && m.height ? m.width / m.height : 16 / 9
  const tw = clamp(height * aspect, 30, 200)
  const widthPx = clipDuration(c) * pps
  const first = Math.max(0, Math.floor(((props.visStart - c.start) * pps) / tw))
  const last = Math.min(Math.ceil(widthPx / tw), Math.ceil(((props.visEnd - c.start) * pps) / tw) + 1)
  const imgs: React.JSX.Element[] = []
  for (let i = first; i < last; i++) {
    let idx = 0
    if (m.kind === 'video' && m.duration > 0) {
      const t = sourceTimeAt(c, (i * tw + tw / 2) / pps)
      idx = clamp(Math.floor((t / m.duration) * thumbs.length), 0, thumbs.length - 1)
    }
    imgs.push(
      <img key={i} src={mediaUrl(thumbs[idx])} style={{ position: 'absolute', left: i * tw, width: tw }} alt="" draggable={false} />
    )
  }
  return <div className="clip-thumbs">{imgs}</div>
}

function Waveform({ peaks, from, to, widthPx }: { peaks: number[]; from: number; to: number; widthPx: number }): React.JSX.Element {
  const bucket = Math.max(8, Math.round(widthPx / 4) * 4) // re-render only when the width changes noticeably
  const d = useMemo(() => {
    const a = Math.max(0, Math.floor(from * PEAKS_PER_SECOND))
    const b = Math.min(peaks.length, Math.ceil(to * PEAKS_PER_SECOND))
    const n = Math.max(1, Math.min(b - a, Math.round(bucket / 2)))
    const step = (b - a) / n
    const vals: number[] = []
    for (let i = 0; i < n; i++) {
      let mx = 0
      const s = Math.floor(a + i * step)
      const e = Math.max(s + 1, Math.floor(a + (i + 1) * step))
      for (let j = s; j < e && j < peaks.length; j++) mx = Math.max(mx, peaks[j])
      vals.push(mx)
    }
    let top = 'M0 0.5'
    let bottom = ''
    vals.forEach((v, i) => {
      top += ` L${i} ${(0.5 - v * 0.48).toFixed(3)} L${i + 1} ${(0.5 - v * 0.48).toFixed(3)}`
    })
    for (let i = vals.length - 1; i >= 0; i--) {
      const y = (0.5 + vals[i] * 0.48).toFixed(3)
      bottom += ` L${i + 1} ${y} L${i} ${y}`
    }
    return { path: `${top}${bottom} Z`, n: vals.length }
  }, [peaks, from, to, bucket])
  return (
    <svg className="clip-wave" viewBox={`0 0 ${d.n} 1`} preserveAspectRatio="none" style={{ width: '100%' }}>
      <path d={d.path} />
    </svg>
  )
}
