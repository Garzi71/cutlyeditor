import { useState } from 'react'
import { FolderOpen, Home, LayoutTemplate, Save, Scissors, Upload } from 'lucide-react'
import { SaveTemplateDialog } from './Templates'
import { closeProject, commit, openProjectFile, saveProject, useEditor } from '../store'
import { askConfirm } from './ConfirmDialog'

export async function confirmDiscard(): Promise<boolean> {
  if (!useEditor.getState().dirty) return true
  return askConfirm({
    title: 'Discard unsaved changes?',
    message: 'Your latest edits to this project have not been saved.',
    confirmLabel: 'Discard',
    danger: true
  })
}

export default function TopBar(): React.JSX.Element {
  const name = useEditor((s) => s.project?.name ?? '')
  const dirty = useEditor((s) => s.dirty)
  const [tplOpen, setTplOpen] = useState(false)
  return (
    <div className="topbar">
      <div className="logo">
        <div className="logo-mark">
          <Scissors size={13} strokeWidth={2.5} />
        </div>
        Cutly
      </div>
      <div className="sep" />
      <button
        className="icon-btn"
        title="Home (back to the start screen)"
        onClick={async () => (await confirmDiscard()) && closeProject()}
      >
        <Home size={16} />
      </button>
      <button
        className="icon-btn"
        title="Open project (Ctrl+O)"
        onClick={async () => (await confirmDiscard()) && openProjectFile()}
      >
        <FolderOpen size={16} />
      </button>
      <button className="icon-btn" title="Save (Ctrl+S)" onClick={() => saveProject()}>
        <Save size={16} />
      </button>
      <button className="icon-btn" title="Save as template (reuse this layout in new projects)" onClick={() => setTplOpen(true)}>
        <LayoutTemplate size={16} />
      </button>
      {tplOpen && <SaveTemplateDialog onClose={() => setTplOpen(false)} />}
      <div className="spacer" />
      <div className="topbar-center">
        <input
          className="project-name"
          value={name}
          spellCheck={false}
          onChange={(e) => commit((d) => void (d.name = e.target.value), 'rename')}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <span className="save-state" title={dirty ? 'Press Ctrl+S to save' : undefined}>
          {dirty ? 'Unsaved' : 'Saved'}
        </span>
      </div>
      <button className="btn primary" onClick={() => useEditor.setState({ exportOpen: true })}>
        <Upload size={15} /> Export
      </button>
    </div>
  )
}
