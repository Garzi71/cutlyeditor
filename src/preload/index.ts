// Safe bridge between the UI (renderer) and the main process.
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  ExportProgress, ExportSettings, MediaItem, MediaKind, Project, RecentProject, SystemInfo, UpdateStatus
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
