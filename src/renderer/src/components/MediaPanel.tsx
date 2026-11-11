// Left panel: tab rail (Media, Audio, Text, ...) and the media library.
import { useState } from 'react'
import {
  AudioLines, Blend, Film, Image as ImageIcon, Loader2, Music, Palette, Plus, Sparkles, Trash2, Type, Upload
} from 'lucide-react'
import type { Clip, MediaItem } from '@shared/types'
import { addClip, importPaths, removeMedia, useEditor } from '../store'
import { formatShort, mediaUrl } from '../lib/util'
import TextPanel from './TextPanel'
import FiltersPanel from './FiltersPanel'
import { EffectsPanel, TransitionsPanel } from './FxPanels'

const EMPTY_MEDIA: MediaItem[] = []
const EMPTY_CLIPS: Clip[] = []

type Tab = 'media' | 'audio' | 'text' | 'effects' | 'transitions' | 'filters'

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'media', label: 'Media', icon: Film },
  { id: 'audio', label: 'Audio', icon: Music },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'effects', label: 'Effects', icon: Sparkles },
  { id: 'transitions', label: 'Transitions', icon: Blend },
  { id: 'filters', label: 'Filters', icon: Palette }
]

const COMING: Record<string, { phase: number; title: string; text: string }> = {}

export default function MediaPanel(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('media')
  return (
    <div className="panel assets">
      <div className="rail">
        {TABS.map((t) => (
          <button key={t.id} className={`rail-btn ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            <t.icon size={19} />
            {t.label}
          </button>
        ))}
      </div>
      <div className="assets-main">
        {tab === 'media' && <Library filter={(m) => m.kind !== 'audio'} title="Media" />}
        {tab === 'audio' && <Library filter={(m) => m.kind === 'audio'} title="Audio" />}
        {tab === 'text' && <TextPanel />}
        {tab === 'filters' && <FiltersPanel />}
        {tab === 'effects' && <EffectsPanel />}
        {tab === 'transitions' && <TransitionsPanel />}
        {COMING[tab] && (
          <div className="soon">
            <span className="pill">Phase {COMING[tab].phase}</span>
            <h3>{COMING[tab].title}</h3>
            {COMING[tab].text}
          </div>
        )}
      </div>
    </div>
  )
}

async function pickAndImport(): Promise<void> {
  const paths = await window.api.openMediaDialog()
  if (paths.length) await importPaths(paths)
}

function Library({ filter, title }: { filter: (m: MediaItem) => boolean; title: string }): React.JSX.Element {
  const media = useEditor((s) => s.project?.media ?? EMPTY_MEDIA)
  const clips = useEditor((s) => s.project?.clips ?? EMPTY_CLIPS)
  const importing = useEditor((s) => s.importing)
  const [drag, setDrag] = useState(false)
  const items = media.filter(filter)
  const used = new Set(clips.map((c) => c.mediaId))

  return (
    <>
      <div className="panel-header">
        {title}
        {importing > 0 && (
          <span className="hint" style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
            <Loader2 size={14} className="spin" /> Importing…
          </span>
        )}
      </div>
      <div className="panel-body">
        <button
          className={`import-btn ${drag ? 'drag' : ''}`}
          onClick={pickAndImport}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) {
              e.preventDefault()
              setDrag(true)
            }
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={() => setDrag(false)}
        >
          <Upload size={20} />
          <div style={{ textAlign: 'left' }}>
            <b>Import</b>
            <span className="hint">Click or drop video, audio and images</span>
          </div>
        </button>
        {items.length === 0 ? (
          <div className="empty">
            {title === 'Audio' ? <AudioLines size={28} /> : <Film size={28} />}
            <div>
              {title === 'Audio' ? 'Imported music and sounds show up here.' : 'Your imported videos and photos show up here.'}
            </div>
          </div>
        ) : (
          <div className="media-grid">
            {items.map((m) => (
              <MediaCard key={m.id} m={m} used={used.has(m.id)} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function MediaCard({ m, used }: { m: MediaItem; used: boolean }): React.JSX.Element {
  const assets = useEditor((s) => s.assets[m.id])
  const thumb = assets?.thumbnails[Math.floor((assets.thumbnails.length - 1) / 3)]
  const KindIcon = m.kind === 'video' ? Film : m.kind === 'audio' ? Music : ImageIcon

  return (
    <div
      className="media-card"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-cutly-media', m.id)
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onDoubleClick={() => addClip(m.id)}
      title={`${m.name}\n${m.kind === 'audio' ? '' : `${m.width}×${m.height}  `}Double-click or drag to the timeline`}
    >
      <div className="media-thumb">
        {thumb ? (
          <img src={mediaUrl(thumb)} alt="" />
        ) : assets?.loading ? (
          <Loader2 size={18} className="spin" />
        ) : (
          <KindIcon size={24} />
        )}
        {used && <div className="media-used" title="Used in the timeline" />}
        <div className="media-kind">
          <KindIcon size={12} />
        </div>
        {m.kind !== 'image' && <div className="media-badge">{formatShort(m.duration)}</div>}
        <div className="media-actions">
          <button title="Add to timeline at the playhead" onClick={() => addClip(m.id)}>
            <Plus size={14} />
          </button>
          <button
            className="del"
            title="Remove from project"
            onClick={() => {
              if (!used || confirm(`"${m.name}" is used in the timeline. Remove it and its clips?`)) removeMedia(m.id)
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      <div className="media-name">{m.name}</div>
    </div>
  )
}
