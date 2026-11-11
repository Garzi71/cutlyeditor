// Color math. Every per-pixel color operation (match, LUT file, filter, light/color sliders, HSL,
// curves) is baked into one 3D LUT. The preview applies it on the GPU (gl.ts), the export writes the
// same table as a .cube file for ffmpeg's lut3d — so both use identical numbers.
import type { ColorAdjust, ColorGrade, CurvePoints, HslBand } from '@shared/types'
import { HSL_BANDS } from '@shared/types'
import { FILTERS } from './filters'

export type RGB = [number, number, number]

export const DEFAULT_ADJUST: ColorAdjust = {
  exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  temperature: 0, tint: 0, saturation: 0, vibrance: 0, sharpen: 0, vignette: 0
}

export const IDENTITY_CURVE: CurvePoints = [[0, 0], [1, 1]]

export function defaultGrade(): ColorGrade {
  return { adjust: { ...DEFAULT_ADJUST } }
}

const POINT_KEYS: (keyof ColorAdjust)[] = [
  'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'temperature', 'tint', 'saturation', 'vibrance'
]

const curveIsIdentity = (c?: CurvePoints): boolean =>
  !c || (c.length === 2 && c[0][0] === 0 && c[0][1] === 0 && c[1][0] === 1 && c[1][1] === 1)

/** True when the grade changes pixel colors (i.e. a LUT is needed). */
export function hasPointOps(g?: ColorGrade): boolean {
  if (!g) return false
  if (POINT_KEYS.some((k) => g.adjust[k] !== 0)) return true
  if (g.curves && !(['master', 'r', 'g', 'b'] as const).every((k) => curveIsIdentity(g.curves![k]))) return true
  if (g.hsl && Object.values(g.hsl).some((v) => v && (v.h || v.s || v.l))) return true
  if (g.filter && g.filter.intensity > 0) return true
  if (g.lut && g.lut.intensity > 0) return true
  if (g.match) return true
  return false
}

export function gradeIsActive(g?: ColorGrade): boolean {
  return !!g && (hasPointOps(g) || g.adjust.sharpen > 0 || g.adjust.vignette > 0)
}

// ---------- building blocks ----------

/** Strength of the Temperature / Tint sliders at ±100 (linear-light channel gains). */
export const TEMP_K = 0.4
export const TINT_G = 0.3
export const TINT_RB = 0.12

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
const toLin = (x: number): number => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4))
const toSrgb = (x: number): number => (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055)
const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b

function tone(x: number, a: ColorAdjust): number {
  const sh = a.shadows / 100
  const hi = a.highlights / 100
  const wh = a.whites / 100
  const bl = a.blacks / 100
  const xc = clamp01(x)
  let y = x
  y += sh * 0.25 * 6.75 * xc * (1 - xc) * (1 - xc) // peaks in the shadows
  y += hi * 0.25 * 6.75 * xc * xc * (1 - xc) // peaks in the highlights
  y += wh * 0.18 * xc * xc * xc // moves the white point
  y += bl * 0.12 * (1 - xc) * (1 - xc) * (1 - xc) // moves the black point
  const c = a.contrast / 100
  if (c !== 0) {
    const k = c > 0 ? 1 + c * 0.9 : 1 + c * 0.7
    y = 0.5 + (y - 0.5) * k
  }
  return y
}

export function applyAdjust(rgb: RGB, a: ColorAdjust): RGB {
  let [r, g, b] = rgb
  if (a.temperature || a.tint || a.exposure) {
    r = toLin(clamp01(r))
    g = toLin(clamp01(g))
    b = toLin(clamp01(b))
    const t = a.temperature / 100
    const ti = a.tint / 100
    r *= (1 + TEMP_K * t) * (1 + TINT_RB * ti)
    b *= (1 - TEMP_K * t) * (1 + TINT_RB * ti)
    g *= 1 - TINT_G * ti
    const m = Math.pow(2, a.exposure)
    r = toSrgb(Math.max(0, r * m))
    g = toSrgb(Math.max(0, g * m))
    b = toSrgb(Math.max(0, b * m))
  }
  r = tone(r, a)
  g = tone(g, a)
  b = tone(b, a)
  if (a.saturation || a.vibrance) {
    const L = luma(r, g, b)
    const chroma = Math.max(r, g, b) - Math.min(r, g, b)
    const sat = 1 + a.saturation / 100
    const vib = 1 + (a.vibrance / 100) * (1 - clamp01(chroma * 1.6))
    const f = Math.max(0, sat * vib)
    r = L + (r - L) * f
    g = L + (g - L) * f
    b = L + (b - L) * f
  }
  return [r, g, b]
}

