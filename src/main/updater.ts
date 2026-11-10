// Automatic updates from GitHub Releases (Garzi71/cutlyeditor).
// Nothing is downloaded without asking: the UI shows a banner and the user decides.
import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '../shared/types'

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000 // every 4 hours while the app is open

let window: BrowserWindow | null = null
let status: UpdateStatus = { state: 'idle', currentVersion: app.getVersion() }

function emit(next: Partial<UpdateStatus>): void {
  status = { ...status, ...next }
  if (window && !window.webContents.isDestroyed()) window.webContents.send('update:status', status)
}

/** Set to true right before installing so the "unsaved changes" close guard doesn't block it. */
export let installingUpdate = false

export function initUpdater(win: BrowserWindow): void {
  window = win
  autoUpdater.autoDownload = false // ask first
  autoUpdater.autoInstallOnAppQuit = true // a downloaded update is also installed on the next normal quit

  autoUpdater.on('checking-for-update', () => emit({ state: 'checking', error: undefined }))
  autoUpdater.on('update-not-available', () => emit({ state: 'none' }))
  autoUpdater.on('update-available', (info) =>
    emit({
      state: 'available',
      version: info.version,
      notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined
    })
  )
  autoUpdater.on('download-progress', (p) => emit({ state: 'downloading', percent: p.percent }))
  autoUpdater.on('update-downloaded', (info) => emit({ state: 'ready', version: info.version, percent: 100 }))
  autoUpdater.on('error', (e) => emit({ state: 'error', error: e?.message ?? String(e) }))

  ipcMain.handle('update:status', () => status)
  ipcMain.handle('update:check', () => check(true))
  ipcMain.handle('update:download', () => autoUpdater.downloadUpdate())
  ipcMain.handle('update:install', () => {
    installingUpdate = true
    autoUpdater.quitAndInstall(false, true)
  })

  // Only the installed app can update itself; in development there is nothing to check.
  if (app.isPackaged) {
    setTimeout(() => check(false), 5000)
    setInterval(() => check(false), CHECK_EVERY_MS)
  }
}

async function check(manual: boolean): Promise<void> {
  if (!app.isPackaged) {
    if (manual) emit({ state: 'error', error: 'Updates only work in the installed app, not in development mode.' })
    return
  }
  if (status.state === 'downloading' || status.state === 'ready') return
  try {
    await autoUpdater.checkForUpdates()
  } catch (e) {
    emit({ state: 'error', error: (e as Error).message })
  }
}
