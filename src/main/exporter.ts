// Turns a project (timeline) into one ffmpeg command and runs it.
import { ChildProcess, spawn } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import type { Clip, ExportProgress, ExportSettings, MediaItem, Project, TextLayer } from '../shared/types'
import { clipDuration, clipEnd, fitSize, projectDuration } from '../shared/types'
import { FFMPEG, run } from './ffmpeg'

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2)
const f3 = (n: number): string => n.toFixed(3)

/** Collects ffmpeg inputs; one input per clip (trimmed with -ss / -t). */
class Inputs {
  args: string[] = []
  private byClip = new Map<string, number>()
  private count = 0

  constructor(private fps: number) {}

  forClip(clip: Clip, m: MediaItem): number {
    const existing = this.byClip.get(clip.id)
    if (existing !== undefined) return existing
    const dur = f3(clipDuration(clip))
    if (m.kind === 'image') this.args.push('-loop', '1', '-framerate', String(this.fps), '-t', dur, '-i', m.path)
    else this.args.push('-ss', f3(clip.in), '-t', dur, '-i', m.path)
    const idx = this.count++
    this.byClip.set(clip.id, idx)
    return idx
  }

  raw(...args: string[]): number {
    this.args.push(...args)
    return this.count++
  }
}

/** Mix every clip with sound on a non-muted track into [aout]. */
function audioMix(project: Project, total: number, inputs: Inputs, filters: string[], rate = 48000): void {
  const media = new Map(project.media.map((m) => [m.id, m]))
  const labels: string[] = []
  for (const track of project.tracks) {
    if (track.muted) continue
    for (const clip of project.clips.filter((c) => c.trackId === track.id)) {
      const m = media.get(clip.mediaId)
      if (!m || clip.text || clip.volume <= 0) continue
      if (!(m.kind === 'audio' || (m.kind === 'video' && m.hasAudio))) continue
      const idx = inputs.forClip(clip, m)
      const label = `a${labels.length}`
      filters.push(
        `[${idx}:a]asetpts=PTS-STARTPTS,aformat=sample_rates=${rate}:channel_layouts=stereo,volume=${clip.volume.toFixed(3)},adelay=${Math.round(clip.start * 1000)}:all=1[${label}]`
      )
      labels.push(label)
    }
  }
  if (labels.length === 0) {
    filters.push(`anullsrc=r=${rate}:cl=stereo,atrim=end=${f3(total)}[aout]`)
    return
  }
  const mix =
    labels.length === 1
      ? `[${labels[0]}]anull`
      : `${labels.map((l) => `[${l}]`).join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0`
  filters.push(`${mix},apad,atrim=end=${f3(total)}[aout]`)
}

interface Built {
  args: string[]
  filter: string
  total: number
}

export function buildExport(project: Project, s: ExportSettings, textLists: Map<string, string>): Built {
  const total = projectDuration(project)
  if (total <= 0) throw new Error('The timeline is empty.')

  const W = even(s.width)
  const H = even(s.height)
  const k = W / project.width // project pixels -> export pixels
  const media = new Map<string, MediaItem>(project.media.map((m) => [m.id, m]))
  const inputs = new Inputs(s.fps)
  const filters: string[] = []

  // ---- video: draw bottom track first, top track last ----
  filters.push(`color=c=${project.background}:s=${W}x${H}:r=${s.fps}:d=${f3(total)}[base]`)
  let current = 'base'
  let n = 0
  const videoTracks = project.tracks.filter((t) => t.kind === 'video' && !t.hidden).reverse()
  for (const track of videoTracks) {
    const clips = project.clips.filter((c) => c.trackId === track.id).sort((a, b) => a.start - b.start)
    for (const clip of clips) {
      const m = media.get(clip.mediaId)
      if (!m || clip.text || m.kind === 'audio') continue
      const idx = inputs.forClip(clip, m)
      const tr = clip.transform
      const fit = fitSize(m.width, m.height, project.width, project.height)
      const w = even(fit.w * tr.scale * k)
      const h = even(fit.h * tr.scale * k)
      const rad = (tr.rotation * Math.PI) / 180
      const rw = even(Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad)))
      const rh = even(Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad)))
      const ox = Math.round(W / 2 + tr.x * k - rw / 2)
      const oy = Math.round(H / 2 + tr.y * k - rh / 2)

      let chain = `[${idx}:v]setpts=PTS-STARTPTS+${f3(clip.start)}/TB,scale=${w}:${h},setsar=1,format=rgba`
      if (tr.rotation % 360 !== 0) chain += `,rotate=${rad.toFixed(5)}:ow=${rw}:oh=${rh}:c=none`
      if (tr.opacity < 1) chain += `,colorchannelmixer=aa=${tr.opacity.toFixed(3)}`
      chain += `[v${n}]`
      filters.push(chain)
      filters.push(
        `[${current}][v${n}]overlay=x=${ox}:y=${oy}:eof_action=pass:enable='between(t,${f3(clip.start)},${f3(clipEnd(clip))})'[o${n}]`
      )
      current = `o${n}`
      n++
    }
    // Text on this track: a pre-rendered sequence of transparent full-frame PNGs.
    const list = textLists.get(track.id)
    if (list) {
      const idx = inputs.raw('-f', 'concat', '-safe', '0', '-i', list)
      filters.push(`[${idx}:v]scale=${W}:${H},format=rgba,setpts=PTS-STARTPTS[t${n}]`)
      filters.push(`[${current}][t${n}]overlay=0:0:eof_action=pass[o${n}]`)
      current = `o${n}`
      n++
    }
  }
  filters.push(`[${current}]format=yuv420p[vout]`)

  audioMix(project, total, inputs, filters)

  // ---- encoder ----
  const q = { high: 0, medium: 1, low: 2 }[s.quality]
  let enc: string[]
  if (s.useGpu) {
    const cq = [19, 24, 29][q]
    enc = ['-c:v', s.codec === 'hevc' ? 'hevc_nvenc' : 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', String(cq), '-b:v', '0']
  } else if (s.codec === 'hevc') {
    enc = ['-c:v', 'libx265', '-preset', 'medium', '-crf', String([20, 24, 28][q])]
  } else {
    enc = ['-c:v', 'libx264', '-preset', 'medium', '-crf', String([18, 23, 28][q])]
  }
  if (s.codec === 'hevc') enc.push('-tag:v', 'hvc1')

  const args = [
    '-hide_banner', '-y', '-nostats', '-progress', 'pipe:1',
    ...inputs.args,
    '-/filter_complex', '__FILTER__',
    '-map', '[vout]', '-map', '[aout]',
    ...enc,
    '-pix_fmt', 'yuv420p', '-r', String(s.fps),
    '-c:a', 'aac', '-b:a', '192k',
    '-t', f3(total), '-movflags', '+faststart',
    s.outputPath
  ]
  return { args, filter: filters.join(';\n'), total }
}

