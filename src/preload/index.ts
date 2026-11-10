// Safe bridge between the UI (renderer) and the main process.
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  ExportProgress, ExportSettings, MediaItem, MediaKind, Project, RecentProject, SystemInfo, TranscribeOptions,
  UpdateStatus, WhisperProgress, WhisperStatus, Word
} from '../shared/types'

const api = {
  systemInfo: (): Promise<SystemInfo> => ipcRenderer.invoke('system:info'),
  openMediaDialog: (): Promise<string[]> => ipcRenderer.invoke('dialog:openMedia'),
  probe: (file: string): Promise<Omit<MediaItem, 'id'>> => ipcRenderer.invoke('media:probe', file),
  thumbnails: (file: string, kind: MediaKind, duration: number): Promise<string[]> =>
    ipcRenderer.invoke('media:thumbnails', file, kind, duration),
  peaks: (file: string): Promise<number[]> => ipcRenderer.invoke('media:peaks', file),
  saveProject: (project: Project, path: string | null, saveAs = false): Promise<string | null> =>
    ipcRenderer.invoke('project:save', project, path, saveAs),
  openProject: (path?: string): Promise<{ project: Project; path: string } | null> =>
    ipcRenderer.invoke('project:open', path),
  recentProjects: (): Promise<RecentProject[]> => ipcRenderer.invoke('project:recent'),
  chooseExportFile: (name: string): Promise<string | null> => ipcRenderer.invoke('export:chooseFile', name),
  startExport: (project: Project, settings: ExportSettings): Promise<void> =>
    ipcRenderer.invoke('export:start', project, settings),
  cancelExport: (): Promise<void> => ipcRenderer.invoke('export:cancel'),
  onExportProgress: (cb: (p: ExportProgress) => void): (() => void) => {
    const listener = (_: unknown, p: ExportProgress): void => cb(p)
    ipcRenderer.on('export:progress', listener)
    return () => ipcRenderer.removeListener('export:progress', listener)
  },
  showItemInFolder: (p: string): Promise<void> => ipcRenderer.invoke('shell:showItem', p),
  /** Called when the user tries to close the window; call confirmClose() to really close it. */
  onCloseRequest: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('app:close-request', listener)
    return () => ipcRenderer.removeListener('app:close-request', listener)
  },
  confirmClose: (): Promise<void> => ipcRenderer.invoke('app:confirm-close'),
  // ---- export text frames ----
  newExportTemp: (): Promise<string> => ipcRenderer.invoke('export:newTemp'),
  writeExportTemp: (name: string, data: Uint8Array): Promise<string> => ipcRenderer.invoke('export:writeTemp', name, data),
  // ---- speech to text ----
  whisperStatus: (): Promise<WhisperStatus> => ipcRenderer.invoke('whisper:status'),
  whisperDownload: (gpu: boolean): Promise<void> => ipcRenderer.invoke('whisper:download', gpu),
  whisperTranscribe: (project: Project, opts: TranscribeOptions): Promise<Word[]> =>
    ipcRenderer.invoke('whisper:transcribe', project, opts),
  whisperCancel: (): Promise<void> => ipcRenderer.invoke('whisper:cancel'),
  onWhisperProgress: (cb: (p: WhisperProgress) => void): (() => void) => {
    const listener = (_: unknown, p: WhisperProgress): void => cb(p)
    ipcRenderer.on('whisper:progress', listener)
    return () => ipcRenderer.removeListener('whisper:progress', listener)
  },
  // ---- updates ----
  updateStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:status'),
  checkForUpdates: (): Promise<void> => ipcRenderer.invoke('update:check'),
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke('update:download'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (cb: (s: UpdateStatus) => void): (() => void) => {
    const listener = (_: unknown, s: UpdateStatus): void => cb(s)
    ipcRenderer.on('update:status', listener)
    return () => ipcRenderer.removeListener('update:status', listener)
  },
  /** Absolute path of a file dragged in from Explorer. */
  pathForFile: (file: File): string => webUtils.getPathForFile(file)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
