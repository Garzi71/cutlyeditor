// Background removal (people) with Robust Video Matting, running on the GPU via ONNX Runtime WebGPU
// (falls back to WebAssembly on the CPU). The model is recurrent: each clip keeps its own state,
// reset when playback jumps, so hair and edges stay stable from frame to frame.
import * as ort from 'onnxruntime-web/webgpu'
import { mediaUrl } from '../lib/util'

// The runtime's WebAssembly files (the package doesn't export them, so they are referenced by path;
// Vite copies them into the app when building).
ort.env.wasm.wasmPaths = {
  wasm: new URL('../../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm', import.meta.url).href,
  mjs: new URL('../../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs', import.meta.url).href
}
ort.env.wasm.numThreads = 1

/** Longest side of the picture the model looks at (the mask is scaled up afterwards): export / live preview. */
const PROCESS_SIZE = 640
const PREVIEW_SIZE = 384

let session: Promise<ort.InferenceSession> | null = null
let backend = ''
let preferCpu = false
let gpuOptLevel: 'disabled' | 'basic' | 'extended' | 'all' = 'all'
export function setGpuOptLevel(l: typeof gpuOptLevel): void {
  gpuOptLevel = l
  session = null
  gpuVerified = false
}

/** Switch between GPU and CPU (also used to compare their results). */
export function setPreferCpu(cpu: boolean): void {
  preferCpu = cpu
  session = null
  gpuVerified = false
}
/** Why the GPU could not be used (shown in the UI). */
export let gpuError = ''

export function mattingBackend(): string {
  return backend
}

let modelBytes: Promise<Uint8Array> | null = null
function loadModel(): Promise<Uint8Array> {
  if (!modelBytes) {
    modelBytes = (async () => {
      const st = await window.api.mattingStatus()
      if (!st.ready) throw new Error('The background removal model is not downloaded yet.')
      return new Uint8Array(await (await fetch(mediaUrl(st.path))).arrayBuffer())
    })()
    modelBytes.catch(() => (modelBytes = null))
  }
  return modelBytes
}

/** The GPU result is checked once against the CPU (some graphics drivers compute this model wrongly). */
let gpuVerified = false

async function getSession(): Promise<ort.InferenceSession> {
  if (!session) {
    session = (async () => {
      const model = await loadModel()
      for (const ep of preferCpu ? (['wasm'] as const) : (['webgpu', 'wasm'] as const)) {
        try {
          const s = await ort.InferenceSession.create(model, { executionProviders: [ep], graphOptimizationLevel: ep === 'webgpu' ? gpuOptLevel : 'all' })
          backend = ep === 'webgpu' ? 'GPU' : 'CPU'
          return s
        } catch (e) {
          if (ep === 'wasm') throw e
          gpuError = String((e as Error)?.message ?? e)
          console.warn('WebGPU matting unavailable:', gpuError)
        }
      }
      throw new Error('No backend available')
    })()
    session.catch(() => (session = null))
  }
  return session
}

/**
 * First frame on the GPU: run the same frame on the CPU too. If the masks disagree, the GPU
 * can't be trusted on this computer, so everything switches to the CPU.
 */
async function verifyGpu(feeds: Record<string, ort.Tensor>, gpuPha: Float32Array): Promise<boolean> {
  const cpu = await ort.InferenceSession.create(await loadModel(), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
  try {
    const out = await cpu.run(feeds)
    const ref = out.pha.data as Float32Array
    let diff = 0
    for (let i = 0; i < ref.length; i++) diff += Math.abs(ref[i] - gpuPha[i])
    diff /= ref.length
    if (diff > 0.05) {
      gpuError = `GPU result differs from the CPU (${diff.toFixed(2)})`
      console.warn('Matting: ' + gpuError + ', using the CPU')
      preferCpu = true
      session = Promise.resolve(cpu)
      backend = 'CPU'
      return false
    }
  } catch (e) {
    console.warn('Matting GPU check failed:', e)
  }
  await cpu.release()
  return true
}

/** ONNX sessions must not run concurrently: every run goes through this queue. */
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job)
  queue = next.catch(() => {})
  return next
}

const zero = (): ort.Tensor => new ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1])

/** Per-clip matting state: the model's memory and the latest mask. */
export class Matter {
  constructor(private size = PROCESS_SIZE) {}
  private rec: ort.Tensor[] = [zero(), zero(), zero(), zero()]
  private lastTime = -1
  private busy = false
  private input = document.createElement('canvas')
  private inputCtx = this.input.getContext('2d', { willReadFrequently: true })!
  /** Alpha mask at the processing size (white = keep). */
  readonly mask = document.createElement('canvas')
  private maskCtx = this.mask.getContext('2d')!
  hasMask = false
  error: string | null = null

