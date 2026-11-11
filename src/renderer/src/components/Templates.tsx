// Templates on the start screen (use built-in or own templates) and "Save as template" in the editor.
import { useEffect, useRef, useState } from 'react'
import { FolderOpen, Film, Image as ImageIcon, LayoutTemplate, Loader2, Share2, Trash2, Upload, X } from 'lucide-react'
import type { Template, TemplateInfo } from '@shared/types'
import { importPaths, newProject, openProjectState, toast, useEditor } from '../store'
import { BUILT_IN_TEMPLATES, fillTemplate, projectToTemplate, templateDuration } from '../engine/templates'
import { formatShort } from '../lib/util'
import { askConfirm } from './ConfirmDialog'
import { sampleScenes } from './FxThumb'
import { drawTextClip } from '../engine/text'
import { ensureFont } from '../lib/fonts'

const errMsg = (e: unknown): string => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Create a project from a template with the chosen files. */
async function useTemplate(t: Template, paths: string[]): Promise<void> {
  newProject(t.name, t.width, t.height, t.fps)
  const media = (await importPaths(paths)).filter((m) => m.kind !== 'audio')
  if (!media.length) {
    toast('None of the files could be used (pick videos or photos).', 'error')
    return
  }
  openProjectState(fillTemplate(t, media), null)
  useEditor.setState({ dirty: true })
  toast(`Created from "${t.name}". Change texts and clips as you like.`, 'success')
}

/** Poster for a template: a sample picture in the template's shape with its first title drawn on it. */
function Poster({ t, index }: { t: Template; index: number }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    let cancelled = false
    const text = t.clips.filter((c) => c.text).sort((a, b) => a.start - b.start)[0]
    const draw = async (): Promise<void> => {
      if (text?.text) await ensureFont(text.text.style.font, text.text.style.weight, text.text.style.italic)
      if (cancelled) return
      const dpr = window.devicePixelRatio || 1
      const W = Math.round(cv.clientWidth * dpr)
      const H = Math.round(cv.clientHeight * dpr)
      cv.width = W
      cv.height = H
      const ctx = cv.getContext('2d')!
      const bg = ctx.createLinearGradient(0, 0, W, H)
      const hue = (index * 57 + 200) % 360
      bg.addColorStop(0, `hsl(${hue} 35% 22%)`)
      bg.addColorStop(1, `hsl(${(hue + 40) % 360} 30% 12%)`)
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, W, H)
      // The frame in the template's shape: landscape fills the tile, others sit on a blurred copy.
      const wide = t.width / t.height >= W / H - 0.05
      const k = wide ? Math.max(W / t.width, H / t.height) : Math.min(W / t.width, H / t.height)
      const fw = t.width * k
      const fh = t.height * k
      const fx = (W - fw) / 2
      const fy = (H - fh) / 2
      const scene = sampleScenes()[index % 2]
      if (!wide) {
        const bk = Math.max(W / scene.width, H / scene.height) * 1.1
        ctx.save()
        ctx.filter = `blur(${6 * dpr}px) brightness(.55)`
        ctx.drawImage(scene, (W - scene.width * bk) / 2, (H - scene.height * bk) / 2, scene.width * bk, scene.height * bk)
        ctx.restore()
      }
      const sk = Math.max(fw / scene.width, fh / scene.height)
      ctx.save()
      ctx.beginPath()
      ctx.rect(fx, fy, fw, fh)
      ctx.clip()
      ctx.drawImage(scene, fx + (fw - scene.width * sk) / 2, fy + (fh - scene.height * sk) / 2, scene.width * sk, scene.height * sk)
      if (text) {
        ctx.translate(fx, fy)
        drawTextClip(ctx, text, text.in + Math.min(1.2, (text.out - text.in) * 0.6), fw, fh, k * 1.6)
      }
      ctx.restore()
    }
    void draw()
    return () => {
      cancelled = true
    }
  }, [t, index])
  return <canvas ref={ref} />
}

