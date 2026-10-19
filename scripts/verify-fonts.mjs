#!/usr/bin/env node
/**
 * Verify the terminal font picker: the family ranking (pure, on synthetic
 * input) and the CSS stack the terminal actually renders with.
 *
 * Run with `npm run verify:fonts`. No test framework, no display: the two real
 * modules are bundled with esbuild and exercised directly. The families
 * installed on this machine are reported at the end for information only, so
 * the checks pass on any box — with or without fontconfig.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const work = join(root, 'node_modules', '.cache', 'verify-fonts')
rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })

const esbuild = join(root, 'node_modules', '.bin', 'esbuild')
const bundle = (entry, out) =>
  execFileSync(
    esbuild,
    [entry, '--bundle', '--platform=node', '--format=esm', `--outfile=${out}`, '--log-level=warning'],
    { cwd: root }
  )

bundle('src/main/fonts.ts', join(work, 'fonts.mjs'))
bundle('src/renderer/fonts.ts', join(work, 'stack.mjs'))

const fonts = await import(pathToFileURL(join(work, 'fonts.mjs')).href)
const stack = await import(pathToFileURL(join(work, 'stack.mjs')).href)

let failures = 0
const check = (label, ok, detail) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}
const section = (name) => console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 58 - name.length))}`)

/* ─── ranking: synthetic families, so this doesn't depend on the machine ─── */

section('family ranking')

const all = [
  'DejaVu Sans Mono',
  'Hack Nerd Font',
  'Hack Nerd Font Mono',
  'Hack',
  'MesloLGS Nerd Font',
  'MesloLGS Nerd Font Mono',
  'MesloLGM Nerd Font Mono',
  'FantasqueSansM Nerd Font Mono',
  'ZzzObscure Nerd Font',
  'ZzzObscure Nerd Font Mono',
  'MesloLGS NF',
  'CaskaydiaCove NF',
  'Unifont',
  'Inter',
  '',
  '  '
]
const monospaced = [
  'DejaVu Sans Mono',
  'Hack Nerd Font Mono',
  'MesloLGS Nerd Font Mono',
  'MesloLGM Nerd Font Mono',
  'FantasqueSansM Nerd Font Mono',
  'ZzzObscure Nerd Font Mono',
  'MesloLGS NF',
  'Unifont',
  'Hack'
]

const { nerd, mono } = fonts.splitFamilies(all, monospaced)

check('every Nerd Font is grouped as one', nerd.length === 10, `${nerd.length} found`)
check('non-Nerd families never leak into the Nerd list', nerd.every((f) => /nerd font|\bnf$/i.test(f)))
check(
  'the Powerlevel10k-style "… NF" names count as Nerd Fonts',
  nerd.includes('MesloLGS NF') && nerd.includes('CaskaydiaCove NF')
)
check('a family merely containing "nf" is not a Nerd Font', !nerd.includes('Unifont') && mono.includes('Unifont'))
check('proportional families never leak into the mono list', !mono.includes('Inter'))
check('blank and duplicate families are dropped', !nerd.includes('') && mono.filter((f) => f === 'Hack').length === 1)
check('the mono list is alphabetical', JSON.stringify(mono) === JSON.stringify([...mono].sort()))
check('Meslo (the powerlevel10k standard) is offered first', nerd[0] === 'MesloLGS Nerd Font Mono', nerd[0])
check(
  'a "… Mono" family outranks its proportional sibling',
  nerd.indexOf('Hack Nerd Font Mono') < nerd.indexOf('Hack Nerd Font') &&
    nerd.indexOf('MesloLGS Nerd Font Mono') < nerd.indexOf('MesloLGS Nerd Font')
)
check(
  'an unknown "… Mono" family still ranks above an unknown proportional one',
  nerd.indexOf('ZzzObscure Nerd Font Mono') < nerd.indexOf('ZzzObscure Nerd Font')
)
check('an empty machine yields empty lists, not a crash', JSON.stringify(fonts.splitFamilies([], [])) === '{"nerd":[],"mono":[]}')

/* ─── the stack the terminal renders with ────────────────────────────────── */

section('terminal font stack')

const auto = stack.termFontStack()
const chosen = stack.termFontStack('Hack Nerd Font Mono')

check('automatic mode leads with a Nerd Font', /^'MesloLGS Nerd Font Mono',/.test(auto), auto.slice(0, 40))
check('automatic mode ends in generic monospace', auto.trimEnd().endsWith('monospace'))
check(
  'the bundled symbols font is only a fallback, never the lead',
  auto.includes("'SymbolsNerdFontMono'") && !auto.startsWith("'SymbolsNerdFontMono'"),
  'symbols font is symbols-only, so letters must come from a patched family'
)
check('an explicit choice wins outright', chosen.startsWith("'Hack Nerd Font Mono',"))
check('an empty choice falls back to automatic', stack.termFontStack('') === auto)
check('quotes in a family name cannot break out of the CSS string', !stack.termFontStack("E'vil").includes("E'vil"))

/* ─── the card (Blinko) typeface picker ─────────────────────────────────── */

section('card font group + stack')

const sans = fonts.sansFamilies(all, monospaced)
check('proportional families land in their own group', sans.includes('Inter'), sans.join(','))
check('monospace never leaks into the proportional group', !sans.includes('DejaVu Sans Mono'))
check('Nerd Fonts never leak into the proportional group', !sans.some((f) => /nerd font|\bnf$/i.test(f)))
check('blank entries are dropped', !sans.includes(''))
check('the proportional group is alphabetical', JSON.stringify(sans) === JSON.stringify([...sans].sort()))
check('an empty machine yields an empty list, not a crash', JSON.stringify(fonts.sansFamilies([], [])) === '[]')

check('no choice inherits the app UI font', stack.cardFontStack('') === '')
check('a generic keyword is emitted bare', stack.cardFontStack('serif') === 'serif')
check('a generic keyword is matched case-insensitively', stack.cardFontStack('Sans-Serif') === 'sans-serif')
check(
  'a real family is quoted and gets a UI tail',
  stack.cardFontStack('Inter') === "'Inter', system-ui, sans-serif"
)
check('quotes in a family name cannot break out of the CSS string', !stack.cardFontStack("E'vil").includes("E'vil"))
check('whitespace alone means "no choice"', stack.cardFontStack('   ') === '')
check(
  'presets all resolve to something usable',
  stack.CARD_FONT_PRESETS.every((p) => p.value === '' || stack.cardFontStack(p.value) !== '')
)

/* ─── this machine (informational) ───────────────────────────────────────── */

section('this machine')

try {
  const installed = await fonts.listFonts()
  console.log(`  nerd fonts : ${installed.nerd.length ? installed.nerd.join(', ') : '(none installed)'}`)
  console.log(`  monospace  : ${installed.mono.join(', ') || '(none)'}`)
  console.log(`  proportional: ${installed.sans.length} families`)
  // What the terminal's automatic stack actually resolves to on this box.
  const head = /^'([^']+)'/.exec(auto)?.[1] ?? ''
  if (head) {
    const match = execFileSync('fc-match', ['--format', '%{family}', head], { encoding: 'utf8' }).trim()
    console.log(`  automatic  : ${head} → ${match}`)
  }
} catch (err) {
  console.log(`  (could not read fontconfig: ${err instanceof Error ? err.message : String(err)})`)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