  /** Run the model on a frame. `time` = source time (a jump resets the model's memory). */
  async process(src: CanvasImageSource, srcW: number, srcH: number, time: number): Promise<void> {
    const s = await getSession()
    const scale = Math.min(1, this.size / Math.max(srcW, srcH))
    const w = Math.max(16, Math.round((srcW * scale) / 16) * 16)
    const h = Math.max(16, Math.round((srcH * scale) / 16) * 16)
    if (this.input.width !== w || this.input.height !== h) {
      this.input.width = w
      this.input.height = h
      this.reset()
    }
    if (this.lastTime < 0 || Math.abs(time - this.lastTime) > 0.5 || time < this.lastTime - 0.01) this.reset()
    this.lastTime = time
    this.inputCtx.drawImage(src, 0, 0, w, h)
    const px = this.inputCtx.getImageData(0, 0, w, h).data
    const plane = w * h
    const data = new Float32Array(3 * plane)
    for (let i = 0; i < plane; i++) {
      data[i] = px[i * 4] / 255
      data[plane + i] = px[i * 4 + 1] / 255
      data[2 * plane + i] = px[i * 4 + 2] / 255
    }
    const feeds = {
      src: new ort.Tensor('float32', data, [1, 3, h, w]),
      r1i: this.rec[0],
      r2i: this.rec[1],
      r3i: this.rec[2],
      r4i: this.rec[3],
      downsample_ratio: new ort.Tensor('float32', new Float32Array([0.5]), [1])
    }
    let out = await serial(() => s.run(feeds))
    if (backend === 'GPU' && !gpuVerified) {
      gpuVerified = true
      const ok = await serial(() => verifyGpu(feeds, out.pha.data as Float32Array))
      if (!ok) {
        // Redo this frame on the CPU.
        for (const t of Object.values(out)) t.dispose?.()
        const cpu = await getSession()
        out = await serial(() => cpu.run(feeds))
      }
    }
    // Copy the outputs: they can point into the runtime's memory, which the next run reuses.
    const copy = (t: ort.Tensor): ort.Tensor => new ort.Tensor('float32', new Float32Array(t.data as Float32Array), t.dims)
    this.rec = [copy(out.r1o), copy(out.r2o), copy(out.r3o), copy(out.r4o)]
    const pha = new Float32Array(out.pha.data as Float32Array)
    for (const t of Object.values(out)) t.dispose?.()
    if (this.mask.width !== w || this.mask.height !== h) {
      this.mask.width = w
      this.mask.height = h
    }
    const img = this.maskCtx.createImageData(w, h)
    for (let i = 0; i < plane; i++) {
      img.data[i * 4] = 255
      img.data[i * 4 + 1] = 255
      img.data[i * 4 + 2] = 255
      img.data[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, pha[i])) * 255)
    }
    this.maskCtx.putImageData(img, 0, 0)
    this.hasMask = true
  }

  /** Preview: start processing this frame unless a run is still going (the mask may lag a frame). */
  kick(src: CanvasImageSource, srcW: number, srcH: number, time: number): void {
    if (this.busy) return
    this.busy = true
    this.process(src, srcW, srcH, time)
      .then(() => (this.error = null))
      .catch((e) => (this.error = (e as Error).message))
      .finally(() => (this.busy = false))
  }

  reset(): void {
    this.rec = [zero(), zero(), zero(), zero()]
    this.lastTime = -1
  }

  private out = document.createElement('canvas')
  private outCtx = this.out.getContext('2d')!

  /** The frame with its background removed (transparent), using the latest mask. */
  compose(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
    if (this.out.width !== w || this.out.height !== h) {
      this.out.width = w
      this.out.height = h
    }
    const c = this.outCtx
    c.globalCompositeOperation = 'copy'
    c.drawImage(src, 0, 0, w, h)
    c.globalCompositeOperation = 'destination-in'
    c.imageSmoothingQuality = 'high'
    c.drawImage(this.mask, 0, 0, w, h)
    c.globalCompositeOperation = 'source-over'
    return this.out
  }
}

const matters = new Map<string, Matter>()

/** One state per clip (separate maps for the preview and the export so they don't disturb each other). */
export function matterFor(key: string): Matter {
  let m = matters.get(key)
  if (!m) {
    m = new Matter(key.startsWith('p:') ? PREVIEW_SIZE : PROCESS_SIZE)
    matters.set(key, m)
  }
  return m
}

export function dropMatter(key: string): void {
  matters.delete(key)
}
