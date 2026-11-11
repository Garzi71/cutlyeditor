// Everything that talks to the ffmpeg / ffprobe command line tools:
// reading media info, generating thumbnails and audio waveforms.
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, promises as fs, statSync } from 'fs'
import path from 'path'
import { app } from 'electron'
import type { MediaItem, MediaKind, SystemInfo } from '../shared/types'
import { PEAKS_PER_SECOND } from '../shared/types'

/**
 * FFmpeg ships inside the installed app (resources/ffmpeg). During development the copy in
 * <project>/resources/ffmpeg is used if present, otherwise whatever `ffmpeg` is on the PATH.
 */
function locate(name: 'ffmpeg' | 'ffprobe'): string {
  const exe = process.platform === 'win32' ? `${name}.exe` : name
  const dirs = app.isPackaged
    ? [path.join(process.resourcesPath, 'ffmpeg')]
    : [path.join(app.getAppPath(), 'resources', 'ffmpeg')]
  for (const dir of dirs) {
    const p = path.join(dir, exe)
    if (existsSync(p)) return p
  }
  return name
}

export const FFMPEG = locate('ffmpeg')
export const FFPROBE = locate('ffprobe')

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff'])

interface RunResult {
  code: number
  stdout: Buffer
  stderr: string
}

export function run(cmd: string, args: string[], cwd?: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, cwd })
    const out: Buffer[] = []
    let err = ''
    p.stdout.on('data', (d: Buffer) => out.push(d))
    p.stderr.on('data', (d: Buffer) => (err += d.toString()))
    p.on('error', reject)
    p.on('close', (code) => resolve({ code: code ?? -1, stdout: Buffer.concat(out), stderr: err }))
  })
}

function parseRate(r?: string): number {
  if (!r) return 0
  const [a, b] = r.split('/').map(Number)
  if (!b) return a || 0
  return a / b
}

export async function probe(file: string): Promise<Omit<MediaItem, 'id'>> {
  const res = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file])
  if (res.code !== 0) throw new Error(res.stderr.trim() || 'ffprobe failed')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const info: any = JSON.parse(res.stdout.toString())
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const streams: any[] = info.streams ?? []
  const v = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
  const a = streams.find((s) => s.codec_type === 'audio')
  const ext = path.extname(file).toLowerCase()

  let kind: MediaKind
  if (IMAGE_EXT.has(ext) && v) kind = 'image'
  else if (v) kind = 'video'
  else if (a) kind = 'audio'
  else throw new Error('No video or audio stream found')

  const duration =
    kind === 'image' ? 0 : parseFloat(info.format?.duration ?? v?.duration ?? a?.duration ?? '0') || 0

  let width = v?.width ?? 0
  let height = v?.height ?? 0
  // Phone videos are often stored sideways with a rotation flag.
  const rotData = v?.side_data_list?.find((d: { rotation?: number }) => d.rotation !== undefined)
  const rotation = Number(rotData?.rotation ?? v?.tags?.rotate ?? 0)
  if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width]

  const stat = await fs.stat(file)
  return {
    path: file,
    name: path.basename(file),
    kind,
    duration,
    width,
    height,
    fps: kind === 'video' ? parseRate(v?.avg_frame_rate) || parseRate(v?.r_frame_rate) || 30 : 30,
    hasAudio: !!a,
    size: stat.size
  }
}

async function cacheDir(file: string): Promise<string> {
  const stat = await fs.stat(file)
  const key = createHash('sha1').update(`${file}|${stat.size}|${stat.mtimeMs}`).digest('hex').slice(0, 16)
  const dir = path.join(app.getPath('userData'), 'cache', key)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** Run async jobs with limited parallelism. */
async function pool<T>(items: T[], limit: number, fn: (item: T, i: number) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      await fn(items[i], i)
    }
  })
  await Promise.all(workers)
}

export function thumbnailCount(duration: number): number {
  return Math.max(1, Math.min(48, Math.ceil(duration / 1.5)))
}

