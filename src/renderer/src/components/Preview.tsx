// Center panel: the player canvas, play controls and on-canvas move/scale handles.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, Maximize, Minimize, Pause, Play, Smartphone, SkipBack, SkipForward } from 'lucide-react'
import { clipEnd, fitSize, projectDuration } from '@shared/types'
import { player } from '../engine/player'
import { commit, isClipLocked, setAnimated, setAnimatedValues, useEditor } from '../store'
import SocialPreview, { SOCIAL_VIEWS, type SocialView } from './SocialPreview'
import { NumberField } from './Controls'
import { propAt } from '@shared/motion'
import { RATIOS, aspectIdOf, formatTimecode, frameSize } from '../lib/util'
import { measureTextClip } from '../engine/text'

export default function Preview(): React.JSX.Element {
  const project = useEditor((s) => s.project)!
  const playing = useEditor((s) => s.playing)
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [social, setSocialState] = useState<SocialView>(() => {
    try {
      return (localStorage.getItem('socialView') as SocialView) || 'none'
    } catch {
      return 'none'
    }
  })
  const setSocial = (v: SocialView): void => {
    setSocialState(v)
    try {
      localStorage.setItem('socialView', v)
    } catch {
      /* ignore */
    }
  }
  const [menu, setMenu] = useState<'social' | 'ratio' | null>(null)
  const [full, setFull] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const on = (): void => setFull(document.fullscreenElement === panelRef.current)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  const portrait = project.height > project.width
  // The app previews only make sense for tall (phone) frames.
  const phone = project.height / project.width >= 1.7

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
    <div className="panel player-panel" ref={panelRef} style={{ minWidth: 0 }}>
      <div className="panel-header">
        Player
        <span className="hint" style={{ fontWeight: 400, marginLeft: 'auto' }}>
          {aspectIdOf(project.width, project.height)} · {project.width}×{project.height} · {project.fps} fps
        </span>
      </div>
      <div
        className="preview-stage"
        ref={stageRef}
        onPointerDown={(e) => e.target === e.currentTarget && useEditor.setState({ selection: [] })}
      >
        <div className="preview-frame" style={{ width: box.w, height: box.h }}>
          <canvas ref={canvasRef} />
          {social === 'safe' && <SafeZones portrait={portrait} />}
          {phone && social !== 'safe' && <SocialPreview view={social} />}
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
        <div className="preview-right">
          <div className="menu-anchor">
            <button
              className={`icon-btn ${social !== 'none' ? 'active on' : ''}`}
              title="Preview for social media"
              onClick={() => setMenu(menu === 'social' ? null : 'social')}
            >
              <Smartphone size={16} />
            </button>
            {menu === 'social' && (
              <Menu onClose={() => setMenu(null)}>
                <div className="menu-head">
                  <b>Preview for social media</b>
                  <span>{phone ? 'Buttons and texts of the app over your video.' : 'App previews need a 9:16 frame.'}</span>
                </div>
                {SOCIAL_VIEWS.map((v) => (
                  <button
                    key={v.id}
                    className="menu-item"
                    disabled={v.id !== 'safe' && !phone}
                    onClick={() => {
                      setSocial(v.id)
                      setMenu(null)
                    }}
                  >
                    <span>{v.label}</span>
                    {social === v.id && <Check size={14} />}
                  </button>
                ))}
                <div className="menu-sep" />
                <button
                  className="menu-item"
                  onClick={() => {
                    setSocial('none')
                    setMenu(null)
                  }}
                >
                  <span>None</span>
                  {social === 'none' && <Check size={14} />}
                </button>
              </Menu>
            )}
          </div>
          <div className="menu-anchor">
            <button className="ratio-btn" title="Frame ratio" onClick={() => setMenu(menu === 'ratio' ? null : 'ratio')}>
              {aspectIdOf(project.width, project.height).replace('x', '×')}
            </button>
            {menu === 'ratio' && <RatioMenu onClose={() => setMenu(null)} />}
          </div>
          <button
            className="icon-btn"
            title={full ? 'Exit full screen (Esc)' : 'Full screen'}
            onClick={() => (full ? document.exitFullscreen() : panelRef.current?.requestFullscreen())}
          >
            {full ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Small dropdown that closes on an outside click or Esc. */
function Menu({ onClose, children }: { onClose: () => void; children: React.ReactNode }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const down = (e: PointerEvent): void => {
      if (ref.current && !ref.current.parentElement!.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [onClose])
  return (
    <div className="menu" ref={ref}>
      {children}
    </div>
  )
}

/** Change the project's frame shape (the shorter side stays the same). */
function setRatio(aw: number, ah: number): void {
  const p = useEditor.getState().project!
  const s = frameSize(aw, ah, Math.min(p.width, p.height))
  if (s.width === p.width && s.height === p.height) return
  commit((d) => {
    d.width = s.width
    d.height = s.height
  })
}

function RatioMenu({ onClose }: { onClose: () => void }): React.JSX.Element {
  const project = useEditor((s) => s.project)!
  const current = aspectIdOf(project.width, project.height)
  const [custom, setCustom] = useState<{ w: number; h: number } | null>(null)
  // "Original": the shape of the first video or photo on the main track.
  const firstVisual = [...project.clips]
    .sort((a, b) => a.start - b.start)
    .map((c) => project.media.find((m) => m.id === c.mediaId))
    .find((m) => m && m.kind !== 'audio' && m.width && m.height)
  const pick = (w: number, h: number): void => {
    setRatio(w, h)
    onClose()
  }
  const shape = (w: number, h: number): React.JSX.Element => {
    const k = 14 / Math.max(w, h)
    return (
      <span className="ratio-shape">
        <span style={{ width: Math.max(4, w * k), height: Math.max(4, h * k) }} />
      </span>
    )
  }
  return (
    <Menu onClose={onClose}>
      <button className="menu-item" disabled={!firstVisual} onClick={() => firstVisual && pick(firstVisual.width, firstVisual.height)}>
        <span>Original{firstVisual ? ` (${firstVisual.width}×${firstVisual.height})` : ''}</span>
      </button>
      <button className="menu-item" onClick={() => setCustom(custom ? null : { w: project.width, h: project.height })}>
        <span>Custom…</span>
      </button>
      {custom && (
        <div className="menu-custom">
          <NumberField label="W" value={custom.w} min={64} max={7680} onChange={(w) => setCustom({ ...custom, w })} />
          <NumberField label="H" value={custom.h} min={64} max={7680} onChange={(h) => setCustom({ ...custom, h })} />
          <button
            className="btn primary"
            onClick={() => {
              const even = (n: number): number => Math.max(64, Math.round(n / 2) * 2)
              commit((d) => {
                d.width = even(custom.w)
                d.height = even(custom.h)
              })
              onClose()
            }}
          >
            Set
          </button>
        </div>
      )}
      <div className="menu-sep" />
      {RATIOS.filter((r) => r.w >= r.h).map((r) => (
        <button key={r.id} className="menu-item" onClick={() => pick(r.w, r.h)}>
          <span className="menu-check">{current === r.id && <Check size={14} />}</span>
          <span>{r.id}</span>
          {shape(r.w, r.h)}
        </button>
      ))}
      <div className="menu-sep" />
      {RATIOS.filter((r) => r.w < r.h).map((r) => (
        <button key={r.id} className="menu-item" onClick={() => pick(r.w, r.h)}>
          <span className="menu-check">{current === r.id && <Check size={14} />}</span>
          <span>{r.id}</span>
          {shape(r.w, r.h)}
        </button>
      ))}
    </Menu>
  )
}

/** Areas that the social apps' own buttons and captions cover (approximate, for 9:16 and 16:9). */
function SafeZones({ portrait }: { portrait: boolean }): React.JSX.Element {
  return (
    <div className="safe-zones">
      {portrait ? (
        <>
          <div className="sz" style={{ left: 0, right: 0, top: 0, height: '9%' }} />
          <div className="sz" style={{ left: 0, right: 0, bottom: 0, height: '22%' }}>
            <span>Captions & buttons</span>
          </div>
          <div className="sz" style={{ right: 0, top: '9%', bottom: '22%', width: '14%' }} />
          <div className="sz-safe" style={{ left: '4%', right: '14%', top: '9%', bottom: '22%' }} />
        </>
      ) : (
        <div className="sz-safe" style={{ left: '5%', right: '5%', top: '5%', bottom: '5%' }} />
      )}
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
  const [guides, setGuides] = useState<{ v: number[]; h: number[] } | null>(null)
  const project = useEditor((s) => s.project)!
  const selection = useEditor((s) => s.selection)
  const playhead = useEditor((s) => s.playhead)
  const playing = useEditor((s) => s.playing)
  if (playing || selection.length !== 1) return null
  const clip = project.clips.find((c) => c.id === selection[0])
  if (!clip || playhead < clip.start || playhead >= clipEnd(clip)) return null
  const m = project.media.find((x) => x.id === clip.mediaId)
  const track = project.tracks.find((t) => t.id === clip.trackId)
  if ((!m && !clip.text) || m?.kind === 'audio' || track?.hidden || clip.adjustment || clip.effect) return null
  const locked = isClipLocked(project, clip)

  // Where the clip is right now (keyframes included); dragging writes keyframes when animated.
  const tau = Math.max(0, playhead - clip.start)
  const tr = {
    x: propAt(clip, 'x', tau),
    y: propAt(clip, 'y', tau),
    scale: propAt(clip, 'scale', tau),
    rotation: propAt(clip, 'rotation', tau)
  }
  const fit = clip.text ? measureTextClip(clip.text, project.width) : fitSize(m!.width, m!.height, project.width, project.height)
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
    // Half size of the clip in project pixels, for snapping its edges.
    const hw = (fit.w * tr.scale) / 2
    const hh = (fit.h * tr.scale) / 2
    const PW = project.width / 2
    const PH = project.height / 2
    const move = (ev: PointerEvent): void => {
      let nx = ox + (ev.clientX - sx) / scale
      let ny = oy + (ev.clientY - sy) / scale
      const g: { v: number[]; h: number[] } = { v: [], h: [] }
      if (!ev.altKey) {
        // Snap the clip's centre or edges to the frame's centre lines and edges (Alt = no snapping).
        const tol = 7 / scale
        const snap = (pos: number, half: number, frameHalf: number, out: number[]): number => {
          const options: [number, number][] = [
            [0, 0], // centre on centre
            [-frameHalf + half, -frameHalf], // left / top edge on the frame edge
            [frameHalf - half, frameHalf], // right / bottom edge on the frame edge
            [-half, 0], // an edge on the centre line
            [half, 0]
          ]
          let best: [number, number] | null = null
          for (const o of options) if (Math.abs(pos - o[0]) < tol && (!best || Math.abs(pos - o[0]) < Math.abs(pos - best[0]))) best = o
          if (!best) return pos
          out.push(best[1])
          return best[0]
        }
        nx = snap(nx, hw, PW, g.v)
        ny = snap(ny, hh, PH, g.h)
      }
      setGuides(g)
      setAnimatedValues(clip.id, { x: Math.round(nx), y: Math.round(ny) }, tau, key)
    }
    const up = (): void => {
      setGuides(null)
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
      setAnimated(clip.id, 'scale', tau, Math.round(ns * 1000) / 1000, key)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <>
      {guides && (
        <>
          {/* faint centre lines while dragging, bright where the clip snapped */}
          <div className={`guide v ${guides.v.includes(0) ? 'on' : ''}`} style={{ left: (project.width / 2) * scale }} />
          <div className={`guide h ${guides.h.includes(0) ? 'on' : ''}`} style={{ top: (project.height / 2) * scale }} />
          {guides.v
            .filter((v) => v !== 0)
            .map((v) => (
              <div key={'v' + v} className="guide v on edge" style={{ left: (project.width / 2 + v) * scale }} />
            ))}
          {guides.h
            .filter((v) => v !== 0)
            .map((v) => (
              <div key={'h' + v} className="guide h on edge" style={{ top: (project.height / 2 + v) * scale }} />
            ))}
        </>
      )}
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
    </>
  )
}
