// Templates: built-in ones, turning a project into a template, and filling a template with media.
import type { Clip, Keyframe, Project, Template, TextStyle, Track } from '@shared/types'
import { clipEnd, fitSize } from '@shared/types'
import { DEFAULT_TEXT_STYLE } from './text'
import { DEFAULT_ADJUST } from './color'

let n = 0
const id = (p: string): string => `${p}${++n}`
const T = (kind: Track['kind']): Track => ({ id: id('t'), kind, muted: false, hidden: false, locked: false })
const tf = (o: Partial<Clip['transform']> = {}): Clip['transform'] => ({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, ...o })
const kf = (t: number, v: number, ease: Keyframe['ease'] = 'easeInOut'): Keyframe => ({ t, v, ease })

function slotClip(track: Track, slot: string, start: number, dur: number, extra: Partial<Clip> = {}): Clip {
  return { id: id('c'), trackId: track.id, mediaId: slot, start, in: 0, out: dur, volume: 1, transform: tf(), ...extra }
}

function textClip(track: Track, content: string, start: number, dur: number, style: Partial<TextStyle>, extra: Partial<Clip> = {}): Clip {
  return {
    id: id('c'), trackId: track.id, mediaId: '', start, in: 0, out: dur, volume: 1, transform: tf(),
    text: { content, style: { ...DEFAULT_TEXT_STYLE, ...style } }, ...extra
  }
}

function base(name: string, description: string, w: number, h: number, slots: Template['slots']): Template {
  return { version: 1, name, description, width: w, height: h, fps: 30, background: '#000000', slots, tracks: [], clips: [] }
}

const slots = (count: number, kind: 'video' | 'image' | 'any', label = 'Clip'): Template['slots'] =>
  Array.from({ length: count }, (_, i) => ({ id: `slot${i + 1}`, kind, label: `${label} ${i + 1}` }))

function vlogIntro(): Template {
  const t = base('Vlog intro', 'Three quick shots with push transitions and a bold title.', 1920, 1080, slots(3, 'any'))
  const text = T('video')
  const main = T('video')
  t.tracks = [text, main, T('audio')]
  const d = 2.5
  t.clips = [
    slotClip(main, 'slot1', 0, d, { keyframes: { scale: [kf(0, 1.15), kf(d, 1)] } }),
    slotClip(main, 'slot2', d, d, { transitionIn: { type: 'pushLeft', duration: 0.5 } }),
    slotClip(main, 'slot3', 2 * d, d, { transitionIn: { type: 'pushLeft', duration: 0.5 }, animOut: { type: 'fade', duration: 0.6 } }),
    textClip(text, 'MY VLOG', 0.2, 2.2, { font: 'Montserrat', weight: 900, size: 150, strokeWidth: 8 }, { animIn: { type: 'pop', duration: 0.5 }, animOut: { type: 'zoomIn', duration: 0.4 } })
  ]
  return t
}

function tiktokHook(): Template {
  const t = base('TikTok hook', 'Vertical video with a hook text at the top. Add auto captions after.', 1080, 1920, slots(1, 'video', 'Video'))
  const text = T('video')
  const main = T('video')
  t.tracks = [text, main, T('audio')]
  t.clips = [
    slotClip(main, 'slot1', 0, 15),
    textClip(text, 'Wait for it…', 0, 3, { font: 'Poppins', weight: 800, size: 84, strokeWidth: 0, shadow: false, backgroundOpacity: 0.9, background: '#ffffff', color: '#111111' }, {
      transform: tf({ y: -620 }),
      animIn: { type: 'slideDown', duration: 0.4 },
      animOut: { type: 'fade', duration: 0.3 }
    })
  ]
  return t
}

