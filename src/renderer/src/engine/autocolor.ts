// One-click color: "Auto" fixes white balance, exposure and black/white points of a clip;
// "Match" makes a clip look like a reference clip. Results are written into the normal sliders
// (or the match gain/offset), so the user can fine-tune them afterwards.
import type { Clip, ColorGrade, Project } from '@shared/types'
import { DEFAULT_ADJUST, TEMP_K, TINT_G, TINT_RB, defaultGrade, pointFunction, type RGB } from './color'

const SW = 96
const SH = 54

const toLin = (x: number): number => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4))
const luma = (c: RGB): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** A few small frames spread over the clip, as RGB 0..1 pixels. */
async function samplePixels(project: Project, clip: Clip): Promise<RGB[]> {
  const m = project.media.find((x) => x.id === clip.mediaId)
  if (!m || m.kind === 'audio') throw new Error('Select a video or photo clip.')
  const times = m.kind === 'image' ? [0] : [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => clip.in + (clip.out - clip.in) * f)
  const data = await window.api.mediaSamples(m.path, times, SW, SH)
  if (!data.length) throw new Error('Could not read frames from this clip.')
  const px: RGB[] = []
  for (let i = 0; i + 2 < data.length; i += 3) px.push([data[i] / 255, data[i + 1] / 255, data[i + 2] / 255])
  return px
}

function percentile(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)))]
}

function through(g: ColorGrade, px: RGB[]): RGB[] {
  const fn = pointFunction(g)
  return fn ? px.map(fn) : px
}

export async function autoCorrect(project: Project, clip: Clip): Promise<ColorGrade> {
  const raw = await samplePixels(project, clip)
  const base: ColorGrade = JSON.parse(JSON.stringify(clip.color ?? defaultGrade()))
  // Start from the clip's look without the values auto sets.
  Object.assign(base.adjust, { exposure: 0, temperature: 0, tint: 0, blacks: 0, whites: 0 })
  let px = through(base, raw)

  // 1) White balance: grey-world on near-neutral midtones (falls back to all midtones, gently).
  //    Measured again after each step and refined, because one step under-corrects strong casts.
  const pickNeutral = (all: RGB[]): { sample: RGB[]; strength: number } => {
    const mids = all.filter((c) => {
      const l = luma(c)
      return l > 0.1 && l < 0.9
    })
    const neutral = mids.filter((c) => Math.max(...c) - Math.min(...c) < 0.2)
    return neutral.length > all.length * 0.05 ? { sample: neutral, strength: 0.9 } : { sample: mids, strength: 0.45 }
  }
  // Neutral pixels are searched again in the corrected picture each round: as the cast goes away,
  // more true greys show up. A colorful scene without greys gets only one gentle grey-world step.
  let usedFallback = false
  for (let iter = 0; iter < 5; iter++) {
    const { sample: cur, strength } = pickNeutral(through(base, raw))
    if (strength < 0.5) {
      if (usedFallback) break
      usedFallback = true
    }
    if (cur.length < 20) break
    const [R, G, B] = [0, 1, 2].map((i) => cur.reduce((a, c) => a + toLin(c[i]), 0) / cur.length)
    const dt = clamp((B - R) / (TEMP_K * (R + B)), -1, 1) * strength
    const R2 = R * (1 + TEMP_K * dt)
    const B2 = B * (1 - TEMP_K * dt)
    const M = (R2 + B2) / 2
    const dti = clamp((G - M) / (TINT_G * G + TINT_RB * M), -1, 1) * strength
    base.adjust.temperature = Math.round(clamp(base.adjust.temperature + dt * 100, -100, 100))
    base.adjust.tint = Math.round(clamp(base.adjust.tint + dti * 100, -100, 100))
    if (Math.abs(dt) < 0.02 && Math.abs(dti) < 0.02) break
  }

  // 2) Exposure: bring the median brightness towards a natural mid grey.
  px = through(base, raw)
  const med = percentile(px.map(luma), 0.5)
  if (med > 0.01) {
    const ev = clamp(Math.log2(toLin(0.46) / toLin(med)) * 0.7, -1.2, 1.2)
    base.adjust.exposure = Math.abs(ev) < 0.08 ? 0 : Math.round(ev * 100) / 100
  }

  // 3) Black and white points: deepen washed-out blacks, brighten dull whites (never the opposite).
  px = through(base, raw)
  const lums = px.map(luma)
  const lo = percentile(lums, 0.005)
  const hi = percentile(lums, 0.995)
  if (lo > 0.04) base.adjust.blacks = Math.round(clamp(((0.025 - lo) / (0.12 * Math.pow(1 - lo, 3))) * 80, -50, 0))
  if (hi < 0.94) base.adjust.whites = Math.round(clamp(((0.975 - hi) / (0.18 * Math.pow(hi, 3))) * 80, 0, 50))

  // 4) A little life for very flat footage.
  const chroma = px.reduce((a, c) => a + Math.max(...c) - Math.min(...c), 0) / px.length
  if (chroma < 0.1 && base.adjust.vibrance === 0) base.adjust.vibrance = 12
  return base
}

/** Make `target` look like `reference` (its graded look). Replaces the target's color settings. */
export async function matchColors(project: Project, reference: Clip, target: Clip): Promise<ColorGrade> {
  const ref = through(reference.color ?? defaultGrade(), await samplePixels(project, reference))
  const tgt = await samplePixels(project, target)
  const stats = (px: RGB[]): { mean: number[]; std: number[] } => {
    const mean = [0, 1, 2].map((i) => px.reduce((a, c) => a + c[i], 0) / px.length)
    const std = [0, 1, 2].map((i) => Math.sqrt(px.reduce((a, c) => a + (c[i] - mean[i]) ** 2, 0) / px.length))
    return { mean, std }
  }
  const r = stats(ref)
  const t = stats(tgt)
  const gain = [0, 1, 2].map((i) => clamp(r.std[i] / Math.max(1e-3, t.std[i]), 0.6, 1.6)) as [number, number, number]
  const offset = [0, 1, 2].map((i) => clamp(r.mean[i] - gain[i] * t.mean[i], -0.3, 0.3)) as [number, number, number]
  const prev = target.color?.adjust ?? DEFAULT_ADJUST
  return {
    adjust: { ...DEFAULT_ADJUST, sharpen: prev.sharpen, vignette: prev.vignette },
    match: { gain, offset, ref: reference.id }
  }
}
