// Templates on the start screen (use built-in or own templates) and "Save as template" in the editor.
import { useEffect, useState } from 'react'
import { Download, Film, Image as ImageIcon, LayoutTemplate, Loader2, Share2, Trash2, Upload, X } from 'lucide-react'
import type { Template, TemplateInfo } from '@shared/types'
import { importPaths, newProject, openProjectState, toast, useEditor } from '../store'
import { BUILT_IN_TEMPLATES, fillTemplate, projectToTemplate, templateDuration } from '../engine/templates'
import { formatShort } from '../lib/util'

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

function Shape({ t }: { t: Template }): React.JSX.Element {
  const s = 40 / Math.max(t.width, t.height)
  return (
    <div className="tpl-shape">
      <div style={{ width: t.width * s, height: t.height * s }} />
    </div>
  )
}

export function TemplatesSection(): React.JSX.Element {
  const [own, setOwn] = useState<TemplateInfo[]>([])
  const [open, setOpen] = useState<TemplateInfo | null>(null)
  const reload = (): void => void window.api.listTemplates().then(setOwn)
  useEffect(reload, [])
  const all: TemplateInfo[] = [...BUILT_IN_TEMPLATES.map((template) => ({ path: null, template })), ...own]

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div className="card-head">
        <h2>Templates</h2>
        <button
          className="btn ghost"
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
      <div className="tpl-grid">
        {all.map((info) => (
          <button key={info.path ?? info.template.name} className="tpl-card" onClick={() => setOpen(info)}>
            <Shape t={info.template} />
            <div style={{ minWidth: 0 }}>
              <b>{info.template.name}</b>
              <small>
                {info.template.slots.length} {info.template.slots.length === 1 ? 'clip' : 'clips'} · {formatShort(templateDuration(info.template))}
                {info.path ? ' · yours' : ''}
              </small>
            </div>
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
          <button className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          <div className="hint" style={{ fontSize: 13 }}>{t.description || 'Your own template.'}</div>
          <div className="hint">
            {t.width}×{t.height} · {formatShort(templateDuration(t))} · pick {t.slots.length} {t.slots.length === 1 ? 'file' : 'files'} in this order:
          </div>
          <ol className="slot-list">
            {t.slots.map((s) => (
              <li key={s.id}>
                {s.kind === 'image' ? <ImageIcon size={13} /> : <Film size={13} />} {s.label}
                <span className="hint">{s.kind === 'image' ? 'photo' : s.kind === 'video' ? 'video' : 'video or photo'}</span>
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
                  if (!confirm(`Delete the template "${t.name}"?`)) return
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
          <button className="btn primary" disabled={busy} onClick={pick}>
            {busy ? <Loader2 size={14} className="spin" /> : <Download size={14} />} Choose files…
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
      <div className="modal">
        <div className="modal-head">
          <h2>
            <LayoutTemplate size={16} style={{ verticalAlign: -2, marginRight: 6 }} />
            Save as template
          </h2>
          <button className="icon-btn" onClick={onClose}>
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
          <button className="btn" disabled={!t.slots.length} onClick={() => save(true)}>
            <Share2 size={14} /> Save file to share…
          </button>
          <button className="btn primary" disabled={!t.slots.length} onClick={() => save(false)}>
            Save template
          </button>
        </div>
      </div>
    </div>
  )
}