export function TemplatesSection(): React.JSX.Element {
  const [own, setOwn] = useState<TemplateInfo[]>([])
  const [open, setOpen] = useState<TemplateInfo | null>(null)
  const reload = (): void => void window.api.listTemplates().then(setOwn)
  useEffect(reload, [])
  const all: TemplateInfo[] = [...BUILT_IN_TEMPLATES.map((template) => ({ path: null, template })), ...own]

  return (
    <div className="card templates-card">
      <div className="card-head">
        <h2>Templates</h2>
        <button
          className="btn ghost sm"
          onClick={async () => {
            try {
              const t = await window.api.importTemplate()
              if (t) {
                toast(`Template "${t.template.name}" added`, 'success')
                reload()
              }
            } catch (e) {
              toast(errMsg(e), 'error')
            }
          }}
        >
          <Upload size={14} /> Import
        </button>
      </div>
      <div className="poster-grid">
        {all.map((info, i) => (
          <button key={info.path ?? info.template.name} className="poster-card" title={info.template.description} onClick={() => setOpen(info)}>
            <div className="poster">
              <Poster t={info.template} index={i} />
              <span className="poster-use">Use</span>
            </div>
            <b>{info.template.name}</b>
            <small>
              {info.template.slots.length} {info.template.slots.length === 1 ? 'clip' : 'clips'} · {formatShort(templateDuration(info.template))}
              {info.path ? ' · yours' : ''}
            </small>
          </button>
        ))}
      </div>
      {open && <UseTemplateDialog info={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  )
}

function UseTemplateDialog({ info, onClose, onChanged }: { info: TemplateInfo; onClose: () => void; onChanged: () => void }): React.JSX.Element {
  const t = info.template
  const [busy, setBusy] = useState(false)
  const pick = async (): Promise<void> => {
    const paths = await window.api.openMediaDialog()
    if (!paths.length) return
    setBusy(true)
    try {
      await useTemplate(t, paths)
      onClose()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h2>{t.name}</h2>
          <button className="icon-btn" title="Close" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          <div className="modal-desc">{t.description || 'Your own template.'}</div>
          <div className="hint">
            {t.width}×{t.height} · {formatShort(templateDuration(t))} · pick {t.slots.length} {t.slots.length === 1 ? 'file' : 'files'} in this order:
          </div>
          <ol className="slot-list">
            {t.slots.map((s, i) => (
              <li key={s.id}>
                <span className="slot-num">{i + 1}</span>
                {s.kind === 'image' ? <ImageIcon size={14} /> : <Film size={14} />}
                <span className="slot-label">{s.label}</span>
                <span className="slot-kind">{s.kind === 'image' ? 'Photo' : s.kind === 'video' ? 'Video' : 'Video or photo'}</span>
              </li>
            ))}
          </ol>
          <div className="hint">Fewer files are fine: they are reused. Long videos are trimmed to fit.</div>
        </div>
        <div className="modal-foot">
          {info.path && (
            <>
              <button
                className="btn ghost danger"
                onClick={async () => {
                  if (!(await askConfirm({ title: `Delete the template "${t.name}"?`, confirmLabel: 'Delete', danger: true }))) return
                  await window.api.deleteTemplate(info.path!)
                  onChanged()
                  onClose()
                }}
              >
                <Trash2 size={14} /> Delete
              </button>
              <button className="btn ghost" onClick={() => window.api.exportTemplate(t).then((p) => p && toast('Template file saved. Send it to your friends.', 'success'))}>
                <Share2 size={14} /> Share
              </button>
            </>
          )}
          <span className="spacer" />
          <button className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy} onClick={pick}>
            {busy ? <Loader2 size={14} className="spin" /> : <FolderOpen size={14} />} Choose files…
          </button>
        </div>
      </div>
    </div>
  )
}

/** Editor: save the current project as a reusable template. */
export function SaveTemplateDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const project = useEditor((s) => s.project)!
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState('')
  const t = projectToTemplate(project, name.trim() || 'My template', description.trim())
  const save = async (share: boolean): Promise<void> => {
    try {
      if (share) {
        const p = await window.api.exportTemplate(t)
        if (!p) return
        toast('Template file saved. Send it to your friends.', 'success')
      } else {
        await window.api.saveTemplate(t)
        toast(`Saved. Find "${t.name}" under Templates on the start screen.`, 'success')
      }
      onClose()
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal sm">
        <div className="modal-head">
          <h2>Save as template</h2>
          <button className="icon-btn" title="Close" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label>Description</label>
            <input className="input" value={description} placeholder="Optional" onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="hint">
            Your {t.slots.length} video/photo {t.slots.length === 1 ? 'file becomes a slot' : 'files become slots'} to fill later. Texts, motion,
            transitions, colors and effects are kept. Music is not included.
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" disabled={!t.slots.length} onClick={() => save(true)}>
            <Share2 size={14} /> Save file to share…
          </button>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!t.slots.length} onClick={() => save(false)}>
            Save template
          </button>
        </div>
      </div>
    </div>
  )
}
