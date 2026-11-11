// Everything that talks to the ffmpeg / ffprobe command line tools:
// reading media info, generating thumbnails and audio waveforms.
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, promises as fs } from 'fs'
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

export function run(cmd: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true })
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
