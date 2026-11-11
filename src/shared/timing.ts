// Time mapping between the timeline and the source media, including speed, speed ramps and reverse.
// Shared by the preview, the export decoder and the editing operations so they always agree.
//
// Terms: `tau` = seconds since the clip's start on the timeline. `played` = seconds of source played
// so far (0 .. out-in), whatever the direction. Source time = in + played, or out - played when reversed.
import type { Clip, SpeedSettings } from './types'

const DEFAULT_SPEED: SpeedSettings = { rate: 1 }
const MIN_RATE = 0.05

export const speedOf = (c: Clip): SpeedSettings => (c.text || c.adjustment || c.effect ? DEFAULT_SPEED : c.speed ?? DEFAULT_SPEED)
export const playedSpan = (c: Clip): number => Math.max(0, c.out - c.in)
const hasCurve = (s: SpeedSettings): boolean => !!s.curve && s.curve.length >= 2

/** Speed multiplier at progress u (0..1) for a curve, linear between points. */
export function curveSpeedAt(curve: [number, number][], u: number): number {
  if (u <= curve[0][0]) return curve[0][1]
  for (let i = 0; i < curve.length - 1; i++) {
    const [u0, v0] = curve[i]
    const [u1, v1] = curve[i + 1]
    if (u <= u1) return v0 + ((v1 - v0) * (u - u0)) / Math.max(1e-9, u1 - u0)
  }
  return curve[curve.length - 1][1]
}

interface RampTable {
  span: number
  played: Float64Array // played seconds at each sample
  tau: Float64Array // timeline seconds at each sample
}

const N = 512
const rampCache = new Map<string, RampTable>()

/** Integrate tau(played) = ∫ d(played) / speed for a ramped clip. */
function rampTable(span: number, curve: [number, number][]): RampTable {
  const key = `${span.toFixed(6)}|${JSON.stringify(curve)}`
  const hit = rampCache.get(key)
  if (hit) return hit
  const played = new Float64Array(N + 1)
  const tau = new Float64Array(N + 1)
  for (let i = 1; i <= N; i++) {
    const u0 = (i - 1) / N
    const u1 = i / N
    const v = Math.max(MIN_RATE, (curveSpeedAt(curve, u0) + curveSpeedAt(curve, u1)) / 2)
    played[i] = u1 * span
    tau[i] = tau[i - 1] + span / N / v
  }
  const t: RampTable = { span, played, tau }
  if (rampCache.size > 200) rampCache.clear()
  rampCache.set(key, t)
  return t
}

export function timelineDuration(c: Clip): number {
  const s = speedOf(c)
  const span = playedSpan(c)
  if (hasCurve(s)) return rampTable(span, s.curve!).tau[N]
  return span / Math.max(MIN_RATE, s.rate)
}

/** Seconds of source played at timeline offset tau (extrapolated past both ends with the edge speed). */
export function playedAt(c: Clip, tau: number): number {
  const s = speedOf(c)
  const span = playedSpan(c)
  if (!hasCurve(s)) return tau * Math.max(MIN_RATE, s.rate)
  const t = rampTable(span, s.curve!)
  const D = t.tau[N]
  if (tau <= 0) return tau * Math.max(MIN_RATE, curveSpeedAt(s.curve!, 0))
  if (tau >= D) return span + (tau - D) * Math.max(MIN_RATE, curveSpeedAt(s.curve!, 1))
  let lo = 0
  let hi = N
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (t.tau[mid] <= tau) lo = mid
    else hi = mid
  }
  const f = (tau - t.tau[lo]) / Math.max(1e-12, t.tau[hi] - t.tau[lo])
  return t.played[lo] + f * (t.played[hi] - t.played[lo])
}

/** Timeline offset at which `played` seconds of source have been played. */
export function tauAtPlayed(c: Clip, played: number): number {
  const s = speedOf(c)
  if (!hasCurve(s)) return played / Math.max(MIN_RATE, s.rate)
  const t = rampTable(playedSpan(c), s.curve!)
  const span = t.span || 1e-9
  const i = Math.min(N - 1, Math.max(0, Math.floor((played / span) * N)))
  const f = (played - t.played[i]) / Math.max(1e-12, t.played[i + 1] - t.played[i])
  return t.tau[i] + f * (t.tau[i + 1] - t.tau[i])
}

/** Source media time shown at timeline offset tau (not clamped to the media length). */
export function sourceTimeAt(c: Clip, tau: number): number {
  const p = playedAt(c, tau)
  return speedOf(c).reverse ? c.out - p : c.in + p
}

/** Instantaneous speed at timeline offset tau (for the preview's playbackRate). */
export function rateAt(c: Clip, tau: number): number {
  const s = speedOf(c)
  if (!hasCurve(s)) return s.rate
  const span = playedSpan(c) || 1
  return Math.max(MIN_RATE, curveSpeedAt(s.curve!, Math.min(1, Math.max(0, playedAt(c, tau) / span))))
}

function sliceCurve(curve: [number, number][], a: number, b: number): [number, number][] {
  const pts: [number, number][] = [[0, curveSpeedAt(curve, a)]]
  for (const [u, v] of curve) if (u > a + 1e-6 && u < b - 1e-6) pts.push([(u - a) / (b - a), v])
  pts.push([1, curveSpeedAt(curve, b)])
  return pts
}

/** Timing fields of the two halves when a clip is cut at timeline offset tau. */
export function splitTiming(c: Clip, tau: number): { left: Partial<Clip>; right: Partial<Clip> } {
  const s = speedOf(c)
  const span = playedSpan(c)
  const p = Math.min(span, Math.max(0, playedAt(c, tau)))
  const u = span > 0 ? p / span : 0
  const leftSpeed = s.curve ? { ...s, curve: sliceCurve(s.curve, 0, u) } : c.speed
  const rightSpeed = s.curve ? { ...s, curve: sliceCurve(s.curve, u, 1) } : c.speed
  if (s.reverse) {
    return {
      left: { in: c.out - p, out: c.out, speed: leftSpeed },
      right: { in: c.in, out: c.out - p, start: c.start + tau, speed: rightSpeed }
    }
  }
  return {
    left: { in: c.in, out: c.in + p, speed: leftSpeed },
    right: { in: c.in + p, out: c.out, start: c.start + tau, speed: rightSpeed }
  }
}

/**
 * New in/out when the played range is extended or shortened at its beginning (`head`) or end (`tail`)
 * by `dPlayed` seconds of source. Positive = longer. Respects the direction of play.
 */
export function adjustPlayed(c: Clip, edge: 'head' | 'tail', dPlayed: number): { in: number; out: number } {
  const rev = !!speedOf(c).reverse
  // The head of a forward clip is `in`; of a reversed clip it is `out`.
  if ((edge === 'head') !== rev) return { in: c.in - dPlayed, out: c.out }
  return { in: c.in, out: c.out + dPlayed }
}