function slideshow(): Template {
  const t = base('Photo slideshow', 'Six photos with a slow Ken Burns zoom and soft dissolves.', 1920, 1080, slots(6, 'image', 'Photo'))
  const text = T('video')
  const main = T('video')
  t.tracks = [text, main, T('audio')]
  const d = 3.5
  t.clips = Array.from({ length: 6 }, (_, i) =>
    slotClip(main, `slot${i + 1}`, i * d, d, {
      keyframes: {
        scale: [kf(0, i % 2 ? 1.18 : 1.02, 'linear'), kf(d, i % 2 ? 1.02 : 1.18, 'linear')],
        x: [kf(0, i % 2 ? 60 : -60, 'linear'), kf(d, i % 2 ? -60 : 60, 'linear')]
      },
      transitionIn: i ? { type: 'dissolve', duration: 0.8 } : undefined,
      animIn: i === 0 ? { type: 'fade', duration: 0.8 } : undefined,
      animOut: i === 5 ? { type: 'fade', duration: 1 } : undefined
    })
  )
  t.clips.push(textClip(text, 'Our memories', 0.4, 3, { font: 'Playfair Display', weight: 700, italic: true, size: 110, strokeWidth: 0 }, { animIn: { type: 'fade', duration: 0.8 }, animOut: { type: 'fade', duration: 0.6 } }))
  return t
}

function montage(): Template {
  const t = base('Fast montage', 'Eight quick cuts with flashes and a pulsing zoom (vertical).', 1080, 1920, slots(8, 'any'))
  const fx = T('video')
  const text = T('video')
  const main = T('video')
  t.tracks = [fx, text, main, T('audio')]
  const d = 0.7
  t.clips = Array.from({ length: 8 }, (_, i) => slotClip(main, `slot${i + 1}`, i * d, d))
  t.clips.push(textClip(text, 'MONTAGE', 0, 8 * d, { font: 'Anton', weight: 400, size: 170, color: '#ffe14d', strokeWidth: 6 }, { animIn: { type: 'zoomOut', duration: 0.4 } }))
  t.clips.push({ id: id('c'), trackId: fx.id, mediaId: '', effect: { type: 'zoomPulse', intensity: 0.5 }, start: 0, in: 0, out: 8 * d, volume: 1, transform: tf() })
  return t
}

function cinematic(): Template {
  const t = base('Cinematic', 'Three shots with a teal & orange look, vignette and an elegant title.', 1920, 1080, slots(3, 'video', 'Shot'))
  const adj = T('video')
  const text = T('video')
  const main = T('video')
  t.tracks = [text, adj, main, T('audio')]
  const d = 4
  t.clips = [
    slotClip(main, 'slot1', 0, d, { animIn: { type: 'fade', duration: 1 } }),
    slotClip(main, 'slot2', d, d, { transitionIn: { type: 'dipBlack', duration: 1 } }),
    slotClip(main, 'slot3', 2 * d, d, { transitionIn: { type: 'dipBlack', duration: 1 }, animOut: { type: 'fade', duration: 1 } }),
    {
      id: id('c'), trackId: adj.id, mediaId: '', adjustment: true, start: 0, in: 0, out: 3 * d, volume: 1, transform: tf(),
      color: { adjust: { ...DEFAULT_ADJUST, vignette: 40 }, filter: { id: 'teal-orange', intensity: 0.8 } }
    },
    textClip(text, 'The journey', 1, 2.6, { font: 'Playfair Display', weight: 400, size: 96, strokeWidth: 0, shadow: true }, {
      transform: tf({ y: 360 }),
      animIn: { type: 'blur', duration: 0.8 },
      animOut: { type: 'fade', duration: 0.6 }
    })
  ]
  return t
}

function beforeAfter(): Template {
  const t = base('Before / After', 'Two clips side by side with labels.', 1920, 1080, [
    { id: 'slot1', kind: 'any', label: 'Before' },
    { id: 'slot2', kind: 'any', label: 'After' }
  ])
  const text = T('video')
  const right = T('video')
  const left = T('video')
  t.tracks = [text, right, left, T('audio')]
  const d = 6
  t.clips = [
    slotClip(left, 'slot1', 0, d, { transform: tf({ x: -480, scale: 0.5 }) }),
    slotClip(right, 'slot2', 0, d, { transform: tf({ x: 480, scale: 0.5 }), volume: 0 }),
    textClip(text, 'BEFORE', 0, d, { font: 'Montserrat', weight: 800, size: 64, strokeWidth: 0, backgroundOpacity: 0.7 }, { transform: tf({ x: -480, y: -380 }) }),
    textClip(text, 'AFTER', 0, d, { font: 'Montserrat', weight: 800, size: 64, strokeWidth: 0, backgroundOpacity: 0.7, background: '#22d3ee', color: '#04232a' }, { transform: tf({ x: 480, y: -380 }) })
  ]
  // both labels can't share a track (they overlap), give the second one its own
  const text2 = T('video')
  t.tracks.unshift(text2)
  t.clips[t.clips.length - 1].trackId = text2.id
  return t
}

