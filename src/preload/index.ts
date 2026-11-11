// Safe bridge between the UI (renderer) and the main process.
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  ExportProgress, ExportSettings, FrameRequest, MediaItem, MediaKind, Project, RecentProject, SystemInfo, Template, TemplateInfo, TranscribeOptions,
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
  exportBegin: (project: Project, settings: ExportSettings): Promise<void> => ipcRenderer.invoke('export:begin', project, settings),
  exportFrame: (req: FrameRequest, time: number): Promise<Uint8Array | null> => ipcRenderer.invoke('export:frame', req, time),
  exportRelease: (key: string): Promise<void> => ipcRenderer.invoke('export:release', key),
  exportWrite: (frame: Uint8Array): Promise<void> => ipcRenderer.invoke('export:write', frame),
  exportFinish: (): Promise<void> => ipcRenderer.invoke('export:finish'),
  cancelExport: (): Promise<void> => ipcRenderer.invoke('export:cancel'),
  reverseProxy: (file: string, duration: number, hasAudio: boolean): Promise<string> =>
    ipcRenderer.invoke('media:reverse', file, duration, hasAudio),
  showItemInFolder: (p: string): Promise<void> => ipcRenderer.invoke('shell:showItem', p),
  /** Called when the user tries to close the window; call confirmClose() to really close it. */
  onCloseRequest: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('app:close-request', listener)
    return () => ipcRenderer.removeListener('app:close-request', listener)
  },
  confirmClose: (): Promise<void> => ipcRenderer.invoke('app:confirm-close'),
  denoisedAudio: (file: string, strength: number): Promise<string> => ipcRenderer.invoke('media:denoise', file, strength),
  silenceThreshold: (file: string, from: number, to: number): Promise<{ noise: number; speech: number; threshold: number }> =>
    ipcRenderer.invoke('media:silenceLevel', file, from, to),
  detectSilence: (file: string, from: number, to: number, threshold: number, minDuration: number): Promise<[number, number][]> =>
    ipcRenderer.invoke('media:silence', file, from, to, threshold, minDuration),
  mattingStatus: (): Promise<{ ready: boolean; size: number; path: string }> => ipcRenderer.invoke('matting:status'),
  downloadMattingModel: (): Promise<string> => ipcRenderer.invoke('matting:download'),
  onMattingProgress: (cb: (fraction: number) => void): (() => void) => {
    const listener = (_: unknown, f: number): void => cb(f)
    ipcRenderer.on('matting:progress', listener)
    return () => ipcRenderer.removeListener('matting:progress', listener)
  },
  listTemplates: (): Promise<TemplateInfo[]> => ipcRenderer.invoke('templates:list'),
  saveTemplate: (t: Template): Promise<string> => ipcRenderer.invoke('templates:save', t),
  exportTemplate: (t: Template): Promise<string | null> => ipcRenderer.invoke('templates:export', t),
  importTemplate: (): Promise<TemplateInfo | null> => ipcRenderer.invoke('templates:import'),
  deleteTemplate: (file: string): Promise<void> => ipcRenderer.invoke('templates:delete', file),
  // ---- color ----
  mediaSamples: (file: string, times: number[], w: number, h: number): Promise<Uint8Array> =>
    ipcRenderer.invoke('media:samples', file, times, w, h),
  readTextFile: (file: string): Promise<string> => ipcRenderer.invoke('file:readText', file),
  openLutDialog: (): Promise<string | null> => ipcRenderer.invoke('dialog:openLut'),
  // ---- export text frames ----
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
