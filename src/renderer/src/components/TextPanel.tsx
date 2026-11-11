// Left panel "Text" tab: add text with a preset style, and generate auto captions with Whisper.
import { useEffect, useState } from 'react'
import { Captions, Download, Loader2, Plus, X } from 'lucide-react'
import type { TextStyle, WhisperProgress, WhisperStatus } from '@shared/types'
import { projectDuration } from '@shared/types'
import { addCaptions, addTextClip, toast, useEditor } from '../store'
import { DEFAULT_TEXT_STYLE } from '../engine/text'
import { CAPTION_TEMPLATES, LANGUAGES, TEXT_PRESETS, groupWords, lineCharsFor, templateStyle, type CaptionTemplate } from '../engine/captions'
import CaptionTemplates from './CaptionTemplates'

const mb = (n: number): string => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${Math.round(n / 1e6)} MB`)

function load<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback
  } catch {
    return fallback
  }
}

export default function TextPanel(): React.JSX.Element {
  const project = useEditor((s) => s.project)!
  const scale = Math.min(project.width, project.height) / 1080

  const add = (style: Partial<TextStyle>): void => {
    const full: TextStyle = { ...DEFAULT_TEXT_STYLE, ...style }
    full.size = Math.round((style.size ?? DEFAULT_TEXT_STYLE.size) * scale)
    full.strokeWidth = Math.round(full.strokeWidth * scale)
    addTextClip({ content: 'Your text', style: full })
  }

  const [tab, setTab] = useState<'text' | 'captions'>(() => load('textTab', 'text'))
  useEffect(() => {
    try {
      localStorage.setItem('textTab', tab)
    } catch {
      /* ignore */
    }
  }, [tab])

  const addAnimated = (t: CaptionTemplate): void => {
    const { style } = templateStyle(t, project.width, project.height)
    addTextClip({ content: 'Your text here', style })
  }

  return (
    <>
      <div className="panel-header">
        <div className="panel-tabs">
          <button className={tab === 'text' ? 'active' : ''} onClick={() => setTab('text')}>
            Text
          </button>
          <button className={tab === 'captions' ? 'active' : ''} onClick={() => setTab('captions')}>
            Auto captions
          </button>
        </div>
      </div>
      <div className="panel-body">
        {tab === 'text' ? (
          <>
            <button className="import-btn" onClick={() => add({})}>
              <Plus size={18} />
              <div>
                <b>Add text</b>
                <span className="hint">At the playhead, on its own track</span>
              </div>
            </button>
            <div className="sub-head">Styles</div>
            <div className="preset-grid">
              {TEXT_PRESETS.map((p) => (
                <button key={p.name} className="preset" title={p.name} onClick={() => add(p.style)}>
                  <PresetSample style={{ ...DEFAULT_TEXT_STYLE, ...p.style }} label={p.name} />
                </button>
              ))}
            </div>
            <div className="sub-head">Animated</div>
            <div className="panel-pad">
              <CaptionTemplates onPick={addAnimated} />
            </div>
          </>
        ) : (
          <AutoCaptions />
        )}
      </div>
    </>
  )
}

function PresetSample({ style: s, label }: { style: TextStyle; label: string }): React.JSX.Element {
  return (
    <span
      style={{
        fontFamily: `"${s.font}"`,
        fontWeight: s.weight,
        fontStyle: s.italic ? 'italic' : 'normal',
        textTransform: s.uppercase ? 'uppercase' : 'none',
        color: s.color,
        fontSize: 14,
        maxWidth: '100%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        padding: s.backgroundOpacity > 0 ? '2px 8px' : 0,
        borderRadius: 4,
        background: s.backgroundOpacity > 0 ? hexAlpha(s.background, s.backgroundOpacity) : 'transparent',
        WebkitTextStroke: s.strokeWidth > 0 ? `${Math.min(3, s.strokeWidth / 3)}px ${s.stroke}` : undefined,
        paintOrder: 'stroke fill',
        textShadow: s.shadow ? '0 2px 6px rgba(0,0,0,.6)' : 'none'
      }}
    >
      {label}
    </span>
  )
}

function hexAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

type Phase = 'idle' | 'confirm' | 'working'

function AutoCaptions(): React.JSX.Element {
  const project = useEditor((s) => s.project)!
  const [language, setLanguage] = useState<string>(() => load('capLang', 'auto'))
  const [tplId, setTplId] = useState<string>(() => load('capTemplate', 'karaoke'))
  const tpl = CAPTION_TEMPLATES.find((t) => t.id === tplId) ?? CAPTION_TEMPLATES[0]
  const [status, setStatus] = useState<WhisperStatus | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [useGpu, setUseGpu] = useState(true)
  const [progress, setProgress] = useState<WhisperProgress | null>(null)
  const hasAudio = project.clips.some((c) => {
    const m = project.media.find((x) => x.id === c.mediaId)
    return m && (m.kind === 'audio' || m.hasAudio)
  })

  useEffect(() => {
    window.api.whisperStatus().then((s) => {
      setStatus(s)
      setUseGpu(s.nvidia)
    })
    return window.api.onWhisperProgress(setProgress)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('capLang', language)
      localStorage.setItem('capTemplate', tplId)
    } catch {
      /* ignore */
    }
  }, [language, tplId])

  const ready = !!status && status.cpuEngine && status.model
  const needGpuDownload = !!status && status.nvidia && useGpu && !status.gpuEngine
  const downloadSize = status
    ? (status.cpuEngine ? 0 : status.sizes.cpu) + (status.model ? 0 : status.sizes.model) + (needGpuDownload ? status.sizes.gpu : 0)
    : 0

  const generate = async (): Promise<void> => {
    if (!ready || needGpuDownload) {
      setPhase('confirm')
      return
    }
    await transcribe()
  }

  const transcribe = async (): Promise<void> => {
    const p = useEditor.getState().project!
    if (projectDuration(p) <= 0) return
    setPhase('working')
    setProgress({ stage: 'audio', label: 'Preparing audio…', percent: 0 })
    try {
      const words = await window.api.whisperTranscribe(p, { language, useGpu: useGpu && !!status?.gpuEngine })
      if (!words.length) {
        toast('No speech was found in the timeline audio.', 'info')
      } else {
        const chunks = groupWords(words, tpl.group, lineCharsFor(p.width, p.height))
        const { style, y } = templateStyle(tpl, p.width, p.height)
        addCaptions(chunks, style, y)
        toast(`Added ${chunks.length} captions (${words.length} words). Click one to change the style.`, 'success')
      }
    } catch (e) {
      const msg = (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      if (!/abort|killed|SIGTERM/i.test(msg)) toast(`Captions failed: ${msg}`, 'error')
    } finally {
      setPhase('idle')
      setProgress(null)
    }
  }

  const downloadAndRun = async (): Promise<void> => {
    setPhase('working')
    setProgress({ stage: 'download', label: 'Starting download…', percent: 0 })
    try {
      await window.api.whisperDownload(needGpuDownload)
      const s = await window.api.whisperStatus()
      setStatus(s)
      toast('Speech recognition is ready', 'success')
    } catch (e) {
      const msg = (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      if (!/abort/i.test(msg)) toast(`Download failed: ${msg}`, 'error')
      setPhase('idle')
      setProgress(null)
      return
    }
    await transcribe()
  }

  return (
    <>
      <p className="hint panel-intro">Turns the speech in your timeline into captions, word by word. Runs offline on your computer.</p>
      <div className="sub-head">Style</div>
      <div className="panel-pad">
        <CaptionTemplates selected={tpl.id} onPick={(t) => setTplId(t.id)} />
      </div>
      <div className="sticky-foot">
        {phase === 'confirm' && status && (
          <div className="confirm-box">
            <b>Download speech recognition?</b>
            <div className="hint">
              It runs on your computer, works offline and is free. This is a one-time download of {mb(downloadSize)}:
            </div>
            <ul className="dl-list">
              {!status.cpuEngine && <li>Speech engine · {mb(status.sizes.cpu)}</li>}
              {!status.model && <li>Language model (Whisper large-v3-turbo) · {mb(status.sizes.model)}</li>}
              {needGpuDownload && <li>NVIDIA GPU acceleration · {mb(status.sizes.gpu)}</li>}
            </ul>
            <div className="btn-row" style={{ marginBottom: 0 }}>
              <button className="btn primary" onClick={downloadAndRun}>
                <Download size={14} /> Download
              </button>
              <button className="btn" onClick={() => setPhase('idle')}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {phase === 'working' && progress ? (
          <div>
            <div className="cap-progress-label">
              <span>
                <Loader2 size={13} className="spin" /> {progress.label}
              </span>
              <span>{Math.round(progress.percent)} %</span>
            </div>
            <div className="progress">
              <div style={{ width: `${progress.percent}%` }} />
            </div>
            <button className="btn block" style={{ marginTop: 10 }} onClick={() => window.api.whisperCancel()}>
              <X size={14} /> Cancel
            </button>
          </div>
        ) : (
          phase === 'idle' && (
            <>
              <div className="foot-row">
                <select className="input" value={language} title="Spoken language" onChange={(e) => setLanguage(e.target.value)}>
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
                {status?.nvidia && (
                  <label className="check-row" title="Use the NVIDIA graphics card (much faster)">
                    <input type="checkbox" checked={useGpu} onChange={(e) => setUseGpu(e.target.checked)} />
                    GPU
                  </label>
                )}
              </div>
              <button className="btn primary block" disabled={!hasAudio || !status} onClick={generate}>
                <Captions size={15} /> Generate captions
              </button>
              {!hasAudio && <div className="hint">Add a video or audio with speech to the timeline first.</div>}
            </>
          )
        )}
      </div>
    </>
  )
}
