// Left panel "Filters" tab: looks applied to the selected clip (or as an adjustment layer), LUT import.
import { useEffect, useState } from 'react'
import { SlidersHorizontal, Upload } from 'lucide-react'
import type { Clip, ColorGrade } from '@shared/types'
import { addAdjustmentLayer, setClipColor, useEditor } from '../store'
import { DEFAULT_ADJUST, defaultGrade, pointFunction } from '../engine/color'
import { FILTERS, type FilterPreset } from '../engine/filters'
import { mediaUrl } from '../lib/util'
import { importLutInto } from './ColorInspector'

/** The clip filters apply to: a selected video/photo clip or adjustment layer. */
function useTargetClip(): Clip | undefined {
  return useEditor((s) => {
    if (s.selection.length !== 1 || !s.project) return undefined
    const c = s.project.clips.find((x) => x.id === s.selection[0])
    if (!c || c.text) return undefined
    if (c.adjustment) return c
    const m = s.project.media.find((x) => x.id === c.mediaId)
    return m && m.kind !== 'audio' ? c : undefined
  })
}

export default function FiltersPanel(): React.JSX.Element {
  const target = useTargetClip()
  const thumb = useEditor((s) => {
    const p = s.project
    if (!p) return undefined
    const c = target ?? p.clips.find((x) => p.media.find((m) => m.id === x.mediaId && m.kind !== 'audio'))
    const a = c ? s.assets[c.mediaId] : undefined
    return a?.thumbnails[Math.floor(a.thumbnails.length / 2)]
  })
  const active = target?.color?.filter?.id

  const apply = (f: FilterPreset): void => {
    if (target) {
      const g: ColorGrade = structuredClone(target.color ?? defaultGrade())
      if (g.filter?.id === f.id) delete g.filter
      else g.filter = { id: f.id, intensity: g.filter?.intensity ?? 1 }
      setClipColor(target.id, g)
    } else {
      addAdjustmentLayer({ ...defaultGrade(), filter: { id: f.id, intensity: 1 } })
    }
  }

  const groups = [...new Set(FILTERS.map((f) => f.group))]
  return (
    <>
      <div className="panel-header">Filters</div>
      <div className="panel-body">
        <div className="filter-target">
          {target ? (
            <>Applies to the selected {target.adjustment ? 'adjustment layer' : 'clip'}. Click again to remove.</>
          ) : (
            <>Nothing selected: a filter is added as an adjustment layer over everything below it.</>
          )}
        </div>
        <div className="btn-row" style={{ padding: '0 12px 4px' }}>
          <button className="btn" onClick={() => addAdjustmentLayer(defaultGrade())}>
            <SlidersHorizontal size={14} /> Adjustment layer
          </button>
          <button className="btn" onClick={() => importLutInto(target?.id ?? null, (g) => addAdjustmentLayer(g))}>
            <Upload size={14} /> Import LUT
          </button>
        </div>
        {groups.map((group) => (
          <div key={group}>
            <div className="sub-head">{group}</div>
            <div className="filter-grid">
              {FILTERS.filter((f) => f.group === group).map((f) => (
                <button key={f.id} className={`filter-card ${active === f.id ? 'active' : ''}`} onClick={() => apply(f)}>
                  <FilterThumb filter={f} thumb={thumb} />
                  <span>{f.name}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

const previewCache = new Map<string, string>()
let sampleImage: HTMLCanvasElement | null = null

/** Colorful gradient used when the project has no clip yet. */
function fallbackSample(): HTMLCanvasElement {
  if (sampleImage) return sampleImage
  const c = document.createElement('canvas')
  c.width = 96
  c.height = 54
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 96, 54)
  g.addColorStop(0, '#f4a261')
  g.addColorStop(0.45, '#e9c46a')
  g.addColorStop(0.7, '#2a9d8f')
  g.addColorStop(1, '#264653')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 96, 54)
  sampleImage = c
  return c
}

function FilterThumb({ filter, thumb }: { filter: FilterPreset; thumb?: string }): React.JSX.Element {
  const key = `${thumb ?? 'sample'}|${filter.id}`
  const [url, setUrl] = useState(previewCache.get(key))
  useEffect(() => {
    if (previewCache.has(key)) return setUrl(previewCache.get(key))
    let cancelled = false
    const render = (src: CanvasImageSource): void => {
      const c = document.createElement('canvas')
      c.width = 96
      c.height = 54
      const ctx = c.getContext('2d')!
      ctx.drawImage(src, 0, 0, 96, 54)
      const img = ctx.getImageData(0, 0, 96, 54)
      const fn = pointFunction({ adjust: { ...DEFAULT_ADJUST }, filter: { id: filter.id, intensity: 1 } })!
      for (let i = 0; i < img.data.length; i += 4) {
        const o = fn([img.data[i] / 255, img.data[i + 1] / 255, img.data[i + 2] / 255])
        img.data[i] = o[0] * 255
        img.data[i + 1] = o[1] * 255
        img.data[i + 2] = o[2] * 255
      }
      ctx.putImageData(img, 0, 0)
      const u = c.toDataURL('image/jpeg', 0.8)
      previewCache.set(key, u)
      if (!cancelled) setUrl(u)
    }
    if (thumb) {
      const im = new Image()
      im.crossOrigin = 'anonymous'
      im.onload = () => render(im)
      im.onerror = () => render(fallbackSample())
      im.src = mediaUrl(thumb)
    } else render(fallbackSample())
    return () => {
      cancelled = true
    }
  }, [key, filter.id, thumb])
  return <div className="filter-thumb">{url && <img src={url} alt="" />}</div>
}