// --- HSL ---

const BAND_HUES: Record<HslBand, number> = { red: 0, orange: 30, yellow: 60, green: 120, aqua: 180, blue: 240, purple: 280, magenta: 320 }

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [h * 60, s, l]
}

function hslToRgb(h: number, s: number, l: number): RGB {
  if (s <= 0) return [l, l, l]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number): number => {
    t = ((t % 1) + 1) % 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const hh = h / 360
  return [f(hh + 1 / 3), f(hh), f(hh - 1 / 3)]
}

/** Weights of the 8 hue bands for a hue (piecewise linear between neighbouring band centres). */
function bandWeights(h: number): Partial<Record<HslBand, number>> {
  const out: Partial<Record<HslBand, number>> = {}
  for (let i = 0; i < HSL_BANDS.length; i++) {
    const a = HSL_BANDS[i]
    const b = HSL_BANDS[(i + 1) % HSL_BANDS.length]
    const ha = BAND_HUES[a]
    let hb = BAND_HUES[b]
    if (hb <= ha) hb += 360
    let hh = h
    if (hh < ha) hh += 360
    if (hh >= ha && hh <= hb) {
      const t = (hh - ha) / (hb - ha)
      out[a] = (out[a] ?? 0) + (1 - t)
      out[b] = (out[b] ?? 0) + t
      return out
    }
  }
  return out
}

function applyHsl(rgb: RGB, hsl: NonNullable<ColorGrade['hsl']>): RGB {
  const [h, s, l] = rgbToHsl(clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2]))
  if (s < 0.001) return rgb
  const w = bandWeights(h)
  let dh = 0
  let ds = 0
  let dl = 0
  for (const band of Object.keys(w) as HslBand[]) {
    const v = hsl[band]
    if (!v) continue
    const k = w[band]!
    dh += k * v.h * 0.3 // up to ±30°
    ds += k * v.s / 100
    dl += k * v.l / 100
  }
  const amt = Math.min(1, s / 0.15) // greys are not affected
  const nh = h + dh * amt
  const ns = clamp01(s * (1 + ds * amt))
  const nl = clamp01(l + dl * 0.25 * amt * s)
  return hslToRgb((nh + 360) % 360, ns, nl)
}

// --- curves (monotone cubic interpolation, Fritsch–Carlson) ---

const curveCache = new Map<string, Float32Array>()

export function curveTable(points: CurvePoints): Float32Array {
  const key = JSON.stringify(points)
  const hit = curveCache.get(key)
  if (hit) return hit
  const pts = [...points].sort((a, b) => a[0] - b[0])
  const n = pts.length
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const d: number[] = []
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]))
  const m: number[] = new Array(n).fill(0)
  m[0] = d[0] ?? 0
  m[n - 1] = d[n - 2] ?? 0
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i] / d[i]
    const b = m[i + 1] / d[i]
    const s = a * a + b * b
    if (s > 9) {
      const t = 3 / Math.sqrt(s)
      m[i] = t * a * d[i]
      m[i + 1] = t * b * d[i]
    }
  }
  const size = 1024
  const table = new Float32Array(size)
  let seg = 0
  for (let k = 0; k < size; k++) {
    const x = k / (size - 1)
    if (x <= xs[0]) table[k] = ys[0]
    else if (x >= xs[n - 1]) table[k] = ys[n - 1]
    else {
      while (seg < n - 2 && x > xs[seg + 1]) seg++
      const h = xs[seg + 1] - xs[seg]
      const t = (x - xs[seg]) / h
      const t2 = t * t
      const t3 = t2 * t
      table[k] =
        (2 * t3 - 3 * t2 + 1) * ys[seg] + (t3 - 2 * t2 + t) * h * m[seg] + (-2 * t3 + 3 * t2) * ys[seg + 1] + (t3 - t2) * h * m[seg + 1]
    }
  }
  curveCache.set(key, table)
  return table
}

