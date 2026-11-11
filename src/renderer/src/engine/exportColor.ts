// Before an export: write each graded clip's LUT (.cube) and vignette mask (PNG) into the export
// temp folder. ffmpeg then applies exactly the same numbers the preview uses.
import type { ColorAsset, Project } from '@shared/types'
import { clipOutputSize } from '@shared/types'
import { buildLut, gradeIsActive, hasPointOps, loadCube, lutToCube, vignetteFactor } from './color'

const enc = new TextEncoder()

async function vignettePng(w: number, h: number, amount: number): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Black with alpha: drawing it over the picture multiplies it by the vignette factor.
      const a = 1 - vignetteFactor((x + 0.5) / w, (y + 0.5) / h, amount)
      img.data[(y * w + x) * 4 + 3] = Math.round(a * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2)

/** Must run after window.api.newExportTemp(). Returns file names (relative to the temp folder). */
export async function prepareColorAssets(project: Project, W: number): Promise<Record<string, ColorAsset>> {
  const out: Record<string, ColorAsset> = {}
  const H = even((project.height * W) / project.width)
  for (const c of project.clips) {
    const g = c.color
    if (!gradeIsActive(g)) continue
    const m = project.media.find((x) => x.id === c.mediaId)
    if (!c.adjustment && (!m || m.kind === 'audio')) continue
    const asset: ColorAsset = {}
    if (hasPointOps(g)) {
      if (g!.lut) await loadCube(g!.lut.path)
      const lut = buildLut(g!)
      if (!lut) throw new Error(`Could not read the LUT file ${g!.lut?.name ?? ''}`)
      const name = `lut-${c.id}.cube`
      await window.api.writeExportTemp(name, enc.encode(lutToCube(lut)))
      asset.lut = name
    }
    if (g!.adjust.sharpen > 0) asset.sharpen = g!.adjust.sharpen
    if (g!.adjust.vignette > 0) {
      const size = c.adjustment ? { w: W, h: H } : clipOutputSize(project, m!, c, W)
      const name = `vig-${c.id}.png`
      await window.api.writeExportTemp(name, await vignettePng(size.w, size.h, g!.adjust.vignette))
      asset.vignette = name
    }
    out[c.id] = asset
  }
  return out
}
