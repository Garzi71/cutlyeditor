// Turns a project (timeline) into one ffmpeg command and runs it.
import { ChildProcess, spawn } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import type { Clip, ExportProgress, ExportSettings, MediaItem, Project } from '../shared/types'
import { clipDuration, clipEnd, fitSize, projectDuration } from '../shared/types'
import { FFMPEG } from './ffmpeg'

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2)
const f3 = (n: number): string => n.toFixed(3)

interface Built {
  args: string[]
  filter: string
  total: number
}

export function buildExport(project: Project, s: ExportSettings): Built {
  const total = projectDuration(project)
  if (total <= 0) throw new Error('The timeline is empty.')

  const W = even(s.width)
  const H = even(s.height)
  const k = W / project.width // project pixels -> export pixels
  const media = new Map<string, MediaItem>(project.media.map((m) => [m.id, m]))

  const inputs: string[] = []
  const filters: string[] = []
  const inputIndex = new Map<string, number>() // clip id -> ffmpeg input index

  const addInput = (clip: Clip, m: MediaItem): number => {
    const existing = inputIndex.get(clip.id)
    if (existing !== undefined) return existing
    const dur = f3(clipDuration(clip))
    if (m.kind === 'image') {
      inputs.push('-loop', '1', '-framerate', String(s.fps), '-t', dur, '-i', m.path)
    } else {
      inputs.push('-ss', f3(clip.in), '-t', dur, '-i', m.path)
    }
    const idx = inputIndex.size
    inputIndex.set(clip.id, idx)
    return idx
  }

  // ---- video: draw bottom track first, top track last ----
  filters.push(`color=c=${project.background}:s=${W}x${H}:r=${s.fps}:d=${f3(total)}[base]`)
  let current = 'base'
  let n = 0
  const videoTracks = project.tracks.filter((t) => t.kind === 'video' && !t.hidden).reverse()
  for (const track of videoTracks) {
    const clips = project.clips.filter((c) => c.trackId === track.id).sort((a, b) => a.start - b.start)
    for (const clip of clips) {
      const m = media.get(clip.mediaId)
      if (!m || m.kind === 'audio') continue
      const idx = addInput(clip, m)
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
  }
  filters.push(`[${current}]format=yuv420p[vout]`)

  // ---- audio: every clip with sound on a non-muted track ----
  const audioLabels: string[] = []
  for (const track of project.tracks) {
    if (track.muted) continue
    for (const clip of project.clips.filter((c) => c.trackId === track.id)) {
      const m = media.get(clip.mediaId)
      if (!m || clip.volume <= 0) continue
      if (!(m.kind === 'audio' || (m.kind === 'video' && m.hasAudio))) continue
      const idx = addInput(clip, m)
      const ms = Math.round(clip.start * 1000)
      const label = `a${audioLabels.length}`
      filters.push(
        `[${idx}:a]asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,volume=${clip.volume.toFixed(3)},adelay=${ms}:all=1[${label}]`
      )
      audioLabels.push(label)
    }
  }
  if (audioLabels.length === 0) {
    filters.push(`anullsrc=r=48000:cl=stereo,atrim=end=${f3(total)}[aout]`)
  } else {
    const mix =
      audioLabels.length === 1
        ? `[${audioLabels[0]}]anull`
        : `${audioLabels.map((l) => `[${l}]`).join('')}amix=inputs=${audioLabels.length}:normalize=0:dropout_transition=0`
    filters.push(`${mix},apad,atrim=end=${f3(total)}[aout]`)
  }

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
    ...inputs,
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

let running: { proc: ChildProcess; output: string; cancelled: boolean } | null = null

export async function startExport(
  project: Project,
  settings: ExportSettings,
  onProgress: (p: ExportProgress) => void
): Promise<void> {
  if (running) throw new Error('An export is already running.')
  const built = buildExport(project, settings)
  // The filter graph goes into a file: long timelines would exceed the Windows command-line limit.
  const filterFile = path.join(os.tmpdir(), `cutly-filter-${Date.now()}.txt`)
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
    fs.unlink(filterFile).catch(() => {})
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
