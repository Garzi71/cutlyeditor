// Fonts bundled with Cutly (all include Czech characters) + fonts installed in Windows.
import '@fontsource/montserrat/400.css'
import '@fontsource/montserrat/700.css'
import '@fontsource/montserrat/800.css'
import '@fontsource/montserrat/900.css'
import '@fontsource/poppins/400.css'
import '@fontsource/poppins/700.css'
import '@fontsource/poppins/800.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/800.css'
import '@fontsource/roboto/400.css'
import '@fontsource/roboto/700.css'
import '@fontsource/oswald/400.css'
import '@fontsource/oswald/700.css'
import '@fontsource/bebas-neue/400.css'
import '@fontsource/anton/400.css'
import '@fontsource/archivo-black/400.css'
import '@fontsource/playfair-display/400.css'
import '@fontsource/playfair-display/700.css'
import '@fontsource/lobster/400.css'

export interface FontInfo {
  family: string
  weights: number[]
}

export const BUNDLED_FONTS: FontInfo[] = [
  { family: 'Montserrat', weights: [400, 700, 800, 900] },
  { family: 'Poppins', weights: [400, 700, 800] },
  { family: 'Inter', weights: [400, 600, 800] },
  { family: 'Roboto', weights: [400, 700] },
  { family: 'Oswald', weights: [400, 700] },
  { family: 'Bebas Neue', weights: [400] },
  { family: 'Anton', weights: [400] },
  { family: 'Archivo Black', weights: [400] },
  { family: 'Playfair Display', weights: [400, 700] },
  { family: 'Lobster', weights: [400] }
]

let systemFonts: Promise<string[]> | null = null

/** Families of fonts installed in Windows (Local Font Access API, permission granted by the main process). */
export function getSystemFonts(): Promise<string[]> {
  if (!systemFonts) {
    systemFonts = (async () => {
      try {
        const q = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts
        if (!q) return []
        const fonts = await q()
        const bundled = new Set(BUNDLED_FONTS.map((f) => f.family))
        return [...new Set(fonts.map((f) => f.family))].filter((f) => !bundled.has(f)).sort((a, b) => a.localeCompare(b))
      } catch {
        return []
      }
    })()
  }
  return systemFonts
}

export function weightsFor(family: string): number[] {
  return BUNDLED_FONTS.find((f) => f.family === family)?.weights ?? [400, 700]
}

/** Make sure a font is loaded before drawing it into an export frame. */
export async function ensureFont(family: string, weight: number, italic = false): Promise<void> {
  try {
    await document.fonts.load(`${italic ? 'italic ' : ''}${weight} 48px "${family}"`, 'AÁČčěřžý')
  } catch {
    /* fall back silently */
  }
}
