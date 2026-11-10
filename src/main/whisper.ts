// Speech to text with whisper.cpp (runs locally, offline after the first download).
// The engine and the model are downloaded on first use into the app's data folder.
import { ChildProcess, spawn } from 'child_process'
import { createWriteStream, existsSync, promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { app } from 'electron'
import type { Project, TranscribeOptions, WhisperProgress, WhisperStatus, Word } from '../shared/types'
import { renderAudioMix } from './exporter'
import { run, systemInfo } from './ffmpeg'

const RELEASE = 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454'
const DOWNLOADS = {
  cpu: { url: `${RELEASE}/whisper-bin-x64.zip`, size: 8928640 },
  gpu: { url: `${RELEASE}/whisper-bin-win-cuda-12.4.0-x64.zip`, size: 684913404 },
  model: {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
    size: 574041195
  }
}

const root = (): string => path.join(app.getPath('userData'), 'whisper')
const engineDir = (kind: 'cpu' | 'gpu'): string => path.join(root(), kind)
const modelPath = (): string => path.join(root(), 'models', 'ggml-large-v3-turbo-q5_0.bin')

async function findExe(dir: string): Promise<string | null> {
  if (!existsSync(dir)) return null
  const entries = await fs.readdir(dir, { recursive: true })
  const hit = entries.find((e) => path.basename(String(e)).toLowerCase() === 'whisper-cli.exe')
  return hit ? path.join(dir, String(hit)) : null
}

export async function whisperStatus(): Promise<WhisperStatus> {
  const sys = await systemInfo()
  return {
    cpuEngine: !!(await findExe(engineDir('cpu'))),
    gpuEngine: !!(await findExe(engineDir('gpu'))),
    model: existsSync(modelPath()),
    nvidia: sys.nvenc,
    sizes: { cpu: DOWNLOADS.cpu.size, gpu: DOWNLOADS.gpu.size, model: DOWNLOADS.model.size }
  }
}

let abort: AbortController | null = null
let proc: ChildProcess | null = null

/** Download a file with progress; written to `<dest>.part` first so a broken download is never used. */
async function download(url: string, dest: string, onBytes: (n: number) => void): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true })
  const res = await fetch(url, { signal: abort?.signal, redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${path.basename(url)}`)
  const part = `${dest}.part`
  const out = createWriteStream(part)
  const reader = res.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!out.write(value)) await new Promise((r) => out.once('drain', r))
      onBytes(value.byteLength)
    }
    await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())))
  } catch (e) {
    out.destroy()
    await fs.rm(part, { force: true })
    throw e
  }
  await fs.rename(part, dest)
}

async function installEngine(kind: 'cpu' | 'gpu', onBytes: (n: number) => void): Promise<void> {
  const dir = engineDir(kind)
  const zip = path.join(root(), `${kind}.zip`)
  await download(DOWNLOADS[kind].url, zip, onBytes)
  await fs.rm(dir, { recursive: true, force: true })
  await fs.mkdir(dir, { recursive: true })
  // Windows 10+ ships bsdtar, which can unpack zip files.
  const res = await run('tar', ['-xf', zip, '-C', dir])
  await fs.rm(zip, { force: true })
  if (res.code !== 0 || !(await findExe(dir))) throw new Error(`Could not unpack the ${kind.toUpperCase()} engine. ${res.stderr}`)
}

/** Download whatever is missing. `gpu` adds the NVIDIA (CUDA) engine. */
export async function whisperDownload(gpu: boolean, onProgress: (p: WhisperProgress) => void): Promise<void> {
  const st = await whisperStatus()
  const jobs: { label: string; size: number; run: (cb: (n: number) => void) => Promise<void> }[] = []
  if (!st.cpuEngine) jobs.push({ label: 'speech engine', size: DOWNLOADS.cpu.size, run: (cb) => installEngine('cpu', cb) })
  if (gpu && !st.gpuEngine) jobs.push({ label: 'NVIDIA acceleration', size: DOWNLOADS.gpu.size, run: (cb) => installEngine('gpu', cb) })
  if (!st.model) jobs.push({ label: 'language model', size: DOWNLOADS.model.size, run: (cb) => download(DOWNLOADS.model.url, modelPath(), cb) })
  const total = jobs.reduce((a, j) => a + j.size, 0) || 1
  let done = 0
  abort = new AbortController()
  try {
    for (const job of jobs) {
      let last = 0
      await job.run((n) => {
        done += n
        const now = Date.now()
        if (now - last > 200) {
          last = now
          onProgress({ stage: 'download', label: `Downloading ${job.label}…`, percent: (done / total) * 100 })
        }
      })
    }
  } finally {
    abort = null
  }
}

/** Transcribe the whole timeline's audio. Returns words in timeline seconds. */
export async function whisperTranscribe(
  project: Project,
  opts: TranscribeOptions,
  onProgress: (p: WhisperProgress) => void
): Promise<Word[]> {
  const st = await whisperStatus()
  if (!st.cpuEngine || !st.model) throw new Error('Speech recognition is not downloaded yet.')
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cutly-stt-'))
  try {
    onProgress({ stage: 'audio', label: 'Preparing audio…', percent: 0 })
    const wav = path.join(tmp, 'audio.wav')
    await renderAudioMix(project, wav)

    const attempt = async (kind: 'cpu' | 'gpu'): Promise<Word[]> => {
      const exe = (await findExe(engineDir(kind)))!
      const outBase = path.join(tmp, `out-${kind}`)
      const threads = Math.max(2, Math.min(8, os.cpus().length - 2))
      const args = [
        '-m', modelPath(), '-f', wav, '-l', opts.language, '-t', String(threads),
        '-ml', '1', '-sow', '-oj', '-of', outBase, '-pp', '-np'
      ]
      if (kind === 'cpu') args.push('-ng')
      // On a new GPU generation the driver compiles CUDA code on the very first run (1–2 minutes),
      // then caches it. Tell the user so it doesn't look stuck.
      const warmMarker = path.join(engineDir('gpu'), '.warmed-up')
      const firstGpuRun = kind === 'gpu' && !existsSync(warmMarker)
      onProgress({
        stage: 'transcribe',
        label: firstGpuRun ? 'Preparing GPU, first time only (1–2 min)…' : kind === 'gpu' ? 'Transcribing (GPU)…' : 'Transcribing…',
        percent: 0
      })
      await new Promise<void>((resolve, reject) => {
        proc = spawn(exe, args, {
          cwd: path.dirname(exe),
          windowsHide: true,
          env: { ...process.env, CUDA_CACHE_MAXSIZE: String(2 * 1024 ** 3) }
        })
        let errTail = ''
        const onData = (d: Buffer): void => {
          const s = d.toString()
          errTail = (errTail + s).slice(-3000)
          const m = /progress\s*=\s*(\d+)%/.exec(s)
          if (m && Number(m[1]) > 0) onProgress({ stage: 'transcribe', label: 'Transcribing…', percent: Number(m[1]) })
        }
        proc.stdout?.on('data', onData)
        proc.stderr?.on('data', onData)
        proc.on('error', reject)
        proc.on('close', (code) => {
          proc = null
          if (code === 0) resolve()
          else reject(new Error(errTail.trim().split('\n').slice(-4).join('\n') || `whisper exited with code ${code}`))
        })
      })
      if (firstGpuRun) await fs.writeFile(warmMarker, new Date().toISOString()).catch(() => {})
      return parseWords(await fs.readFile(`${outBase}.json`, 'utf8'))
    }

    if (opts.useGpu && st.gpuEngine) {
      try {
        return await attempt('gpu')
      } catch (e) {
        if (cancelled) throw e
        onProgress({ stage: 'transcribe', label: 'GPU failed, using CPU…', percent: 0 })
      }
    }
    return await attempt('cpu')
  } finally {
    cancelled = false
    fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}

let cancelled = false

export function whisperCancel(): void {
  cancelled = true
  abort?.abort()
  proc?.kill()
}

interface WhisperJson {
  transcription?: { offsets: { from: number; to: number }; text: string }[]
}

function parseWords(json: string): Word[] {
  const data: WhisperJson = JSON.parse(json)
  const words: Word[] = []
  for (const seg of data.transcription ?? []) {
    const text = seg.text.trim()
    if (!text || /^\[.*\]$/.test(text) || /^\(.*\)$/.test(text)) continue
    const start = seg.offsets.from / 1000
    const end = Math.max(start + 0.05, seg.offsets.to / 1000)
    // A lone punctuation mark belongs to the previous word.
    if (/^[.,!?;:…"'»«]+$/.test(text) && words.length) {
      words[words.length - 1].text += text
      words[words.length - 1].end = end
      continue
    }
    words.push({ text, start, end })
  }
  return words
}
