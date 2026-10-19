/**
 * The font stack the embedded terminal runs in.
 *
 * A patched Nerd Font carries the letters *and* the icon glyphs (devicons,
 * powerline separators, git status, box drawing), so the whole grid looks like
 * one typeface. The bundled Symbols Nerd Font Mono stays at the end as a
 * glyph backstop for the odd symbol no installed family has — on its own it
 * only covers symbols, which is why it can't lead the stack.
 */
export const NERD_STACK = [
  "'MesloLGS Nerd Font Mono'",
  "'MesloLGM Nerd Font Mono'",
  "'MesloLGL Nerd Font Mono'",
  "'MesloLGSDZ Nerd Font Mono'",
  "'MesloLGMDZ Nerd Font Mono'",
  "'MesloLGLDZ Nerd Font Mono'",
  "'MesloLGS Nerd Font'",
  "'MesloLGM Nerd Font'",
  // Powerlevel10k-style patched names, same faces under an older suffix.
  "'MesloLGS NF'",
  "'MesloLGM NF'",
  "'MesloLGL NF'",
  "'Hack NF'",
  "'JetBrainsMono Nerd Font Mono'",
  "'JetBrains Mono Nerd Font Mono'",
  "'FiraCode Nerd Font Mono'",
  "'Hack Nerd Font Mono'",
  "'CaskaydiaCove Nerd Font Mono'",
  "'CaskaydiaMono Nerd Font Mono'",
  "'VictorMono Nerd Font Mono'",
  "'Iosevka Nerd Font Mono'",
  "'FantasqueSansM Nerd Font Mono'",
  "'UbuntuMono Nerd Font Mono'",
  "'SourceCodePro Nerd Font Mono'",
  "'SauceCodePro Nerd Font Mono'",
  "'RobotoMono Nerd Font Mono'",
  "'SpaceMono Nerd Font Mono'",
  "'Terminess Nerd Font Mono'",
  "'Noto Sans Mono Nerd Font Mono'"
].join(', ')

/** Last resort: the bundled symbols font, then whatever monospace exists. */
const TAIL =
  "'SymbolsNerdFontMono', ui-monospace, SFMono-Regular, Menlo, 'DejaVu Sans Mono', 'Liberation Mono', monospace"

/** Stack for an explicit Settings choice, or the Nerd Font sweep when unset. */
export function termFontStack(choice?: string): string {
  const family = (choice ?? '').trim()
  return family ? `'${family.replace(/'/g, '')}', ${TAIL}` : `${NERD_STACK}, ${TAIL}`
}

/* ─── Blinko card typeface ───────────────────────────────────────────────── */

/** CSS-wide generic families — used bare, since quoting disables the keyword. */
const GENERICS = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded'
])

/**
 * Presets offered above the installed-family list in Settings. The value is
 * what gets stored: '' means "whatever the app's UI font is", which is also
 * what the Markdown preview inherits on its own — so a fresh workspace renders
 * the card identically while editing and while displayed.
 */
export const CARD_FONT_PRESETS: Array<{ value: string; label: string }> = [
  { value: '', label: 'App default' },
  { value: 'system-ui', label: 'System UI font' },
  { value: 'sans-serif', label: 'Generic sans-serif' },
  { value: 'serif', label: 'Serif (reading)' },
  { value: 'monospace', label: 'Monospace' }
]

/**
 * A stored family choice → a `font-family` value. Quotes are stripped so a
 * family name can never break out of the CSS string, and non-generic families
 * get the app's UI stack as a tail so a missing font degrades sensibly.
 */
export function cardFontStack(choice?: string): string {
  const family = (choice ?? '').trim().replace(/["']/g, '')
  if (!family) return ''
  if (GENERICS.has(family.toLowerCase())) return family.toLowerCase()
  return `'${family}', system-ui, sans-serif`
}
