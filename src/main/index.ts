// Electron main process: creates the window, serves local media files to the UI
// and handles everything that needs disk / ffmpeg access.
import { app, BrowserWindow, dialog, ipcMain, protocol, session, shell } from 'electron'
import { createReadStream, promises as fs } from 'fs'
import path from 'path'
import { Readable } from 'stream'
import type { ExportSettings, FrameRequest, Project, RecentProject, TranscribeOptions } from '../shared/types'
import { cancelExport, exportBegin, exportFinish, exportFrame, exportRelease, exportWrite } from './exporter'
import { whisperCancel, whisperDownload, whisperStatus, whisperTranscribe } from './whisper'
import { makePeaks, makeReverseProxy, makeThumbnails, probe, sampleFrames, systemInfo } from './ffmpeg'
import { initUpdater, installingUpdate } from './updater'

// Developer aid: `CUTLY_DEBUG_PORT=9222 npm run dev` allows inspecting the UI from outside.
if (process.env.CUTLY_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.CUTLY_DEBUG_PORT)

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true }
  }
])

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.bmp': 'image/bmp', '.gif': 'image/gif'
}

/** media://local/<encoded absolute path> -> file contents, with Range support so videos can seek. */
function registerMediaProtocol(): void {
  protocol.handle('media', async (req) => {
    const url = new URL(req.url)
    const filePath = decodeURIComponent(url.pathname.slice(1))
    const base = {
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
    }
    let size: number
    try {
      size = (await fs.stat(filePath)).size
    } catch {
      return new Response('Not found', { status: 404 })
    }
    const range = req.headers.get('range')
    const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null
    if (m) {
      const start = m[1] ? Number(m[1]) : 0
      const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
      if (start >= size || start > end) {
        return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } })
      }
      const stream = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream
      return new Response(stream, {
        status: 206,
        headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) }
      })
    }
    const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream
    return new Response(stream, { status: 200, headers: { ...base, 'Content-Length': String(size) } })
  })
}

