// Keyframes, easing and in/out animations. Shared by the preview/export renderer and by the
// exporter's audio graph (volume keyframes become an ffmpeg expression built from the same data).
import type { AnimProp, Clip, ClipAnimType, Easing, Keyframe } from './types'
import { clipDuration } from './types'

export function ease(e: Easing, p: number): number {
  p = Math.min(1, Math.max(0, p))
  switch (e) {
    case 'hold':
      return 0
    case 'easeIn':
      return p * p
    case 'easeOut':
      return 1 - (1 - p) * (1 - p)
    case 'easeInOut':
      return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2
    default:
      return p
  }
}

/** Value of an animated property at clip time tau; the first/last keyframe holds outside the range. */
export function evalKeyframes(kfs: Keyframe[] | undefined, tau: number, base: number): number {
  if (!kfs || kfs.length === 0) return base
  if (tau <= kfs[0].t) return kfs[0].v
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i]
    const b = kfs[i + 1]
    if (tau <= b.t) return a.v + (b.v - a.v) * ease(a.ease, (tau - a.t) / Math.max(1e-9, b.t - a.t))
  }
  return kfs[kfs.length - 1].v
}

export function baseValue(c: Clip, prop: AnimProp): number {
  return prop === 'volume' ? c.volume : c.transform[prop]
}

export function propAt(c: Clip, prop: AnimProp, tau: number): number {
  return evalKeyframes(c.keyframes?.[prop], tau, baseValue(c, prop))
}

export interface Pose {
  x: number
  y: number
  scale: number
  rotation: number
  opacity: number
  blur: number // project pixels
  reveal: number // 0..1, typewriter
}

const backOut = (p: number): number => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2)
}

/** Apply one in/out animation. `p` goes 0 -> 1 as the clip becomes fully visible (for "out" it is mirrored). */
function applyAnim(pose: Pose, type: ClipAnimType, p: number, W: number, H: number, isOut: boolean): void {
  const e = ease('easeOut', p)
  const dir = isOut ? -1 : 1
  switch (type) {
    case 'fade':
      pose.opacity *= e
      break
    case 'zoomIn':
      pose.scale *= isOut ? 1 + 0.5 * (1 - e) : 0.5 + 0.5 * e
      pose.opacity *= Math.min(1, e * 1.5)
      break
    case 'zoomOut':
      pose.scale *= isOut ? 0.5 + 0.5 * e : 1 + 0.5 * (1 - e)
      pose.opacity *= Math.min(1, e * 1.5)
      break
    case 'slideLeft':
      pose.x += dir * (1 - e) * W * 0.6
      pose.opacity *= Math.min(1, e * 2)
      break
    case 'slideRight':
      pose.x -= dir * (1 - e) * W * 0.6
      pose.opacity *= Math.min(1, e * 2)
      break
    case 'slideUp':
      pose.y += dir * (1 - e) * H * 0.6
      pose.opacity *= Math.min(1, e * 2)
      break
    case 'slideDown':
      pose.y -= dir * (1 - e) * H * 0.6
      pose.opacity *= Math.min(1, e * 2)
      break
    case 'pop':
      pose.scale *= Math.max(0, backOut(Math.min(1, Math.max(0, p))))
      pose.opacity *= Math.min(1, p * 3)
      break
    case 'spin':
      pose.rotation += dir * (1 - e) * -180
      pose.scale *= 0.3 + 0.7 * e
      pose.opacity *= e
      break
    case 'blur':
      pose.blur += (1 - e) * 40
      pose.opacity *= Math.min(1, e * 1.5)
      break
    case 'typewriter':
      pose.reveal = Math.min(pose.reveal, p)
      break
  }
}

/** Where and how a clip is drawn at clip time tau (keyframes + in/out animations). */
export function poseAt(c: Clip, tau: number, projectW: number, projectH: number): Pose {
  const pose: Pose = {
    x: propAt(c, 'x', tau),
    y: propAt(c, 'y', tau),
    scale: propAt(c, 'scale', tau),
    rotation: propAt(c, 'rotation', tau),
    opacity: propAt(c, 'opacity', tau),
    blur: 0,
    reveal: 1
  }
  const D = clipDuration(c)
  if (c.animIn && c.animIn.duration > 0 && tau < c.animIn.duration) {
    applyAnim(pose, c.animIn.type, tau / c.animIn.duration, projectW, projectH, false)
  }
  if (c.animOut && c.animOut.duration > 0 && tau > D - c.animOut.duration) {
    applyAnim(pose, c.animOut.type, (D - tau) / c.animOut.duration, projectW, projectH, true)
  }
  pose.opacity = Math.min(1, Math.max(0, pose.opacity))
  return pose
}

/** Largest scale the clip ever reaches (used to pick the export decode size). */
export function maxScale(c: Clip): number {
  let s = Math.max(c.transform.scale, ...(c.keyframes?.scale ?? []).map((k) => k.v))
  for (const a of [c.animIn, c.animOut]) if (a && (a.type === 'zoomIn' || a.type === 'zoomOut' || a.type === 'pop')) s *= 1.5
  return s
}

/** Volume (0..2) at clip time tau, including audio fades. */
export function volumeAt(c: Clip, tau: number): number {
  let v = propAt(c, 'volume', tau)
  const D = clipDuration(c)
  if (c.fadeIn && tau < c.fadeIn) v *= Math.max(0, tau / c.fadeIn)
  if (c.fadeOut && tau > D - c.fadeOut) v *= Math.max(0, (D - tau) / c.fadeOut)
  return v
}

/** ffmpeg expression (variable t = clip time) for a keyframed property, same math as evalKeyframes. */
export function keyframeExpr(kfs: Keyframe[]): string {
  const f = (n: number): string => n.toFixed(5)
  const easeExpr = (e: Easing, p: string): string => {
    switch (e) {
      case 'hold':
        return '0'
      case 'easeIn':
        return `(${p})*(${p})`
      case 'easeOut':
        return `(1-(1-(${p}))*(1-(${p})))`
      case 'easeInOut':
        return `if(lt(${p},0.5),2*(${p})*(${p}),1-pow(-2*(${p})+2,2)/2)`
      default:
        return `(${p})`
    }
  }
  let expr = f(kfs[kfs.length - 1].v)
  for (let i = kfs.length - 2; i >= 0; i--) {
    const a = kfs[i]
    const b = kfs[i + 1]
    const p = `(t-${f(a.t)})/${f(Math.max(1e-9, b.t - a.t))}`
    expr = `if(lte(t,${f(b.t)}),${f(a.v)}+${f(b.v - a.v)}*${easeExpr(a.ease, p)},${expr})`
  }
  return `if(lte(t,${f(kfs[0].t)}),${f(kfs[0].v)},${expr})`
}
