import { execFile } from 'node:child_process'

/**
 * Monospace families installed on this machine, so Settings can offer the real
 * list instead of asking people to type a family name from memory.
 */
export interface FontChoices {
  /** Patched Nerd Fonts (letters *and* icon glyphs) — best for the terminal, best first. */
  nerd: string[]
  /** Every other monospace family, alphabetically. */
  mono: string[]
  /** Proportional families, alphabetically — the card/Blinks font picker's list. */
  sans: string[]
}

/**
 * Preferred order for patched families. A "… Mono" Nerd Font keeps icon glyphs
 * on the same advance width as letters, so terminals don't drift columns;
 * Meslo (the Powerlevel10k standard) leads, then the usual suspects.
 */
const PREFERRED = [
  'MesloLGS Nerd Font Mono',
  'MesloLGM Nerd Font Mono',
  'MesloLGL Nerd Font Mono',
  'MesloLGSDZ Nerd Font Mono',
  'MesloLGMDZ Nerd Font Mono',
  'MesloLGLDZ Nerd Font Mono',
  'MesloLGS NF',
  'MesloLGM NF',
  'MesloLGL NF',
  'MesloLGS Nerd Font',
  'MesloLGM Nerd Font',
  'MesloLGL Nerd Font',
  'JetBrainsMono Nerd Font Mono',
  'JetBrains Mono Nerd Font Mono',
  'JetBrainsMono Nerd Font',
  'FiraCode Nerd Font Mono',
  'FiraCode Nerd Font',
  'Hack Nerd Font Mono',
  'Hack Nerd Font',
  'CaskaydiaCove Nerd Font Mono',
  'CaskaydiaMono Nerd Font Mono',
  'CascadiaCode Nerd Font Mono',
  'VictorMono Nerd Font Mono',
  'Iosevka Nerd Font Mono',
  'IosevkaTerm Nerd Font Mono',
  'FantasqueSansM Nerd Font Mono',
  'UbuntuMono Nerd Font Mono',
  'Ubuntu Nerd Font Mono',
  'SourceCodePro Nerd Font Mono',
  'SauceCodePro Nerd Font Mono',
  'RobotoMono Nerd Font Mono',
  'SpaceMono Nerd Font Mono',
  'Terminess Nerd Font Mono',
  'Noto Sans Mono Nerd Font Mono',
  'DejaVuSansMono Nerd Font Mono',
  'ProFont Nerd Font Mono'
]

function isNerd(name: string): boolean {
  // "Nerd Font" is the upstream suffix; "… NF" is the older Powerlevel10k-style
  // naming (MesloLGS NF, CaskaydiaCove NF); symbols-only builds use "SymbolsNerd".
  return /nerd font|symbolsnerd|\bnf$/i.test(name)
}

function rank(name: string): number {
  const i = PREFERRED.indexOf(name)
  if (i >= 0) return i
  // Unknown patched family: mono-spaced variants first, then alphabetical.
  return 1000 + (/(\bmono|\bnf)$/i.test(name) ? 0 : 1)
}

/** `fc-list` prints one line per face, families comma-separated. */
function fcFamilies(selector?: string): Promise<string[]> {
  return new Promise((done) => {
    const args = selector ? [selector, '--format', '%{family}\\n'] : ['--format', '%{family}\\n']
    execFile('fc-list', args, { timeout: 4000, maxBuffer: 1 << 20 }, (err, stdout) => {
      if (err) return done([])
      done(
        String(stdout)
          .split('\n')
          .flatMap((line) => line.split(','))
          .map((f) => f.trim())
          .filter(Boolean)
      )
    })
  })
}

let cached: { at: number; value: FontChoices } | null = null
const CACHE_MS = 5 * 60 * 1000

/**
 * Pure: split the machine's families into the picker's two groups. Exported so
 * the ranking can be checked against synthetic families, not just whatever
 * happens to be installed here.
 */
export function splitFamilies(all: string[], monospaced: string[]): Omit<FontChoices, 'sans'> {
  const unique = (list: string[]): string[] => [...new Set(list.map((f) => f.trim()).filter(Boolean))]
  return {
    nerd: unique(all)
      .filter(isNerd)
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)),
    mono: unique(monospaced)
      .filter((f) => !isNerd(f))
      .sort((a, b) => a.localeCompare(b))
  }
}

/**
 * Pure: the proportional families, i.e. everything that is neither monospaced
 * nor a patched Nerd Font. The terminal ignores this group; the card font
 * picker (Blinko) is built from it. Kept separate from `splitFamilies` so the
 * terminal ranking stays exactly as verified.
 */
export function sansFamilies(all: string[], monospaced: string[]): string[] {
  const trim = (list: string[]): string[] => [...new Set(list.map((f) => f.trim()).filter(Boolean))]
  const monoKeys = new Set(trim(monospaced))
  return trim(all)
    .filter((f) => !isNerd(f) && !monoKeys.has(f))
    .sort((a, b) => a.localeCompare(b))
}

/**
 * Nerd Fonts plus the rest of the monospace families. Empty arrays when
 * fontconfig isn't installed — the caller falls back to a CSS stack.
 */
export async function listFonts(): Promise<FontChoices> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value
  const [all, monospaced] = await Promise.all([fcFamilies(), fcFamilies(':spacing=mono')])
  const value: FontChoices = { ...splitFamilies(all, monospaced), sans: sansFamilies(all, monospaced) }
  cached = { at: Date.now(), value }
  return value
}
