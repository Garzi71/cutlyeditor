// Built-in filters (looks). Each one is a recipe made from the same building blocks as the manual
// controls, so it is baked into the clip's LUT and blended by its intensity.
import type { ColorAdjust, ColorGrade, CurvePoints } from '@shared/types'

export interface FilterPreset {
  id: string
  name: string
  group: 'Basic' | 'Cinematic' | 'Vintage' | 'Mood' | 'Black & white'
  adjust: Partial<ColorAdjust>
  hsl?: ColorGrade['hsl']
  curves?: { master: CurvePoints; r: CurvePoints; g: CurvePoints; b: CurvePoints }
}

const I: CurvePoints = [[0, 0], [1, 1]]
const curves = (c: Partial<{ master: CurvePoints; r: CurvePoints; g: CurvePoints; b: CurvePoints }>): FilterPreset['curves'] => ({
  master: c.master ?? I,
  r: c.r ?? I,
  g: c.g ?? I,
  b: c.b ?? I
})

export const FILTERS: FilterPreset[] = [
  // Basic
  { id: 'vivid', name: 'Vivid', group: 'Basic', adjust: { contrast: 12, saturation: 18, vibrance: 20 } },
  { id: 'bright', name: 'Bright', group: 'Basic', adjust: { exposure: 0.25, shadows: 20, highlights: -10, vibrance: 10 } },
  { id: 'soft', name: 'Soft', group: 'Basic', adjust: { contrast: -18, blacks: 15, highlights: -15, saturation: -8 } },
  { id: 'punch', name: 'Punch', group: 'Basic', adjust: { contrast: 28, blacks: -10, whites: 8, vibrance: 15 } },
  // Cinematic
  {
    id: 'teal-orange', name: 'Teal & Orange', group: 'Cinematic',
    adjust: { contrast: 15, saturation: 5 },
    hsl: { orange: { h: -5, s: 25, l: 5 }, aqua: { h: 10, s: 20, l: 0 }, blue: { h: -15, s: 15, l: -5 }, green: { h: 35, s: -30, l: 0 } },
    curves: curves({ r: [[0, 0.02], [0.5, 0.5], [1, 1]], b: [[0, 0.08], [0.5, 0.48], [1, 0.92]] })
  },
  {
    id: 'blockbuster', name: 'Blockbuster', group: 'Cinematic',
    adjust: { contrast: 22, blacks: -15, saturation: -10, temperature: 4 },
    curves: curves({ master: [[0, 0], [0.25, 0.2], [0.75, 0.8], [1, 1]], b: [[0, 0.06], [1, 0.95]] })
  },
  {
    id: 'moody', name: 'Moody', group: 'Cinematic',
    adjust: { exposure: -0.2, contrast: 10, highlights: -25, saturation: -25, temperature: -5 },
    curves: curves({ master: [[0, 0.06], [0.5, 0.47], [1, 0.94]] })
  },
  {
    id: 'film-noir-color', name: 'Neo noir', group: 'Cinematic',
    adjust: { contrast: 25, saturation: -35, blacks: -20 },
    hsl: { red: { h: 0, s: 40, l: 0 } }
  },
  // Vintage
  {
    id: 'faded', name: 'Faded', group: 'Vintage',
    adjust: { contrast: -12, saturation: -20 },
    curves: curves({ master: [[0, 0.12], [0.5, 0.52], [1, 0.92]] })
  },
  {
    id: 'retro-70s', name: '70s', group: 'Vintage',
    adjust: { temperature: 16, saturation: -10, contrast: -5 },
    curves: curves({ master: [[0, 0.08], [1, 0.95]], b: [[0, 0.1], [1, 0.8]], g: [[0, 0.03], [1, 0.97]] })
  },
  {
    id: 'polaroid', name: 'Polaroid', group: 'Vintage',
    adjust: { exposure: 0.15, contrast: -10, saturation: -15, tint: 5 },
    curves: curves({ master: [[0, 0.1], [0.5, 0.55], [1, 0.95]], r: [[0, 0.04], [1, 1]] })
  },
  {
    id: 'kodak', name: 'Warm film', group: 'Vintage',
    adjust: { temperature: 9, contrast: 8, vibrance: 10 },
    hsl: { yellow: { h: -8, s: 10, l: 5 }, green: { h: 10, s: -15, l: 0 } },
    curves: curves({ master: [[0, 0.04], [0.25, 0.22], [0.75, 0.8], [1, 0.97]] })
  },
  // Mood
  { id: 'warm', name: 'Warm', group: 'Mood', adjust: { temperature: 19, vibrance: 8 } },
  { id: 'cold', name: 'Cold', group: 'Mood', adjust: { temperature: -19, saturation: -5 } },
  { id: 'golden', name: 'Golden hour', group: 'Mood', adjust: { temperature: 22, tint: 4, highlights: -10, shadows: 10, vibrance: 15 } },
  { id: 'pastel', name: 'Pastel', group: 'Mood', adjust: { exposure: 0.2, contrast: -25, saturation: -15, blacks: 20 } },
  {
    id: 'cyberpunk', name: 'Neon night', group: 'Mood',
    adjust: { contrast: 18, tint: 15, saturation: 20, temperature: -9 },
    hsl: { blue: { h: 15, s: 30, l: 0 }, magenta: { h: 0, s: 30, l: 5 } }
  },
  {
    id: 'forest', name: 'Fresh green', group: 'Mood',
    adjust: { vibrance: 15, temperature: -3 },
    hsl: { green: { h: -10, s: 30, l: 5 }, yellow: { h: 15, s: 10, l: 0 } }
  },
  // Black & white
  { id: 'bw', name: 'B&W', group: 'Black & white', adjust: { saturation: -100, contrast: 10 } },
  { id: 'bw-contrast', name: 'B&W contrast', group: 'Black & white', adjust: { saturation: -100, contrast: 40, blacks: -20, whites: 15 } },
  {
    id: 'sepia', name: 'Sepia', group: 'Black & white',
    adjust: { saturation: -100, contrast: 5 },
    curves: curves({ r: [[0, 0.06], [1, 1]], g: [[0, 0.03], [1, 0.93]], b: [[0, 0], [1, 0.78]] })
  }
]
