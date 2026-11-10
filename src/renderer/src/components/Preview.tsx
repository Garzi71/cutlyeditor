// Center panel: the player canvas, play controls and on-canvas move/scale handles.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { clipEnd, fitSize, projectDuration } from '@shared/types'
import { player } from '../engine/player'
import { isClipLocked, updateClip, useEditor } from '../store'
import { aspectIdOf, formatTimecode } from '../lib/util'

export default function Preview(): React.JSX.Element {
  const project = useEditor((s) => s.project)!
  const playing = useEditor((s) => s.playing)
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })

  useEffect(() => {
    player.attach(canvasRef.current)
    return () => player.attach(null)
  }, [])

  // Fit the frame inside the available space, keeping the project's aspect ratio.
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const fit = (): void => {
      const pad = 24
      const aw = el.clientWidth - pad * 2
      const ah = el.clientHeight - pad * 2
      const s = Math.min(aw / project.width, ah / project.height)
      setBox({ w: Math.max(0, project.width * s), h: Math.max(0, project.height * s) })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [project.width, project.height])

  return (
    <div className="panel" style={{ minWidth: 0 }}>
      <div className="panel-header">
        Player
        <span className="hint" style={{ fontWeight: 400, marginLeft: 'auto' }}>
          {aspectIdOf(project.width, project.height)} · {project.width}×{project.height} · {project.fps} fps
        </span>
      </div>
      <div className="preview-stage" ref={stageRef} onPointerDown={(e) => e.target === e.currentTarget && useEditor.setState({ selection: [] })}>
        <div className="preview-frame" style={{ width: box.w, height: box.h }}>
          <canvas ref={canvasRef} />
          <SelectionOverlay scale={box.w / project.width} />
        </div>
      </div>
      <div className="preview-controls">
        <TimeDisplay />
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button className="icon-btn" title="Previous frame (←)" onClick={() => player.step(-1)}>
            <SkipBack size={16} />
          </button>
          <button className="play-btn" title="Play / Pause (Space)" onClick={() => player.toggle()}>
            {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </button>
          <button className="icon-btn" title="Next frame (→)" onClick={() => player.step(1)}>
            <SkipForward size={16} />
          </button>
        </div>
        <div className="preview-right" />
      </div>
    </div>
  )
}

function TimeDisplay(): React.JSX.Element {
  const playhead = useEditor((s) => s.playhead)
  const project = useEditor((s) => s.project)!
  return (
    <div className="timecode">
      <b>{formatTimecode(playhead, project.fps)}</b> / {formatTimecode(projectDuration(project), project.fps)}
    </div>
  )
}

/** Outline around the selected clip in the player; drag to move, drag the corner to scale. */
function SelectionOverlay({ scale }: { scale: number }): React.JSX.Element | null {
  const project = useEditor((s) => s.project)!
  const selection = useEditor((s) => s.selection)
  const playhead = useEditor((s) => s.playhead)
  const playing = useEditor((s) => s.playing)
  if (playing || selection.length !== 1) return null
  const clip = project.clips.find((c) => c.id === selection[0])
  if (!clip || playhead < clip.start || playhead >= clipEnd(clip)) return null
  const m = project.media.find((x) => x.id === clip.mediaId)
  const track = project.tracks.find((t) => t.id === clip.trackId)
  if (!m || m.kind === 'audio' || track?.hidden) return null
  const locked = isClipLocked(project, clip)

  const tr = clip.transform
  const fit = fitSize(m.width, m.height, project.width, project.height)
  const w = fit.w * tr.scale * scale
  const h = fit.h * tr.scale * scale
  const cx = (project.width / 2 + tr.x) * scale
  const cy = (project.height / 2 + tr.y) * scale

  const startMove = (e: React.PointerEvent): void => {
    if (locked) return
    e.stopPropagation()
    const sx = e.clientX
    const sy = e.clientY
    const ox = tr.x
    const oy = tr.y
    const key = `move-${clip.id}-${Date.now()}`
    const move = (ev: PointerEvent): void => {
      let nx = ox + (ev.clientX - sx) / scale
      let ny = oy + (ev.clientY - sy) / scale
      // Snap to the centre lines.
      if (Math.abs(nx) < 8 / scale) nx = 0
      if (Math.abs(ny) < 8 / scale) ny = 0
      updateClip(clip.id, (c) => {
        c.transform.x = Math.round(nx)
        c.transform.y = Math.round(ny)
      }, key)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const startScale = (e: React.PointerEvent): void => {
    if (locked) return
    e.stopPropagation()
    const rect = (e.currentTarget.parentElement!.parentElement as HTMLElement).getBoundingClientRect()
    const centerX = rect.left + cx
    const centerY = rect.top + cy
    const d0 = Math.hypot(e.clientX - centerX, e.clientY - centerY) || 1
    const s0 = tr.scale
    const key = `scale-${clip.id}-${Date.now()}`
    const move = (ev: PointerEvent): void => {
      const d = Math.hypot(ev.clientX - centerX, ev.clientY - centerY)
      const ns = Math.max(0.05, Math.min(10, (s0 * d) / d0))
      updateClip(clip.id, (c) => {
        c.transform.scale = Math.round(ns * 1000) / 1000
      }, key)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      className="sel-box"
      style={{
        left: cx - w / 2,
        top: cy - h / 2,
        width: w,
        height: h,
        transform: `rotate(${tr.rotation}deg)`,
        cursor: locked ? 'default' : 'move'
      }}
      onPointerDown={startMove}
    >
      {!locked &&
        [
          { left: -6, top: -6, cursor: 'nwse-resize' },
          { right: -6, top: -6, cursor: 'nesw-resize' },
          { left: -6, bottom: -6, cursor: 'nesw-resize' },
          { right: -6, bottom: -6, cursor: 'nwse-resize' }
        ].map((pos, i) => <div key={i} className="sel-handle" style={pos} onPointerDown={startScale} />)}
    </div>
  )
}