/** Thumbnails spread evenly: thumbnail i shows time duration * (i + 0.5) / count. */
export async function makeThumbnails(file: string, kind: MediaKind, duration: number): Promise<string[]> {
  if (kind === 'audio') return []
  const dir = await cacheDir(file)
  if (kind === 'image') {
    const out = path.join(dir, 'thumb_000.jpg')
    if (!(await exists(out))) {
      await run(FFMPEG, ['-v', 'error', '-y', '-i', file, '-frames:v', '1', '-vf', 'scale=-2:120', '-q:v', '4', out])
    }
    return (await exists(out)) ? [out] : []
  }
  const count = thumbnailCount(duration)
  const results: (string | null)[] = new Array(count).fill(null)
  await pool(
    Array.from({ length: count }, (_, i) => i),
    4,
    async (i) => {
      const out = path.join(dir, `thumb_${String(i).padStart(3, '0')}.jpg`)
      if (!(await exists(out))) {
        const t = Math.max(0, (duration * (i + 0.5)) / count)
        await run(FFMPEG, [
          '-v', 'error', '-y', '-ss', t.toFixed(3), '-i', file,
          '-frames:v', '1', '-vf', 'scale=-2:120', '-q:v', '5', out
        ])
      }
      if (await exists(out)) results[i] = out
    }
  )
  // Fill gaps (e.g. a seek past the last frame) with the nearest neighbour.
  const valid = results.filter((r): r is string => !!r)
  if (!valid.length) return []
  let last = valid[0]
  return results.map((r) => (r ? (last = r) : last))
}

/** Audio waveform peaks: PEAKS_PER_SECOND values per second, normalised 0..1. */
export async function makePeaks(file: string): Promise<number[]> {
  const dir = await cacheDir(file)
  const cached = path.join(dir, 'peaks.json')
  if (await exists(cached)) {
    try {
      return JSON.parse(await fs.readFile(cached, 'utf8'))
    } catch {
      /* regenerate */
    }
  }
  const rate = 8000
  const bucket = rate / PEAKS_PER_SECOND
  const peaks: number[] = []
  await new Promise<void>((resolve, reject) => {
    const p = spawn(FFMPEG, ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(rate), '-f', 's16le', '-'], {
      windowsHide: true
    })
    let leftover: Buffer | null = null
    let count = 0
    let max = 0
    p.stdout.on('data', (chunk: Buffer) => {
      const buf = leftover ? Buffer.concat([leftover, chunk]) : chunk
      const usable = buf.length - (buf.length % 2)
      for (let i = 0; i < usable; i += 2) {
        const v = Math.abs(buf.readInt16LE(i)) / 32768
        if (v > max) max = v
        if (++count >= bucket) {
          peaks.push(max)
          count = 0
          max = 0
        }
      }
      leftover = usable < buf.length ? buf.subarray(usable) : null
    })
    p.stderr.on('data', () => {})
    p.on('error', reject)
    p.on('close', () => {
      if (count > 0) peaks.push(max)
      resolve()
    })
  })
  // Normalise so quiet recordings are still visible.
  const top = peaks.reduce((m, v) => Math.max(m, v), 0) || 1
  const norm = peaks.map((v) => Math.round((v / top) * 1000) / 1000)
  await fs.writeFile(cached, JSON.stringify(norm))
  return norm
}

let sysInfo: Promise<SystemInfo> | null = null

export function systemInfo(): Promise<SystemInfo> {
  if (!sysInfo) {
    sysInfo = (async () => {
      try {
        const v = await run(FFMPEG, ['-version'])
        const version = v.stdout.toString().split('\n')[0]?.trim() ?? ''
        // Actually try to encode a tiny clip on the GPU: listing the encoder isn't enough.
        const t = await run(FFMPEG, [
          '-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=320x240:d=0.2', '-c:v', 'h264_nvenc', '-f', 'null', '-'
        ])
        return { ffmpegOk: v.code === 0, ffmpegVersion: version, nvenc: t.code === 0 }
      } catch {
        return { ffmpegOk: false, ffmpegVersion: '', nvenc: false }
      }
    })()
  }
  return sysInfo
}

/**
 * Small RGB frames for color analysis: `w`x`h` RGB24 per time, concatenated.
 * Decoded by ffmpeg, i.e. the same way the export sees the video.
 */