const sampleTable = (t: Float32Array, x: number): number => {
  const f = clamp01(x) * (t.length - 1)
  const i = Math.floor(f)
  const j = Math.min(t.length - 1, i + 1)
  return t[i] + (t[j] - t[i]) * (f - i)
}

// --- LUT files (.cube) ---

export interface CubeLut {
  size: number
  data: Float32Array // r fastest, then g, then b
  domainMin: RGB
  domainMax: RGB
}

export function parseCube(text: string): CubeLut {
  let size = 0
  let domainMin: RGB = [0, 0, 0]
  let domainMax: RGB = [1, 1, 1]
  const values: number[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const up = line.toUpperCase()
    if (up.startsWith('LUT_3D_SIZE')) size = parseInt(line.split(/\s+/)[1], 10)
    else if (up.startsWith('DOMAIN_MIN')) domainMin = line.split(/\s+/).slice(1, 4).map(Number) as RGB
    else if (up.startsWith('DOMAIN_MAX')) domainMax = line.split(/\s+/).slice(1, 4).map(Number) as RGB
    else if (/^[-\d.]/.test(line)) {
      const p = line.split(/\s+/)
      if (p.length >= 3) values.push(Number(p[0]), Number(p[1]), Number(p[2]))
    } else if (up.startsWith('LUT_1D_SIZE')) throw new Error('1D LUTs are not supported, please use a 3D .cube LUT.')
  }
  if (!size || values.length !== size * size * size * 3) throw new Error('This is not a valid 3D .cube LUT file.')
  return { size, data: new Float32Array(values), domainMin, domainMax }
}

export function sampleCube(lut: CubeLut, rgb: RGB): RGB {
  const n = lut.size
  const pos = [0, 1, 2].map((i) => clamp01((rgb[i] - lut.domainMin[i]) / (lut.domainMax[i] - lut.domainMin[i])) * (n - 1))
  const i0 = pos.map(Math.floor)
  const i1 = i0.map((v) => Math.min(n - 1, v + 1))
  const f = pos.map((v, i) => v - i0[i])
  const at = (r: number, g: number, b: number, c: number): number => lut.data[(r + g * n + b * n * n) * 3 + c]
  const out: RGB = [0, 0, 0]
  for (let c = 0; c < 3; c++) {
    const c00 = at(i0[0], i0[1], i0[2], c) * (1 - f[0]) + at(i1[0], i0[1], i0[2], c) * f[0]
    const c10 = at(i0[0], i1[1], i0[2], c) * (1 - f[0]) + at(i1[0], i1[1], i0[2], c) * f[0]
    const c01 = at(i0[0], i0[1], i1[2], c) * (1 - f[0]) + at(i1[0], i0[1], i1[2], c) * f[0]
    const c11 = at(i0[0], i1[1], i1[2], c) * (1 - f[0]) + at(i1[0], i1[1], i1[2], c) * f[0]
    const c0 = c00 * (1 - f[1]) + c10 * f[1]
    const c1 = c01 * (1 - f[1]) + c11 * f[1]
    out[c] = c0 * (1 - f[2]) + c1 * f[2]
  }
  return out
}

const cubeCache = new Map<string, CubeLut | 'loading' | 'error'>()

/** Load a LUT file (cached). Returns null while loading; the preview just redraws a moment later. */
export function getCube(path: string): CubeLut | null {
  const hit = cubeCache.get(path)
  if (hit && hit !== 'loading' && hit !== 'error') return hit
  if (!hit) {
    cubeCache.set(path, 'loading')
    window.api
      .readTextFile(path)
      .then((t) => cubeCache.set(path, parseCube(t)))
      .catch(() => cubeCache.set(path, 'error'))
  }
  return null
}

export async function loadCube(path: string): Promise<CubeLut> {
  const hit = cubeCache.get(path)
  if (hit && hit !== 'loading' && hit !== 'error') return hit
  const lut = parseCube(await window.api.readTextFile(path))
  cubeCache.set(path, lut)
  return lut
}

