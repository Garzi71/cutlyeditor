// Preview for an in / out animation tile: a sample picture moving with the real animation math.
import { useEffect, useRef } from 'react'
import type { Clip, ClipAnimType } from '@shared/types'
import { poseAt } from '@shared/motion'
import { sampleScenes } from './FxThumb'

const DUR = 0.6
const LEN = 1.4

function fakeClip(type: ClipAnimType | null, out: boolean): Clip {
  return {
    id: 'anim-sample',
    trackId: '',
    mediaId: '',
    start: 0,
    in: 0,
    out: LEN,
    volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    ...(type ? { [out ? 'animOut' : 'animIn']: { type, duration: DUR } } : {})
  }
}

export default function AnimThumb({ type, out, playing }: { type: ClipAnimType | null; out: boolean; playing: boolean }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const clip = fakeClip(type, out)
    const scene = sampleScenes()[out ? 1 : 0]
    const draw = (tau: number): void => {
      const dpr = window.devicePixelRatio || 1
      const W = Math.max(1, Math.round(cv.clientWidth * dpr))
      const H = Math.max(1, Math.round(cv.clientHeight * dpr))
      if (cv.width !== W || cv.height !== H) {
        cv.width = W
        cv.height = H
      }
      const ctx = cv.getContext('2d')!
      ctx.clearRect(0, 0, W, H)
      const pose = poseAt(clip, tau, W, H)
      const w = W * 0.62
      const h = (w * scene.height) / scene.width
      ctx.save()
      ctx.globalAlpha = pose.opacity
      if (pose.blur > 0) ctx.filter = `blur(${(pose.blur * W) / 400}px)`
      ctx.translate(W / 2 + pose.x, H / 2 + pose.y)
      ctx.rotate((pose.rotation * Math.PI) / 180)
      ctx.scale(pose.scale, pose.scale)
      ctx.beginPath()
      ctx.roundRect(-w / 2, -h / 2, w * Math.min(1, pose.reveal), h, 3 * dpr)
      ctx.clip()
      ctx.drawImage(scene, -w / 2, -h / 2, w, h)
      ctx.restore()
    }
    // Still frame: halfway through the animation, so each tile looks different.
    const still = out ? LEN - DUR * 0.45 : DUR * 0.45
    if (!playing || !type) {
      draw(type ? still : LEN / 2)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const loop = (): void => {
      const t = ((performance.now() - t0) / 1000) % (LEN + 0.4)
      draw(Math.min(LEN - 0.001, t))
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [type, out, playing])
  return <canvas ref={ref} className="fx-canvas" />
}
