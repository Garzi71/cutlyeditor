import { useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Info, Upload, X } from 'lucide-react'
import { player } from './engine/player'
import {
  deleteSelection, duplicateSelection, importPaths, openProjectFile, redo, saveProject, splitAt, undo, useEditor
} from './store'
import { isTyping } from './lib/util'
import Welcome from './components/Welcome'
import TopBar, { confirmDiscard } from './components/TopBar'
import MediaPanel from './components/MediaPanel'
import Preview from './components/Preview'
import Inspector from './components/Inspector'
import Timeline from './components/Timeline'
import ExportDialog from './components/ExportDialog'
import UpdateBanner from './components/UpdateBanner'
import ConfirmHost, { askConfirm } from './components/ConfirmDialog'
import { projectDuration } from '@shared/types'

export default function App(): React.JSX.Element {
  const hasProject = useEditor((s) => !!s.project)
  const exportOpen = useEditor((s) => s.exportOpen)
  useShortcuts()
  const dragging = useFileDrop(hasProject)

  useEffect(
    () =>
      window.api.onCloseRequest(async () => {
        if (
          useEditor.getState().exportOpen &&
          !(await askConfirm({ title: 'Close Cutly?', message: 'An export may still be running.', confirmLabel: 'Close', danger: true }))
        )
          return
        if (await confirmDiscard()) window.api.confirmClose()
      }),
    []
  )

  return (
    <>
      {hasProject ? (
        <div className="app">
          <TopBar />
          <Workspace />
        </div>
      ) : (
        <Welcome />
      )}
      {exportOpen && <ExportDialog />}
      {dragging && (
        <div className="drop-overlay">
          <div className="drop-card">
            <Upload size={28} />
            <b>Drop files to import</b>
            <span>Videos, photos and audio</span>
          </div>
        </div>
      )}
      <UpdateBanner />
      <Toasts />
      <ConfirmHost />
    </>
  )
}

function Workspace(): React.JSX.Element {
  // Default timeline height follows the window (about a third of it); a dragged size is remembered.
  const [tlHeight, setTlHeight] = useState(
    () => Number(localStorage.getItem('tlHeight')) || Math.round(Math.min(420, Math.max(200, window.innerHeight * 0.36)))
  )
  const ref = useRef<HTMLDivElement>(null)

  const startResize = (e: React.PointerEvent): void => {
    const sy = e.clientY
    const h0 = tlHeight
    const max = (ref.current?.clientHeight ?? 800) - 260
    const move = (ev: PointerEvent): void => setTlHeight(Math.max(170, Math.min(max, h0 - (ev.clientY - sy))))
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setTlHeight((h) => {
        localStorage.setItem('tlHeight', String(h))
        return h
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="workspace" ref={ref} style={{ gridTemplateRows: `minmax(0, 1fr) 6px min(${tlHeight}px, 44vh)` }}>
      <div className="upper">
        <MediaPanel />
        <Preview />
        <Inspector />
      </div>
      <div className="splitter" onPointerDown={startResize} />
      <Timeline />
    </div>
  )
}

function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const st = useEditor.getState()
      const ctrl = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (ctrl && k === 's') {
        e.preventDefault()
        if (st.project) saveProject(e.shiftKey)
        return
      }
      if (ctrl && k === 'o') {
        e.preventDefault()
        confirmDiscard().then((ok) => {
          if (ok) openProjectFile()
        })
        return
      }
      if (!st.project || isTyping() || st.exportOpen) return
      if (ctrl && k === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if ((ctrl && k === 'y') || (ctrl && e.shiftKey && k === 'z')) {
        e.preventDefault()
        redo()
      } else if (ctrl && k === 'd') {
        e.preventDefault()
        duplicateSelection()
      } else if (ctrl && k === 'e') {
        e.preventDefault()
        useEditor.setState({ exportOpen: true })
      } else if ((ctrl && k === 'b') || (!ctrl && k === 's')) {
        e.preventDefault()
        splitAt(st.playhead)
      } else if (e.key === ' ') {
        e.preventDefault()
        player.toggle()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteSelection()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        player.step(e.shiftKey ? -st.project.fps : -1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        player.step(e.shiftKey ? st.project.fps : 1)
      } else if (e.key === 'Home') {
        player.seek(0)
      } else if (e.key === 'End') {
        player.seek(projectDuration(st.project))
      } else if (e.key === 'Escape') {
        useEditor.setState({ selection: [] })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** Files dropped anywhere on the window are imported into the media library. */
function useFileDrop(enabled: boolean): boolean {
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes('Files')
    const enter = (e: DragEvent): void => {
      if (!hasFiles(e) || !enabled) return
      depth++
      setDragging(true)
    }
    const leave = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const over = (e: DragEvent): void => {
      if (hasFiles(e)) e.preventDefault()
    }
    const drop = (e: DragEvent): void => {
      depth = 0
      setDragging(false)
      if (!hasFiles(e)) return
      e.preventDefault()
      if (!enabled) return
      const paths = Array.from(e.dataTransfer!.files).map((f) => window.api.pathForFile(f)).filter(Boolean)
      if (paths.length) importPaths(paths)
    }
    // Capture phase for enter/leave so the overlay works everywhere; drop bubbles so the timeline can handle it first.
    window.addEventListener('dragenter', enter, true)
    window.addEventListener('dragleave', leave, true)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    const reset = (): void => {
      depth = 0
      setDragging(false)
    }
    window.addEventListener('drop', reset, true)
    return () => {
      window.removeEventListener('dragenter', enter, true)
      window.removeEventListener('dragleave', leave, true)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
      window.removeEventListener('drop', reset, true)
    }
  }, [enabled])
  return dragging
}

function Toasts(): React.JSX.Element {
  const toasts = useEditor((s) => s.toasts)
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === 'error' ? <AlertCircle size={16} /> : t.kind === 'success' ? <CheckCircle2 size={16} /> : <Info size={16} />}
          <span>{t.text}</span>
          {t.kind === 'error' && (
            <button
              className="icon-btn sm"
              title="Dismiss"
              aria-label="Dismiss"
              onClick={() => useEditor.setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) }))}
            >
              <X size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