export async function sampleFrames(file: string, times: number[], w: number, h: number): Promise<Buffer> {
  const frames: Buffer[] = []
  for (const t of times) {
    const res = await run(FFMPEG, [
      '-v', 'error', '-ss', Math.max(0, t).toFixed(3), '-i', file, '-frames:v', '1',
      '-vf', `scale=${w}:${h}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'
    ])
    if (res.code === 0 && res.stdout.length === w * h * 3) frames.push(res.stdout)
  }
  return Buffer.concat(frames)
}

const matrixCache = new Map<string, Promise<string>>()

/**
 * The YUV->RGB matrix to decode a video with. Untagged video is treated as BT.709, like
 * Chromium does in the preview (ffmpeg would otherwise assume BT.601 and shift colors).
 */
export function colorMatrixOf(file: string): Promise<string> {
  let hit = matrixCache.get(file)
  if (!hit) {
    hit = run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=color_space', '-of', 'csv=p=0', file])
      .then((r) => {
        const cs = r.stdout.toString().trim()
        if (cs === 'bt470bg' || cs === 'smpte170m') return 'bt601'
        if (cs.startsWith('bt2020')) return 'bt2020'
        if (cs === 'smpte240m') return 'smpte240m'
        return 'bt709'
      })
      .catch(() => 'bt709')
    matrixCache.set(file, hit)
  }
  return hit
}

// ---------- reversed copies (reverse playback) ----------

/** Where the reversed copy of a media file lives (in the cache folder). */
export function reverseProxyPath(file: string): string {
  const st = statSync(file)
  const key = createHash('sha1').update(`${file}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 16)
  return path.join(app.getPath('userData'), 'cache', key, 'reverse.mp4')
}

const reversing = new Map<string, Promise<string>>()

/**
 * Make a reversed copy (video and audio). Reversing needs the whole stream in memory, so it is done
 * in short chunks that are reversed one by one and joined in the opposite order.
 */
export function makeReverseProxy(file: string, duration: number, hasAudio: boolean): Promise<string> {
  const out = reverseProxyPath(file)
  let job = reversing.get(out)
  if (job) return job
  job = (async () => {
    if (await exists(out)) return out
    await fs.mkdir(path.dirname(out), { recursive: true })
    const work = `${out}.parts`
    await fs.mkdir(work, { recursive: true })
    const CHUNK = 3
    const n = Math.max(1, Math.ceil(duration / CHUNK))
    const parts: string[] = []
    for (let i = 0; i < n; i++) {
      // i = 0 is the END of the source: it comes first in the reversed copy.
      const end = duration - i * CHUNK
      const start = Math.max(0, end - CHUNK)
      const part = path.join(work, `p${String(i).padStart(4, '0')}.mp4`)
      const res = await run(FFMPEG, [
        '-v', 'error', '-y', '-ss', start.toFixed(3), '-t', (end - start).toFixed(3), '-i', file,
        '-vf', 'reverse', ...(hasAudio ? ['-af', 'areverse', '-c:a', 'aac', '-b:a', '192k'] : ['-an']),
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-g', '15', '-pix_fmt', 'yuv420p', part
      ])
      if (res.code !== 0) throw new Error(res.stderr.trim().split('\n').pop() || 'reverse failed')
      parts.push(part)
    }
    const list = path.join(work, 'list.txt')
    await fs.writeFile(list, parts.map((p) => `file '${p.split(path.sep).join('/')}'`).join('\n'))
    const tmpOut = `${out}.tmp.mp4`
    const res = await run(FFMPEG, ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', tmpOut])
    if (res.code !== 0) throw new Error(res.stderr.trim().split('\n').pop() || 'reverse join failed')
    await fs.rename(tmpOut, out)
    await fs.rm(work, { recursive: true, force: true })
    return out
  })()
  reversing.set(out, job)
  job.catch(() => reversing.delete(out))
  return job
}

/**
 * Silent stretches in [from, to) of a file's audio, as source times. `threshold` in dB (e.g. -35),
 * `minDuration` in seconds.
 */
export async function detectSilence(
  file: string,
  from: number,
  to: number,
  threshold: number,
  minDuration: number
): Promise<[number, number][]> {
  const res = await run(FFMPEG, [
    '-hide_banner', '-nostats', '-ss', from.toFixed(3), '-t', Math.max(0.01, to - from).toFixed(3), '-i', file,
    '-vn', '-af', `silencedetect=noise=${threshold}dB:d=${minDuration}`, '-f', 'null', '-'
  ])
  const out: [number, number][] = []
  let start: number | null = null
  for (const line of res.stderr.split(/\r?\n/)) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(line)
    const e = /silence_end:\s*(-?[\d.]+)/.exec(line)
    if (s) start = Math.max(0, Number(s[1]))
    if (e && start !== null) {
      out.push([from + start, from + Number(e[1])])
      start = null
    }
  }
  // Silence running to the end of the range.
  if (start !== null) out.push([from + start, to])
  return out
}


// ---------- noise reduction ----------

/** Folder with the bundled RNNoise model (std.rnnn). ffmpeg runs there and refers to it by name. */
export function modelsDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'models') : path.join(app.getAppPath(), 'resources', 'models')
}

