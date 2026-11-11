// Export: the UI draws every frame with the same compositor as the preview and streams the pixels
// here; this file decodes source frames for the UI, mixes the audio and encodes the result.
import { ChildProcess, spawn } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import type { ExportSettings, FrameRequest, Project } from '../shared/types'
import { clipDuration, projectDuration } from '../shared/types'
import { playedSpan, speedOf, tauAtPlayed } from '../shared/timing'
import { keyframeExpr } from '../shared/motion'
import { FFMPEG, colorMatrixOf, reverseProxyPath, run } from './ffmpeg'

const f3 = (n: number): string => n.toFixed(3)

// ---------------- audio ----------------

/** atempo only accepts 0.5..2 (per instance), so chain several for bigger changes. */
function atempoChain(rate: number): string {
  const parts: string[] = []
  let r = rate
  while (r > 2) {
    parts.push('atempo=2')
    r /= 2
  }
  while (r < 0.5) {
    parts.push('atempo=0.5')
    r /= 0.5
  }
  if (Math.abs(r - 1) > 1e-4) parts.push(`atempo=${r.toFixed(5)}`)
  return parts.join(',')
}

/**
 * Mix every clip with sound on a non-muted track into [aout]: trim, reverse (from the reversed copy),
 * speed / speed ramp (pitch kept), volume keyframes, fades, position on the timeline.
 */
function audioGraph(project: Project, total: number, inputArgs: string[], firstInput: number, rate = 48000): string[] {
  const filters: string[] = []
  const labels: string[] = []
  let idx = firstInput
  const media = new Map(project.media.map((m) => [m.id, m]))
  for (const track of project.tracks) {
    if (track.muted) continue
    for (const c of project.clips.filter((x) => x.trackId === track.id)) {
      const m = media.get(c.mediaId)
      if (!m || c.text || c.adjustment || c.effect) continue
      if (!(m.kind === 'audio' || (m.kind === 'video' && m.hasAudio))) continue
      const vols = c.keyframes?.volume
      if (c.volume <= 0 && !vols?.length) continue
      const sp = speedOf(c)
      const span = playedSpan(c)
      const D = clipDuration(c)
      // Played range [p0, p1) of the clip as an input of its own (reverse: from the reversed copy).
      const addInput = (p0: number, p1: number): number => {
        if (sp.reverse) inputArgs.push('-ss', f3(Math.max(0, m.duration - c.out + p0)), '-t', f3(p1 - p0), '-i', reverseProxyPath(m.path))
        else inputArgs.push('-ss', f3(c.in + p0), '-t', f3(p1 - p0), '-i', m.path)
        return idx++
      }
      const L = `a${labels.length}`
      const fmt = `asetpts=PTS-STARTPTS,aformat=sample_rates=${rate}:channel_layouts=stereo`
      let head: string
      if (sp.curve && sp.curve.length >= 2) {
        // Speed ramp: short pieces, each played at its average speed. Every piece is its own input
        // (no asplit: splitting one stream into many branches can stall ffmpeg's filter graph).
        const K = 16
        for (let k = 0; k < K; k++) {
          const p0 = (span * k) / K
          const p1 = (span * (k + 1)) / K
          const dt = tauAtPlayed(c, p1) - tauAtPlayed(c, p0)
          const tempo = atempoChain((p1 - p0) / Math.max(1e-6, dt))
          const i = addInput(p0, p1)
          filters.push(`[${i}:a]${fmt}${tempo ? ',' + tempo : ''}[${L}r${k}]`)
        }
        head = `${Array.from({ length: K }, (_, k) => `[${L}r${k}]`).join('')}concat=n=${K}:v=0:a=1`
      } else {
        const tempo = atempoChain(sp.rate)
        head = `[${addInput(0, span)}:a]${fmt}${tempo ? ',' + tempo : ''}`
      }
      let chain = head
      chain += vols?.length ? `,volume='${keyframeExpr(vols)}':eval=frame` : `,volume=${c.volume.toFixed(3)}`
      if (c.fadeIn) chain += `,afade=t=in:st=0:d=${f3(c.fadeIn)}`
      if (c.fadeOut) chain += `,afade=t=out:st=${f3(Math.max(0, D - c.fadeOut))}:d=${f3(c.fadeOut)}`
      chain += `,atrim=end=${f3(D)},adelay=${Math.round(c.start * 1000)}:all=1[${L}]`
      filters.push(chain)
      labels.push(L)
    }
  }
  if (labels.length === 0) {
    filters.push(`anullsrc=r=${rate}:cl=stereo,atrim=end=${f3(total)}[aout]`)
  } else {
    const mix =
      labels.length === 1
        ? `[${labels[0]}]anull`
        : `${labels.map((l) => `[${l}]`).join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0`
    filters.push(`${mix},apad,atrim=end=${f3(total)}[aout]`)
  }
  return filters
}

