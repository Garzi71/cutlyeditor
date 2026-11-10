export const uid = (): string => crypto.randomUUID().slice(0, 8)

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

/** URL the UI can load a local file from (served by the main process). */
export const mediaUrl = (path: string): string => `media://local/${encodeURIComponent(path)}`

/** 83.5 -> "00:01:23:15" (hours:minutes:seconds:frames) */
export function formatTimecode(t: number, fps: number): string {
  const total = Math.max(0, t)
  const frames = Math.floor((total % 1) * fps + 1e-6)
  const s = Math.floor(total)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(frames)}`
}

/** 83.5 -> "01:23" */
export function formatShort(t: number): string {
  const s = Math.max(0, Math.round(t))
  const p = (n: number): string => String(n).padStart(2, '0')
  if (s >= 3600) return `${Math.floor(s / 3600)}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`
  return `${p(Math.floor(s / 60))}:${p(s % 60)}`
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

export const isTyping = (): boolean => {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}

export const ASPECTS = [
  { id: '16:9', w: 16, h: 9, label: 'Landscape', hint: 'YouTube' },
  { id: '9:16', w: 9, h: 16, label: 'Portrait', hint: 'TikTok, Reels, Shorts' },
  { id: '1:1', w: 1, h: 1, label: 'Square', hint: 'Instagram post' },
  { id: '4:5', w: 4, h: 5, label: 'Vertical', hint: 'Instagram feed' }
] as const

export const RESOLUTIONS = [720, 1080, 1440, 2160] as const

/** Frame size for an aspect ratio, where `short` is the length of the shorter side. */
export function frameSize(aw: number, ah: number, short: number): { width: number; height: number } {
  const even = (n: number): number => Math.round(n / 2) * 2
  return aw >= ah
    ? { width: even((short * aw) / ah), height: short }
    : { width: short, height: even((short * ah) / aw) }
}

export function aspectIdOf(w: number, h: number): string {
  const r = w / h
  const found = ASPECTS.find((a) => Math.abs(a.w / a.h - r) < 0.01)
  return found ? found.id : `${w}x${h}`
}