export const BUILT_IN_TEMPLATES: Template[] = [vlogIntro(), tiktokHook(), slideshow(), montage(), cinematic(), beforeAfter()]

export function templateDuration(t: Template): number {
  return t.clips.reduce((a, c) => Math.max(a, clipEnd(c)), 0)
}

/** Turn the current project into a template: every media clip becomes a slot (one per media file). */
export function projectToTemplate(p: Project, name: string, description = ''): Template {
  const slotOf = new Map<string, string>()
  const out: Template = {
    version: 1, name, description, width: p.width, height: p.height, fps: p.fps, background: p.background,
    slots: [], tracks: JSON.parse(JSON.stringify(p.tracks)), clips: []
  }
  const ordered = [...p.clips].sort((a, b) => a.start - b.start)
  for (const c of ordered) {
    const copy: Clip = JSON.parse(JSON.stringify(c))
    const m = p.media.find((x) => x.id === c.mediaId)
    if (m) {
      // Audio files (music) are not part of templates.
      if (m.kind === 'audio') continue
      if (!slotOf.has(m.id)) {
        const sid = `slot${slotOf.size + 1}`
        slotOf.set(m.id, sid)
        out.slots.push({ id: sid, kind: m.kind === 'image' ? 'image' : 'any', label: `Clip ${slotOf.size}` })
      }
      copy.mediaId = slotOf.get(m.id)!
      // Keep the clip's length, start from the beginning of whatever the user puts in.
      const len = c.out - c.in
      copy.in = 0
      copy.out = len
      delete copy.speed?.reverse
    }
    out.clips.push(copy)
  }
  return out
}

/**
 * Make a project from a template and imported media (media[i] fills slot i; reused if there are
 * fewer files than slots). Clips keep their length when the media is long enough; shorter videos
 * are used whole, and clips that followed each other on a track still follow each other.
 */
export function fillTemplate(t: Template, media: Project['media']): Project {
  const p: Project = {
    version: 1, name: t.name, width: t.width, height: t.height, fps: t.fps, background: t.background,
    media: [...media], tracks: JSON.parse(JSON.stringify(t.tracks)), clips: []
  }
  const slotIndex = new Map(t.slots.map((s, i) => [s.id, i]))
  const clips: Clip[] = JSON.parse(JSON.stringify(t.clips))
  for (const c of clips) {
    const i = slotIndex.get(c.mediaId)
    if (i === undefined) {
      if (c.text || c.adjustment || c.effect) p.clips.push(c)
      continue
    }
    const m = media[i % media.length]
    if (!m) continue
    c.mediaId = m.id
    // Full-frame slots fill the frame (like CapCut templates) whatever the shape of the media.
    if (c.transform.scale >= 0.99 && m.width && m.height) {
      const fit = fitSize(m.width, m.height, t.width, t.height)
      const cover = Math.max(t.width / fit.w, t.height / fit.h)
      c.transform.scale *= cover
      if (c.keyframes?.scale) c.keyframes.scale = c.keyframes.scale.map((k) => ({ ...k, v: k.v * cover }))
    }
    const want = c.out - c.in
    c.in = 0
    c.out = m.kind === 'image' ? want : Math.min(want, m.duration)
    p.clips.push(c)
  }
  // Re-join clips that used to touch on the same track.
  for (const track of p.tracks) {
    const orig = clips.filter((c) => c.trackId === track.id).sort((a, b) => a.start - b.start)
    const now = p.clips.filter((c) => c.trackId === track.id).sort((a, b) => a.start - b.start)
    for (let k = 1; k < now.length; k++) {
      const prevOrig = orig[k - 1]
      const curOrig = orig[k]
      if (prevOrig && curOrig && Math.abs(clipEnd(prevOrig) - curOrig.start) < 0.05) now[k].start = clipEnd(now[k - 1])
    }
  }
  return p
}