/** Render the timeline's audio mix to a 16 kHz mono WAV (input for speech recognition). */
export async function renderAudioMix(project: Project, outWav: string): Promise<void> {
  const total = projectDuration(project)
  if (total <= 0) throw new Error('The timeline is empty.')
  const inputs: string[] = []
  const filters = audioGraph(project, total, inputs, 0)
  const filterFile = `${outWav}.filter.txt`
  await fs.writeFile(filterFile, filters.join(';\n'))
  const res = await run(FFMPEG, [
    '-hide_banner', '-v', 'error', '-y', ...inputs,
    '-/filter_complex', filterFile, '-map', '[aout]', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', outWav
  ])
  fs.unlink(filterFile).catch(() => {})
  if (res.code !== 0) throw new Error(res.stderr.trim().split('\n').slice(-3).join('\n') || 'Audio extraction failed')
}

// ---------------- frame decoders ----------------

/**
 * Decodes one clip's source into RGBA frames at a fixed step of source time, read on demand.
 * Frame k shows source time `start + k * step`.
 */
class Decoder {
  private proc: ChildProcess
  private frames: Buffer[] = []
  private partial: Buffer[] = []
  private partialLen = 0
  private ended = false
  private waiters: (() => void)[] = []
  private index = -1 // index of `current`
  private current: Buffer | null = null
  readonly frameSize: number

  constructor(private req: FrameRequest, matrix: string) {
    this.frameSize = req.w * req.h * 4
    const vf = `setpts=PTS-STARTPTS,fps=${(1 / req.step).toFixed(6)}:round=up,scale=${req.w}:${req.h}:in_color_matrix=${matrix}:flags=bicubic,format=rgba`
    const args =
      req.kind === 'image'
        ? ['-v', 'error', '-i', req.path, '-frames:v', '1', '-vf', `scale=${req.w}:${req.h}:flags=bicubic,format=rgba`, '-f', 'rawvideo', '-']
        : ['-v', 'error', '-ss', f3(req.start), '-i', req.path, '-an', '-vf', vf, '-f', 'rawvideo', '-']
    this.proc = spawn(FFMPEG, args, { windowsHide: true })
    this.proc.stdout!.on('data', (d: Buffer) => this.onData(d))
    this.proc.stdout!.on('end', () => {
      this.ended = true
      this.wake()
    })
    this.proc.stderr!.on('data', () => {})
    this.proc.on('error', () => {
      this.ended = true
      this.wake()
    })
  }

  private wake(): void {
    const w = this.waiters
    this.waiters = []
    for (const f of w) f()
  }

  private onData(d: Buffer): void {
    this.partial.push(d)
    this.partialLen += d.length
    if (this.partialLen >= this.frameSize) {
      let all = Buffer.concat(this.partial)
      while (all.length >= this.frameSize) {
        this.frames.push(Buffer.from(all.subarray(0, this.frameSize)))
        all = all.subarray(this.frameSize)
      }
      this.partial = all.length ? [Buffer.from(all)] : []
      this.partialLen = all.length
    }
    // Back-pressure: don't buffer more than a few frames.
    if (this.frames.length >= 4) this.proc.stdout!.pause()
    this.wake()
  }

  private async next(): Promise<Buffer | null> {
    for (;;) {
      if (this.frames.length) {
        const f = this.frames.shift()!
        if (this.frames.length < 2) this.proc.stdout!.resume()
        return f
      }
      if (this.ended) return null
      await new Promise<void>((r) => this.waiters.push(r))
    }
  }

  /** Frame showing `time` (source seconds). Before the start: first frame; after the end: last frame. */
  async frameAt(time: number): Promise<Buffer | null> {
    if (this.req.kind === 'image') {
      if (!this.current) this.current = await this.next()
      return this.current
    }
    const target = Math.floor((time - this.req.start) / this.req.step + 1e-3)
    if (!this.current) {
      this.current = await this.next()
      this.index = 0
    }
    while (this.index < target) {
      const f = await this.next()
      if (!f) break
      this.current = f
      this.index++
    }
    return this.current
  }

  close(): void {
    this.proc.kill()
  }
}

// ---------------- export session ----------------

interface Session {
  encoder: ChildProcess
  output: string
  decoders: Map<string, Decoder>
  stderr: string
  closed: Promise<number>
  cancelled: boolean
  tmp: string
}

let session: Session | null = null

