/**
 * Derive an app theme from the desktop wallpaper's pixels.
 *
 * Everything except `loadPalette` is pure colour maths (no DOM, no canvas), so
 * the interesting part — how a photo turns into a readable theme — can be
 * tested in node against real pixels and asserted on WCAG contrast.
 *
 * Shape of the result: the same 19 custom properties the hand-written themes in
 * styles.css set, emitted as a `:root[data-theme="wallpaper"][data-mode="…"]`
 * block. That means it participates in the normal theme machinery (the picker,
 * dark/light switching, Excalidraw overrides) rather than being a special case.
 */

export interface Rgb {
  r: number
  g: number
  b: number
  /** true when the colour came from a genuinely vivid part of the image */
  vivid?: boolean
}

export interface Hsl {
  h: number
  s: number
  l: number
}

export interface ThemePalette {
  /** the image's prevailing colour: tints the surfaces and text */
  base: Rgb
  /** the most vivid usable colour: becomes --accent */
  accent: Rgb
}

export type VarMap = Record<string, string>

/* ─── colour conversions ─────────────────────────────────────────────────── */

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rr = r / 255
  const gg = g / 255
  const bb = b / 255
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === rr) h = ((gg - bb) / d) % 6
  else if (max === gg) h = (bb - rr) / d + 2
  else h = (rr - gg) / d + 4
  h *= 60
  if (h < 0) h += 360
  return { h, s, l }
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = ((((h % 360) + 360) % 360) / 60)
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let triad: [number, number, number]
  if (hp < 1) triad = [c, x, 0]
  else if (hp < 2) triad = [x, c, 0]
  else if (hp < 3) triad = [0, c, x]
  else if (hp < 4) triad = [0, x, c]
  else if (hp < 5) triad = [x, 0, c]
  else triad = [c, 0, x]
  const m = l - c / 2
  const to255 = (v: number): number => Math.max(0, Math.min(255, Math.round((v + m) * 255)))
  return { r: to255(triad[0]), g: to255(triad[1]), b: to255(triad[2]) }
}

export function cssHsl({ h, s, l }: Hsl): string {
  return `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${(l * 100).toFixed(1)}%)`
}

