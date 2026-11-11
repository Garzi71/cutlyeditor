// Left panel: tab rail (Media, Audio, Text, ...) and the media library.
import { useState } from 'react'
import {
  AudioLines, Blend, Check, Film, Image as ImageIcon, Loader2, Music, Palette, Plus, Sparkles, Trash2, Type, Upload
} from 'lucide-react'
import type { Clip, MediaItem } from '@shared/types'
import { askConfirm } from './ConfirmDialog'
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
          className={`import-btn ${drag ? 'drag' : ''} ${items.length === 0 ? 'big' : ''}`}
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
          {items.length === 0 ? (
            <>
              <span className="import-icon">{title === 'Audio' ? <AudioLines size={26} /> : <Upload size={26} />}</span>
              <div>
                <b>{title === 'Audio' ? 'Import music and sounds' : 'Import media'}</b>
                <span className="hint">Drag files here or click to browse</span>
                <span className="hint formats">{title === 'Audio' ? 'MP3, WAV, M4A, or a video’s sound' : 'Videos, photos and audio'}</span>
              </div>
            </>
          ) : (
            <>
              <Upload size={20} />
              <div>
                <b>Import</b>
                <span className="hint">{title === 'Audio' ? 'Music and sound effects' : 'Video, audio, photos'}</span>
              </div>
            </>
          )}
        </button>
        {items.length > 0 && (
          <div className={title === 'Audio' ? 'audio-list' : 'media-grid'}>
            {items.map((m) =>
              title === 'Audio' ? <AudioRow key={m.id} m={m} used={used.has(m.id)} /> : <MediaCard key={m.id} m={m} used={used.has(m.id)} />
            )}
          </div>
        )}
      </div>
    </>
  )
}

/** Audio files as compact rows: icon, name, length, add / remove. */
function AudioRow({ m, used }: { m: MediaItem; used: boolean }): React.JSX.Element {
  return (
    <div
      className="audio-row"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-cutly-media', m.id)
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onDoubleClick={() => addClip(m.id)}
      title={`${m.name}\nDouble-click or drag to the timeline`}
    >
      <span className="audio-icon">
        <Music size={15} />
      </span>
      <span className="audio-name">{m.name}</span>
      {used && <Check size={13} className="audio-used" aria-label="Used in the timeline" />}
      <span className="audio-dur">{formatShort(m.duration)}</span>
      <div className="row-actions">
        <button className="icon-btn xs" title="Add to timeline at the playhead" onClick={() => addClip(m.id)}>
          <Plus size={14} />
        </button>
        <button
          className="icon-btn xs danger"
          title="Remove from project"
          onClick={() => {
            void removeMediaAsk(m, used)
          }}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}

async function removeMediaAsk(m: MediaItem, used: boolean): Promise<void> {
  if (
    used &&
    !(await askConfirm({
      title: `Remove "${m.name}"?`,
      message: 'It is used in the timeline. Its clips will be removed too.',
      confirmLabel: 'Remove',
      danger: true
    }))
  )
    return
  removeMedia(m.id)
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
        {used && (
          <div className="media-used" title="Used in the timeline">
            <Check size={10} strokeWidth={3} />
          </div>
        )}
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
              void removeMediaAsk(m, used)
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
