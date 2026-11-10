import { FolderOpen, Home, Save, Scissors, Upload } from 'lucide-react'
import { closeProject, commit, openProjectFile, saveProject, useEditor } from '../store'

export async function confirmDiscard(): Promise<boolean> {
  if (!useEditor.getState().dirty) return true
  return confirm('You have unsaved changes. Discard them?')
}

export default function TopBar(): React.JSX.Element {
  const name = useEditor((s) => s.project?.name ?? '')
  const dirty = useEditor((s) => s.dirty)
  return (
    <div className="topbar">
      <div className="logo">
        <div className="logo-mark">
          <Scissors size={13} strokeWidth={2.5} />
        </div>
        Cutly
      </div>
      <div className="sep" style={{ width: 8 }} />
      <button
        className="icon-btn"
        title="Home"
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
      <div className="spacer" />
      <div className="topbar-center">
        <input
          className="project-name"
          value={name}
          spellCheck={false}
          onChange={(e) => commit((d) => void (d.name = e.target.value), 'rename')}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        {dirty && <div className="dirty-dot" title="Unsaved changes" />}
      </div>
      <button className="btn primary" onClick={() => useEditor.setState({ exportOpen: true })}>
        <Upload size={15} /> Export
      </button>
    </div>
  )
}