// ---------- the full per-pixel pipeline ----------

/** Apply the user's sliders, HSL and curves (no filter / LUT / match). */
function applyManual(c: RGB, g: Pick<ColorGrade, 'adjust' | 'hsl' | 'curves'>): RGB {
  let out = applyAdjust(c, g.adjust)
  if (g.hsl) out = applyHsl(out, g.hsl)
  if (g.curves) {
    const mt = curveIsIdentity(g.curves.master) ? null : curveTable(g.curves.master)
    const ct = (['r', 'g', 'b'] as const).map((k) => (curveIsIdentity(g.curves![k]) ? null : curveTable(g.curves![k])))
    out = out.map((v, i) => {
      let y = mt ? sampleTable(mt, v) : v
      if (ct[i]) y = sampleTable(ct[i]!, y)
      return y
    }) as RGB
  }
  return out
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

/** Returns null if a LUT file the grade needs is not loaded yet. */
export function pointFunction(g: ColorGrade): ((c: RGB) => RGB) | null {
  const cube = g.lut ? getCube(g.lut.path) : null
  if (g.lut && !cube) return null
  const filter = g.filter ? FILTERS.find((f) => f.id === g.filter!.id) : undefined
  return (input: RGB): RGB => {
    let c: RGB = input
    if (g.match) c = [0, 1, 2].map((i) => c[i] * g.match!.gain[i] + g.match!.offset[i]) as RGB
    if (cube && g.lut) c = mix(c, sampleCube(cube, c), g.lut.intensity)
    if (filter && g.filter) c = mix(c, applyManual(c, { adjust: { ...DEFAULT_ADJUST, ...filter.adjust }, hsl: filter.hsl, curves: filter.curves }), g.filter.intensity)
    c = applyManual(c, g)
    return [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])]
  }
}

export const LUT_SIZE = 33

const lutCache = new Map<string, Float32Array>()

/** Key of everything that affects the LUT (sharpen and vignette are applied separately). */
export function lutKey(g: ColorGrade): string {
  const { sharpen: _s, vignette: _v, ...rest } = g.adjust
  void _s
  void _v
  return JSON.stringify([rest, g.curves, g.hsl, g.filter, g.lut, g.match])
}

/** 3D LUT (r fastest) baked from the grade, or null while a LUT file is still loading. */
export function buildLut(g: ColorGrade, size = LUT_SIZE): Float32Array | null {
  const key = `${size}|${lutKey(g)}`
  const hit = lutCache.get(key)
  if (hit) return hit
  const fn = pointFunction(g)
  if (!fn) return null
  const out = new Float32Array(size * size * size * 3)
  let o = 0
  for (let b = 0; b < size; b++)
    for (let gg = 0; gg < size; gg++)
      for (let r = 0; r < size; r++) {
        const c = fn([r / (size - 1), gg / (size - 1), b / (size - 1)])
        out[o++] = c[0]
        out[o++] = c[1]
        out[o++] = c[2]
      }
  if (lutCache.size > 64) lutCache.clear()
  lutCache.set(key, out)
  return out
}

export function lutToCube(lut: Float32Array, size = LUT_SIZE): string {
  const lines = ['TITLE "Cutly"', `LUT_3D_SIZE ${size}`]
  for (let i = 0; i < lut.length; i += 3) lines.push(`${lut[i].toFixed(6)} ${lut[i + 1].toFixed(6)} ${lut[i + 2].toFixed(6)}`)
  return lines.join('\n') + '\n'
}

/** Vignette darkening factor at normalised position (u, v in 0..1) — same formula as the shader. */
export function vignetteFactor(u: number, v: number, amount: number): number {
  const dx = (u - 0.5) * 2
  const dy = (v - 0.5) * 2
  const d = Math.sqrt(dx * dx + dy * dy) / Math.SQRT2
  const t = Math.min(1, Math.max(0, (d - 0.35) / 0.65))
  const s = t * t * (3 - 2 * t)
  return 1 - (amount / 100) * 0.85 * s
}