/** Writes an ffconcat playlist that shows each PNG for its duration. */
async function writeConcatList(layer: TextLayer, dir: string): Promise<string> {
  const q = (p: string): string => `'${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`
  const lines = ['ffconcat version 1.0']
  for (const seg of layer.segments) lines.push(`file ${q(seg.png)}`, `duration ${seg.duration.toFixed(4)}`)
  // The last entry must be repeated, otherwise its duration is ignored.
  const last = layer.segments[layer.segments.length - 1]
  if (last) lines.push(`file ${q(last.png)}`)
  const file = path.join(dir, `text-${layer.trackId}.ffconcat`)
  await fs.writeFile(file, lines.join('\n'))
  return file
}

// ---------- temporary files for text frames ----------

let tempDir: string | null = null

export async function newTempDir(): Promise<string> {
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cutly-export-'))
  return tempDir
}

export async function writeTempFile(name: string, data: Uint8Array): Promise<string> {
  if (!tempDir) await newTempDir()
  const file = path.join(tempDir!, path.basename(name))
  await fs.writeFile(file, data)
  return file
}

async function cleanTemp(): Promise<void> {
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  tempDir = null
}

let running: { proc: ChildProcess; output: string; cancelled: boolean } | null = null

export async function startExport(
  project: Project,
  settings: ExportSettings,
  onProgress: (p: ExportProgress) => void
): Promise<void> {
  if (running) throw new Error('An export is already running.')
  const dir = tempDir ?? (await newTempDir())
  const textLists = new Map<string, string>()
  for (const layer of settings.textLayers ?? []) textLists.set(layer.trackId, await writeConcatList(layer, dir))
  const built = buildExport(project, settings, textLists)
  // The filter graph goes into a file: long timelines would exceed the Windows command-line limit.
  const filterFile = path.join(dir, 'filter.txt')
  await fs.writeFile(filterFile, built.filter)
  const args = built.args.map((a) => (a === '__FILTER__' ? filterFile : a))

  const proc = spawn(FFMPEG, args, { windowsHide: true })
  const state = { proc, output: settings.outputPath, cancelled: false }
  running = state
  const started = Date.now()
  let stderr = ''
  let buf = ''

  proc.stdout.on('data', (d: Buffer) => {
    buf += d.toString()
    const lines = buf.split(/\r?\n/)
    buf = lines.pop() ?? ''
    let outTime = -1
    let fps: number | undefined
    for (const line of lines) {
      const [key, value] = line.split('=')
      if (key === 'out_time_us' || key === 'out_time_ms') outTime = Number(value) / 1e6
      if (key === 'fps') fps = Number(value)
    }
    if (outTime >= 0) {
      const percent = Math.min(99.9, (outTime / built.total) * 100)
      const elapsed = (Date.now() - started) / 1000
      const eta = percent > 1 ? (elapsed / percent) * (100 - percent) : undefined
      onProgress({ percent, fps, etaSeconds: eta })
    }
  })
  proc.stderr.on('data', (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-4000)
  })

  proc.on('close', async (code) => {
    running = null
    await cleanTemp()
    if (state.cancelled) {
      fs.unlink(settings.outputPath).catch(() => {})
      onProgress({ percent: 0, cancelled: true })
    } else if (code === 0) {
      onProgress({ percent: 100, done: true })
    } else {
      const lines = stderr.trim().split('\n').slice(-6).join('\n')
      onProgress({ percent: 0, error: lines || `ffmpeg exited with code ${code}` })
    }
  })
  proc.on('error', (e) => {
    running = null
    onProgress({ percent: 0, error: e.message })
  })
}

export function cancelExport(): void {
  if (!running) return
  running.cancelled = true
  running.proc.kill()
}

/** Render the timeline's audio mix to a 16 kHz mono WAV (input for speech recognition). */
export async function renderAudioMix(project: Project, outWav: string): Promise<void> {
  const total = projectDuration(project)
  if (total <= 0) throw new Error('The timeline is empty.')
  const inputs = new Inputs(30)
  const filters: string[] = []
  audioMix(project, total, inputs, filters)
  const filterFile = `${outWav}.filter.txt`
  await fs.writeFile(filterFile, filters.join(';\n'))
  const res = await run(FFMPEG, [
    '-hide_banner', '-v', 'error', '-y', ...inputs.args,
    '-/filter_complex', filterFile, '-map', '[aout]', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', outWav
  ])
  fs.unlink(filterFile).catch(() => {})
  if (res.code !== 0) throw new Error(res.stderr.trim().split('\n').slice(-3).join('\n') || 'Audio extraction failed')
}