export async function exportBegin(project: Project, s: ExportSettings): Promise<void> {
  if (session) throw new Error('An export is already running.')
  const total = projectDuration(project)
  if (total <= 0) throw new Error('The timeline is empty.')
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cutly-export-'))
  // 1) Mix the audio into a file first. Keeping it out of the encoder means the encoder only ever
  //    waits for our video frames (one graph with both could stall while we wait for it to read).
  const audioInputs: string[] = []
  const audioFile = path.join(tmp, 'audio.wav')
  const filterFile = path.join(tmp, 'audio-filter.txt')
  await fs.writeFile(filterFile, audioGraph(project, total, audioInputs, 0).join(';\n'))
  const mixed = await run(FFMPEG, [
    '-hide_banner', '-v', 'error', '-y', ...audioInputs,
    '-/filter_complex', filterFile, '-map', '[aout]', '-c:a', 'pcm_s16le', audioFile
  ])
  if (mixed.code !== 0) {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
    throw new Error(mixed.stderr.trim().split('\n').slice(-4).join('\n') || 'Mixing the audio failed')
  }
  // 2) The encoder: frames from the UI on stdin + the mixed audio.
  const inputs: string[] = [
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${s.width}x${s.height}`, '-framerate', String(s.fps),
    '-thread_queue_size', '64', '-i', 'pipe:0', '-i', audioFile
  ]

  const q = { high: 0, medium: 1, low: 2 }[s.quality]
  let enc: string[]
  if (s.useGpu) {
    enc = ['-c:v', s.codec === 'hevc' ? 'hevc_nvenc' : 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', String([19, 24, 29][q]), '-b:v', '0']
  } else if (s.codec === 'hevc') {
    enc = ['-c:v', 'libx265', '-preset', 'medium', '-crf', String([20, 24, 28][q])]
  } else {
    enc = ['-c:v', 'libx264', '-preset', 'medium', '-crf', String([18, 23, 28][q])]
  }
  if (s.codec === 'hevc') enc.push('-tag:v', 'hvc1')
  const args = [
    '-hide_banner', '-y', '-v', 'error', ...inputs,
    '-map', '0:v', '-map', '1:a', '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    ...enc, '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-c:a', 'aac', '-b:a', '192k', '-t', f3(total), '-movflags', '+faststart', s.outputPath
  ]
  const encoder = spawn(FFMPEG, args, { windowsHide: true })
  const sess: Session = {
    encoder,
    output: s.outputPath,
    decoders: new Map(),
    stderr: '',
    closed: new Promise((resolve) => encoder.on('close', (code) => resolve(code ?? -1))),
    cancelled: false,
    tmp
  }
  encoder.stderr!.on('data', (d: Buffer) => (sess.stderr = (sess.stderr + d.toString()).slice(-4000)))
  encoder.stdin!.on('error', () => {})
  encoder.on('error', (e) => (sess.stderr += e.message))
  session = sess
}

/** A source frame for the compositor. Decoders are created on first use and read sequentially. */
export async function exportFrame(req: FrameRequest, time: number): Promise<Uint8Array | null> {
  if (!session) throw new Error('No export running.')
  let d = session.decoders.get(req.key)
  if (!d) {
    const matrix = req.kind === 'video' ? await colorMatrixOf(req.path) : 'bt709'
    d = new Decoder(req, matrix)
    session.decoders.set(req.key, d)
  }
  return d.frameAt(time)
}

export function exportRelease(key: string): void {
  const d = session?.decoders.get(key)
  if (d) {
    d.close()
    session!.decoders.delete(key)
  }
}

export async function exportWrite(frame: Uint8Array): Promise<void> {
  const s = session
  if (!s || s.cancelled) throw new Error('Export was cancelled.')
  if (s.encoder.exitCode !== null) throw new Error(s.stderr.trim().split('\n').slice(-6).join('\n') || 'The encoder stopped.')
  if (!s.encoder.stdin!.write(frame)) {
    await new Promise<void>((resolve, reject) => {
      const fail = (): void => reject(new Error(s.stderr.trim().split('\n').slice(-6).join('\n') || 'The encoder stopped.'))
      s.encoder.stdin!.once('drain', () => {
        s.encoder.off('close', fail)
        resolve()
      })
      s.encoder.once('close', fail)
    })
  }
}

async function endSession(): Promise<Session | null> {
  const s = session
  session = null
  if (!s) return null
  for (const d of s.decoders.values()) d.close()
  fs.rm(s.tmp, { recursive: true, force: true }).catch(() => {})
  return s
}

export async function exportFinish(): Promise<void> {
  const s = session
  if (!s) throw new Error('No export running.')
  s.encoder.stdin!.end()
  const code = await s.closed
  await endSession()
  if (code !== 0) throw new Error(s.stderr.trim().split('\n').slice(-6).join('\n') || `ffmpeg exited with code ${code}`)
}

export async function cancelExport(): Promise<void> {
  const s = session
  if (!s) return
  s.cancelled = true
  s.encoder.kill()
  await s.closed
  await endSession()
  fs.unlink(s.output).catch(() => {})
}