export function cssRgba({ r, g, b }: Rgb, a: number): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`
}

export function cssRgb(c: Rgb): string {
  return `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`
}

/** WCAG relative luminance. */
export function luminance({ r, g, b }: Rgb): number {
  const chan = (v: number): number => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)
}

/** WCAG contrast ratio, 1 (identical) … 21 (black/white). */
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a)
  const lb = luminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

/** Push a colour's lightness away from `bg` until it clears `target`. */
function tune(hsl: Hsl, bg: Rgb, target: number): Hsl {
  const away = luminance(bg) > 0.45 ? -1 : 1
  let { l } = hsl
  for (let i = 0; i < 40 && contrast(hslToRgb({ ...hsl, l }), bg) < target; i++) {
    l = l + away * 0.03
    if (l <= 0.01 || l >= 0.99) break
    l = Math.max(0.01, Math.min(0.99, l))
  }
  return { ...hsl, l }
}

/* ─── palette extraction ─────────────────────────────────────────────────── */

/** Neutral, tasteful fallback for images we can't read any colour out of. */
const FALLBACK: ThemePalette = {
  base: { r: 10, g: 12, b: 26 },
  accent: { r: 138, g: 180, b: 255, vivid: true }
}

/**
 * Reduce a wallpaper's pixels to two representative colours.
 *
 * Buckets pixels in HSL (hue × saturation × lightness), averages each bucket
 * for fidelity, then takes the most populated bucket as the image's mood and
 * the most populated *vivid* mid-tone bucket as the accent. Saturation is a
 * tier rather than a threshold so an all-muted image still yields something.
 */
export function pickPalette(data: Uint8ClampedArray | Uint8Array): ThemePalette {
  if (data.length < 32) return FALLBACK

  let opaque = 0
  for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) >= 128) opaque++
  // A mostly transparent image (SVG wallpapers) — judge it on all its pixels.
  const useAll = opaque < (data.length / 4) * 0.15

  interface Bucket {
    count: number
    r: number
    g: number
    b: number
  }
  const buckets = new Map<string, Bucket>()

  for (let i = 0; i + 3 < data.length; i += 4) {
    if (!useAll && (data[i + 3] ?? 0) < 128) continue
    const rgb = { r: data[i] ?? 0, g: data[i + 1] ?? 0, b: data[i + 2] ?? 0 }
    const { h, s, l } = rgbToHsl(rgb)
    const key = `${Math.floor(h / 15)}|${s < 0.12 ? 0 : s < 0.42 ? 1 : 2}|${l < 0.22 ? 0 : l < 0.5 ? 1 : l < 0.8 ? 2 : 3}`
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 }
    bucket.count++
    bucket.r += rgb.r
    bucket.g += rgb.g
    bucket.b += rgb.b
    buckets.set(key, bucket)
  }

  const entries = [...buckets.entries()].map(([key, bucket]) => {
    const [sat, light] = key.split('|').slice(1).map(Number)
    return {
      sat: sat ?? 0,
      light: light ?? 0,
      count: bucket.count,
      rgb: { r: bucket.r / bucket.count, g: bucket.g / bucket.count, b: bucket.b / bucket.count }
    }
  })
  if (entries.length === 0) return FALLBACK

  const mostCommon = (list: typeof entries): (typeof entries)[number] =>
    list.reduce((a, b) => (b.count > a.count ? b : a))

  const dominant = mostCommon(entries)
  // Prefer a strongly saturated mid-tone; fall back to a mildly saturated one.
  const strong = entries.filter((e) => e.sat >= 2 && e.light >= 1 && e.light <= 2)
  const mild = entries.filter((e) => e.sat >= 1 && e.light >= 1 && e.light <= 2)
  const accent = strong.length > 0 ? mostCommon(strong) : mild.length > 0 ? mostCommon(mild) : null

  // If the image has no colour at all, keep the neutral fallback accent (a
  // grey accent on a grey theme would be invisible).
  return {
    base: dominant.rgb,
    accent: accent ? { ...accent.rgb, vivid: strong.length > 0 } : FALLBACK.accent
  }
}

/* ─── palette → theme ────────────────────────────────────────────────────── */

const RADII = { '--radius': '10px', '--radius-sm': '6px', '--radius-lg': '14px' }

export function buildVars(palette: ThemePalette, mode: 'dark' | 'light'): VarMap {
  const baseHsl = rgbToHsl(palette.base)
  const accentHsl = rgbToHsl(palette.accent)

  // Greyscale detection: if the dominant palette is genuinely monochrome, keep surfaces neutral
  const isGrey = baseHsl.s < 0.03
  const hasBaseColor = baseHsl.s >= 0.12
  // If base color is neutral/dark, inherit hue and saturation from the vivid accent
  const hue = hasBaseColor ? baseHsl.h : accentHsl.h
  const colorSat = isGrey ? 0 : Math.max(baseHsl.s, accentHsl.s * 0.7)

  // Rich, atmospheric surface tint directly derived from the wallpaper
  const surfSat = isGrey ? 0 : Math.max(0.20, Math.min(0.42, colorSat * 0.65))
  const bgL = mode === 'dark' ? 0.095 : 0.94
  const bgHsl: Hsl = { h: hue, s: surfSat, l: bgL }
  const bg = hslToRgb(bgHsl)

  // Layered surface adjustments (sidebar, cards, active tab, borders)
  const layer = (dl: number, ds = 0): string =>
    cssHsl({
      h: hue,
      s: isGrey ? 0 : Math.max(0, Math.min(0.55, surfSat + ds)),
      l: Math.max(0.01, Math.min(0.99, bgHsl.l + dl))
    })

  // Harmoniously tinted text: crisp, readable, yet unmistakably styled from the wallpaper
  const textSat = isGrey ? 0 : Math.min(0.40, Math.max(0.18, colorSat * 0.65))
  const text = tune({ h: hue, s: textSat, l: mode === 'dark' ? 0.94 : 0.12 }, bg, 8)
  const textDim = tune({ h: hue, s: Math.min(0.30, textSat * 0.75), l: mode === 'dark' ? 0.68 : 0.38 }, bg, 3.5)
  const textMuted = tune({ h: hue, s: Math.min(0.25, textSat * 0.6), l: mode === 'dark' ? 0.48 : 0.58 }, bg, 2.0)

  // Accent: vivid on dark, deepened on light, then tuned for high contrast
  const accentWanted: Hsl = {
    h: accentHsl.h,
    s: Math.max(0.60, palette.accent.vivid ? accentHsl.s : 0.65),
    l: mode === 'dark' ? Math.max(0.64, Math.min(0.78, accentHsl.l)) : Math.max(0.32, Math.min(0.46, accentHsl.l))
  }
  const accent = hslToRgb(tune(accentWanted, bg, mode === 'dark' ? 4.5 : 4))

  return {
    '--bg': cssHsl(bgHsl),
    '--bg-soft': mode === 'dark' ? layer(0.035, 0.01) : layer(-0.03, 0.01),
    '--bg-raise': mode === 'dark' ? layer(0.075, 0.03) : layer(-0.06, 0.02),
    '--bg-glass': cssRgba(bg, mode === 'dark' ? 0.82 : 0.86),
    '--border': mode === 'dark' ? layer(0.14, 0.03) : layer(-0.18, 0.03),
    '--border-soft': mode === 'dark' ? layer(0.08, 0.01) : layer(-0.08, 0.01),
    '--text': cssHsl(text),
    '--text-dim': cssHsl(textDim),
    '--text-muted': cssHsl(textMuted),
    '--accent': cssRgb(accent),
    '--accent-soft': cssRgba(accent, mode === 'dark' ? 0.14 : 0.16),
    '--accent-glow': cssRgba(accent, mode === 'dark' ? 0.28 : 0.32),
    '--tab-active-bg': mode === 'dark' ? layer(0.095, 0.05) : layer(-0.07, 0.04),
    '--sidebar-bg': mode === 'dark' ? layer(-0.025, 0.03) : layer(-0.035, 0.02),
    '--shadow': mode === 'dark' ? '0 2px 20px rgba(0,0,0,0.6)' : '0 2px 16px rgba(20,20,40,0.10)',
    '--shadow-lg': mode === 'dark' ? '0 8px 40px rgba(0,0,0,0.8)' : '0 8px 32px rgba(20,20,40,0.16)',
    ...RADII
  }
}

/** The generated theme, as a stylesheet. Keeps the normal data-theme contract. */
export function themeCss(dark: VarMap, light: VarMap): string {
  const block = (mode: string, vars: VarMap): string =>
    `:root[data-theme="wallpaper"][data-mode="${mode}"] {\n` +
    Object.entries(vars)
      .map(([key, value]) => `  ${key}: ${value};`)
      .join('\n') +
    '\n}'
  return `${block('dark', dark)}\n${block('light', light)}\n`
}

/** Three swatches for the theme picker, matching its other rows. */
export function swatches(vars: VarMap): string[] {
  return [vars['--bg'] ?? '', vars['--text'] ?? '', vars['--accent'] ?? '']
}

/* ─── reading the image (the only DOM-touching part) ─────────────────────── */

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // Needed so getImageData() isn't blocked by a tainted canvas: you-wall://
    // is a different origin from app:// and replies with CORS headers.
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('wallpaper image could not be decoded'))
    img.src = url
  })
}

/**
 * Decode the wallpaper and reduce it to a palette. The image is drawn small —
 * the exact pixel grid doesn't matter for picking representative colours, and
 * it keeps decoding a 4K wallpaper down to a few milliseconds of sampling.
 */
export async function loadPalette(url: string, width = 96): Promise<ThemePalette> {
  const img = await loadImage(url)
  const w = Math.max(1, Math.min(width, img.naturalWidth || width))
  const h = Math.max(1, Math.round((w * (img.naturalHeight || 1)) / (img.naturalWidth || 1)))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return FALLBACK
  ctx.drawImage(img, 0, 0, w, h)
  return pickPalette(ctx.getImageData(0, 0, w, h).data)
}

export { FALLBACK as WALLPAPER_FALLBACK }