let win: BrowserWindow | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    backgroundColor: '#0d0d0f',
    title: 'Cutly',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#131316', symbolColor: '#c9c9d1', height: 44 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      // Exports render frames in the UI; keep full speed while the window is minimized.
      backgroundThrottling: false
    }
  })
  win.once('ready-to-show', () => win?.show())
  // Ask the UI first, so unsaved changes aren't lost by closing the window.
  let allowClose = false
  win.on('close', (e) => {
    if (allowClose || installingUpdate || !win || win.webContents.isDestroyed()) return
    e.preventDefault()
    win.webContents.send('app:close-request')
  })
  ipcMain.removeHandler('app:confirm-close')
  ipcMain.handle('app:confirm-close', () => {
    allowClose = true
    win?.close()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

// ---------- recent projects ----------
const recentFile = (): string => path.join(app.getPath('userData'), 'recent.json')

async function readRecent(): Promise<RecentProject[]> {
  try {
    const list: RecentProject[] = JSON.parse(await fs.readFile(recentFile(), 'utf8'))
    const alive = await Promise.all(list.map((r) => fs.access(r.path).then(() => true, () => false)))
    return list.filter((_, i) => alive[i])
  } catch {
    return []
  }
}

async function addRecent(p: string, name: string): Promise<void> {
  const list = (await readRecent()).filter((r) => r.path !== p)
  list.unshift({ path: p, name, openedAt: Date.now() })
  await fs.writeFile(recentFile(), JSON.stringify(list.slice(0, 12), null, 2))
}

// ---------- IPC ----------
function registerIpc(): void {
  ipcMain.handle('system:info', () => systemInfo())

  ipcMain.handle('dialog:openMedia', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Import media',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Media', extensions: ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    return r.canceled ? [] : r.filePaths
  })

  ipcMain.handle('media:probe', (_e, file: string) => probe(file))
  ipcMain.handle('media:thumbnails', (_e, file: string, kind, duration: number) => makeThumbnails(file, kind, duration))
  ipcMain.handle('media:peaks', (_e, file: string) => makePeaks(file))

  ipcMain.handle('project:save', async (_e, project: Project, filePath: string | null, saveAs: boolean) => {
    let target = filePath
    if (!target || saveAs) {
      const r = await dialog.showSaveDialog(win!, {
        title: 'Save project',
        defaultPath: `${project.name || 'Untitled'}.cutly`,
        filters: [{ name: 'Cutly project', extensions: ['cutly'] }]
      })
      if (r.canceled || !r.filePath) return null
      target = r.filePath
    }
    await fs.writeFile(target, JSON.stringify(project, null, 2), 'utf8')
    await addRecent(target, project.name)
    return target
  })

  ipcMain.handle('project:open', async (_e, filePath?: string) => {
    let target = filePath
    if (!target) {
      const r = await dialog.showOpenDialog(win!, {
        title: 'Open project',
        properties: ['openFile'],
        filters: [{ name: 'Cutly project', extensions: ['cutly'] }]
      })
      if (r.canceled || !r.filePaths[0]) return null
      target = r.filePaths[0]
    }
    const project: Project = JSON.parse(await fs.readFile(target, 'utf8'))
    await addRecent(target, project.name)
    return { project, path: target }
  })

  ipcMain.handle('project:recent', () => readRecent())

  ipcMain.handle('export:chooseFile', async (_e, defaultName: string) => {
    const r = await dialog.showSaveDialog(win!, {
      title: 'Export video',
      defaultPath: path.join(app.getPath('videos'), `${defaultName}.mp4`),
      filters: [{ name: 'MP4 video', extensions: ['mp4'] }]
    })
    return r.canceled ? null : r.filePath
  })

  // The UI renders frames and streams them here (see exporter.ts).
  ipcMain.handle('export:begin', async (_e, project: Project, settings: ExportSettings) => {
    // Reversed clips need their reversed copy (for the audio) before the encoder starts.
    for (const c of project.clips) {
      const m = project.media.find((x) => x.id === c.mediaId)
      if (c.speed?.reverse && m && m.kind !== 'image') await makeReverseProxy(m.path, m.duration, m.hasAudio)
    }
    await exportBegin(project, settings)
  })
  ipcMain.handle('export:frame', (_e, req: FrameRequest, time: number) => exportFrame(req, time))
  ipcMain.handle('export:release', (_e, key: string) => exportRelease(key))
  ipcMain.handle('export:write', (_e, frame: Uint8Array) => exportWrite(frame))
  ipcMain.handle('export:finish', () => exportFinish())
  ipcMain.handle('export:cancel', () => cancelExport())
  ipcMain.handle('media:reverse', (_e, file: string, duration: number, hasAudio: boolean) => makeReverseProxy(file, duration, hasAudio))

  ipcMain.handle('shell:showItem', (_e, p: string) => shell.showItemInFolder(p))

  // ---- color ----
  ipcMain.handle('media:samples', (_e, file: string, times: number[], w: number, h: number) => sampleFrames(file, times, w, h))
  ipcMain.handle('file:readText', async (_e, file: string) => {
    const stat = await fs.stat(file)
    if (stat.size > 64 * 1024 * 1024) throw new Error('File is too large')
    return fs.readFile(file, 'utf8')
  })
  ipcMain.handle('dialog:openLut', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Import LUT',
      properties: ['openFile'],
      filters: [{ name: '3D LUT', extensions: ['cube'] }]
    })
    return r.canceled ? null : r.filePaths[0]
  })

  // ---- text frames for export ----

  // ---- speech to text ----
  ipcMain.handle('whisper:status', () => whisperStatus())
  ipcMain.handle('whisper:download', (e, gpu: boolean) =>
    whisperDownload(gpu, (p) => !e.sender.isDestroyed() && e.sender.send('whisper:progress', p))
  )
  ipcMain.handle('whisper:transcribe', (e, project: Project, opts: TranscribeOptions) =>
    whisperTranscribe(project, opts, (p) => !e.sender.isDestroyed() && e.sender.send('whisper:progress', p))
  )
  ipcMain.handle('whisper:cancel', () => whisperCancel())
}

app.whenReady().then(() => {
  registerMediaProtocol()
  registerIpc()
  // Let the UI list fonts installed in Windows (for the text font picker). Nothing else is granted.
  const allowed = new Set(['local-fonts', 'clipboard-sanitized-write', 'fullscreen'])
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission))
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)))
  createWindow()
  initUpdater(win!)
  systemInfo() // warm up the GPU check in the background
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  cancelExport()
  if (process.platform !== 'darwin') app.quit()
})