/**
 * ffmpeg filter for noise reduction at strength 0..1 (needs to run with cwd = modelsDir()).
 * RNNoise needs 48 kHz float input, and its last partial block can come out as NaN (which breaks
 * the AAC encoder), so NaN samples are replaced by silence.
 */
export const denoiseFilter = (strength: number): string =>
  `aresample=48000,aformat=sample_fmts=flt,arnndn=m=std.rnnn:mix=${Math.min(1, Math.max(0, strength)).toFixed(2)},aeval='if(isnan(val(ch)),0,val(ch))':c=same`

const denoising = new Map<string, Promise<string>>()

/** Noise-reduced copy of a file's audio for the preview (cached per strength). */
export function makeDenoisedAudio(file: string, strength: number): Promise<string> {
  const s = Math.round(strength * 10) / 10
  const key = `${file}|${s}`
  let job = denoising.get(key)
  if (job) return job
  job = (async () => {
    const out = path.join(await cacheDir(file), `denoise-${s.toFixed(1)}.m4a`)
    if (await exists(out)) return out
    const tmp = `${out}.tmp.m4a`
    const res = await run(FFMPEG, ['-v', 'error', '-y', '-i', file, '-vn', '-af', denoiseFilter(s), '-c:a', 'aac', '-b:a', '192k', tmp], modelsDir())
    if (res.code !== 0) throw new Error(res.stderr.trim().split('\n').pop() || 'noise reduction failed')
    await fs.rename(tmp, out)
    return out
  })()
  denoising.set(key, job)
  job.catch(() => denoising.delete(key))
  return job
}

/**
 * Loudness spread of a range (peak level in dB per 50 ms window; silencedetect also compares peaks). Used to pick a silence threshold that
 * sits between the background noise and the speech of this particular recording.
 */
export async function suggestSilenceThreshold(file: string, from: number, to: number): Promise<{ noise: number; speech: number; threshold: number }> {
  const res = await run(FFMPEG, [
    '-hide_banner', '-nostats', '-ss', from.toFixed(3), '-t', Math.max(0.05, to - from).toFixed(3), '-i', file, '-vn',
    '-af', 'aresample=48000,asetnsamples=2400,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.Peak_level:file=-',
    '-f', 'null', '-'
  ])
  const levels = res.stdout
    .toString()
    .split(/\r?\n/)
    .map((l) => /Peak_level=(-?[\d.]+|-inf)/.exec(l)?.[1])
    .filter((v): v is string => !!v)
    .map((v) => (v === '-inf' ? -120 : Number(v)))
    .sort((a, b) => a - b)
  if (!levels.length) return { noise: -60, speech: -20, threshold: -35 }
  const at = (p: number): number => levels[Math.min(levels.length - 1, Math.floor(p * levels.length))]
  const noise = at(0.1)
  const speech = at(0.9)
  const threshold = Math.round(Math.min(speech - 6, Math.max(noise + 3, noise + 0.35 * (speech - noise))))
  return { noise, speech, threshold }
}
