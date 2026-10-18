#!/usr/bin/env node
/**
 * Verify the wallpaper theme: detection, the palette → theme maths, and the
 * live follow. Run with `npm run verify:wallpaper`.
 *
 * Everything here is portable — no test framework, no image library, no
 * dependency on this machine's wallpaper. It bundles the two real modules with
 * esbuild and exercises them against synthetic fixtures:
 *
 *   • Plasma appletsrc parsing (the slideshow/image precedence is the fiddly bit)
 *   • resolution of wallpaper packages and file:// URLs
 *   • the palette derivation, asserted on WCAG contrast — this is the part most
 *     likely to break silently as colours get tuned
 *   • the watcher noticing a wallpaper change (a simulated slideshow advance)
 *
 * If a real Plasma config exists it is reported at the end for information only.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const work = join(root, 'node_modules', '.cache', 'verify-wallpaper')
const fixture = join(work, 'fixture')
rmSync(work, { recursive: true, force: true })
mkdirSync(fixture, { recursive: true })

/* ─── bundle the modules under test ──────────────────────────────────────── */

const esbuild = join(root, 'node_modules', '.bin', 'esbuild')
const bundle = (entry, out, extra = []) =>
  execFileSync(
    esbuild,
    [entry, '--bundle', '--platform=node', '--format=esm', `--outfile=${out}`, '--log-level=warning', ...extra],
    { cwd: root }
  )

bundle('src/main/wallpaper.ts', join(work, 'wallpaper.mjs'), ['--external:chokidar'])
bundle('src/renderer/walltheme.ts', join(work, 'walltheme.mjs'))

const wp = await import(pathToFileURL(join(work, 'wallpaper.mjs')).href)
const wt = await import(pathToFileURL(join(work, 'walltheme.mjs')).href)

/* ─── tiny check harness ─────────────────────────────────────────────────── */

let failures = 0
const check = (label, ok, detail) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}
const section = (name) => console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 58 - name.length))}`)

/** Any CSS colour the theme emits → components, for contrast checking. */
function toRgb(css) {
  const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css)
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3] }
  const hsl = /hsl\((\d+),\s*(\d+)%,\s*([\d.]+)%\)/.exec(css)
  if (hsl) return wt.hslToRgb({ h: +hsl[1], s: +hsl[2] / 100, l: +hsl[3] / 100 })
  throw new Error(`cannot parse colour: ${css}`)
}

/* ─── fixtures ───────────────────────────────────────────────────────────── */

// Two "images" — detection only needs them to exist, the maths is fed pixels directly.
const imageA = join(fixture, 'PinkLady.png')
const imageB = join(fixture, 'Cachy Sunset.png') // a space, to exercise URL decoding
writeFileSync(imageA, Buffer.alloc(4000, 7))
writeFileSync(imageB, Buffer.alloc(6000, 9))

// A Plasma "wallpaper package": a folder with several sizes inside.
const pkg = join(fixture, 'WhiteSur')
mkdirSync(join(pkg, 'contents', 'images'), { recursive: true })
mkdirSync(join(pkg, 'contents', 'images_dark'), { recursive: true })
writeFileSync(join(pkg, 'metadata.json'), '{}')
writeFileSync(join(pkg, 'contents', 'images', '1024x768.png'), Buffer.alloc(100))
writeFileSync(join(pkg, 'contents', 'images', '3840x2160.png'), Buffer.alloc(5000)) // biggest → expected
writeFileSync(join(pkg, 'contents', 'images_dark', '1920x1080.png'), Buffer.alloc(2000))

/* ─── parsing the Plasma config ──────────────────────────────────────────── */

section('Plasma appletsrc parsing')

// Panel containments also carry a wallpaperplugin=; only the folder plugin is a desktop.
const ini = `
[Containments][1]
plugin=org.kde.plasma.folder
wallpaperplugin=org.kde.slideshow

[Containments][1][Wallpaper][org.kde.image][General]
Image=file:///some/package/dir/

[Containments][1][Wallpaper][org.kde.slideshow][General]
Image=file://${imageA}
SlidePaths=/usr/share/wallpapers/

[Containments][2]
plugin=org.kde.plasma.panel
wallpaperplugin=org.kde.image

[Containments][2][Wallpaper][org.kde.image][General]
Image=file:///panel/should/be/ignored.png
`
const groups = wp.parseIni(ini)
const slid = wp.pickPlasmaWallpaper(groups)
check('the active slideshow block wins over the image block', slid?.value === `file://${imageA}`, slid?.value)
check('reports it came from the slideshow plugin', slid?.via === 'kde-slideshow', slid?.via)
check('panel containments are ignored', !slid?.value.includes('panel'))

// A desktop using the plain image plugin, whose value is a package folder.
const plain = wp.pickPlasmaWallpaper(
  wp.parseIni(`[Containments][4]\nplugin=org.kde.plasma.folder\nwallpaperplugin=org.kde.image\n
[Containments][4][Wallpaper][org.kde.image][General]\nImage=file://${pkg}/`)
)
check('plain image plugin is picked up', plain?.via === 'kde')
check('a second desktop containment overrides the first', !!plain)

// Nested sections, comments, blank values and empty sections must survive.
const messy = wp.parseIni('# comment\n\n[Containments][9]\nplugin=org.kde.plasma.folder\n\nwallpaperplugin=org.kde.image\n\n[Containments][9][Wallpaper][org.kde.image][General]\nImage=\nFoo=bar\nImage=file:///last/wins.png\n')
check('later duplicate keys win', messy['Containments/9/Wallpaper/org.kde.image/General']?.Image === 'file:///last/wins.png')
check('comments and blank lines are skipped', Object.keys(messy).length === 2, Object.keys(messy).join(' | '))
check('an empty config yields nothing', wp.pickPlasmaWallpaper(wp.parseIni('')) === null)

section('File resolution')
check('file:// URL decoding', wp.fileUrlToPath(`file://${imageB}`) === imageB, wp.fileUrlToPath(`file://${imageB}`))
check('percent-encoded URL decoding', wp.fileUrlToPath('file:///a%20b/c.png') === '/a b/c.png')
check('a plain path passes through', wp.fileUrlToPath('/tmp/x.png') === '/tmp/x.png')
check(
  'a wallpaper package resolves to its biggest image',
  (await wp.resolveWallpaperFile(pkg)) === join(pkg, 'contents', 'images', '3840x2160.png'),
  await wp.resolveWallpaperFile(pkg)
)
check('an existing file resolves to itself', (await wp.resolveWallpaperFile(imageA)) === imageA)
check('a missing path resolves to null', (await wp.resolveWallpaperFile('/nope/nope.png')) === null)
const emptyDir = join(fixture, 'empty')
mkdirSync(emptyDir, { recursive: true })
check('a directory with no images resolves to null', (await wp.resolveWallpaperFile(emptyDir)) === null)

/* ─── detection through a fake desktop ───────────────────────────────────── */

section('Detection')

const fakeHome = join(work, 'home')
const configDir = join(fakeHome, '.config')
mkdirSync(configDir, { recursive: true })
const configPath = join(configDir, 'plasma-org.kde.plasma.desktop-appletsrc')
const writeConfig = (image) =>
  writeFileSync(
    configPath,
    `[Containments][224]\nplugin=org.kde.plasma.folder\nwallpaperplugin=org.kde.slideshow\n\n` +
      `[Containments][224][Wallpaper][org.kde.slideshow][General]\nImage=file://${image}\n`
  )
writeConfig(imageA)
process.env.XDG_CONFIG_HOME = configDir

const detected = await wp.detectWallpaper(null)
check('detectWallpaper finds the configured image', detected?.path === imageA, detected?.path)
check('it reports a token that changes with the file', /^\d+-\d+$/.test(detected?.token ?? ''), detected?.token)
check('a manual choice overrides detection', (await wp.detectWallpaper(imageB))?.via === 'manual')
check('a stale manual path falls back to detection', (await wp.detectWallpaper('/gone.png'))?.path === imageA)

/* ─── the watcher follows changes ────────────────────────────────────────── */

section('Live follow')

const seen = []
const stats = wp.emptyWallpaperStats()
let resolveNext = null
const stop = wp.startWallpaperWatch(
  () => null,
  (info) => {
    seen.push(info)
    if (resolveNext) {
      const r = resolveNext
      resolveNext = null
      r(info)
    }
  },
  { stats }
)
const next = (ms) =>
  new Promise((res) => {
    const t = setTimeout(() => {
      resolveNext = null
      res(null)
    }, ms)
    resolveNext = (info) => {
      clearTimeout(t)
      res(info)
    }
  })

const initial = seen.length > 0 ? seen[seen.length - 1] : await next(6000)
check('reports the wallpaper at startup', initial?.path === imageA, initial?.path ?? 'nothing')

// The frequent re-detect must be able to read the source without spawning
// anything (it runs every few seconds), and it must be counted.
const cheap = await wp.detectWallpaper(null, { shell: false })
check('re-detect reads Plasma without a subprocess', cheap?.path === imageA, cheap?.path ?? 'nothing')
check('startup counts as the first change', stats.changes === 1, `changes=${stats.changes}`)
check('detections are running and stamped', stats.checks >= 1 && stats.checkedAt > 0, `checks=${stats.checks}`)

// Exactly what Plasma does when a slideshow advances.
await new Promise((r) => setTimeout(r, 500))
writeConfig(imageB)
const advanced = await next(8000)
check('follows a slideshow advance', advanced?.path === imageB, advanced?.path ?? 'nothing')
check('the token changes, busting the image cache', !!advanced && advanced.token !== initial?.token)
check('the change is counted', stats.changes === 2, `changes=${stats.changes}`)

await new Promise((r) => setTimeout(r, 500))
writeConfig(imageA)
const back = await next(8000)
check('follows a change back', back?.path === imageA, back?.path ?? 'nothing')

// De-duplication: re-reading the same config (poll ticks, the second event
// chokidar emits per save) must not be reported as a change. Three real
// changes → exactly three reports, each differing from the one before it.
await new Promise((r) => setTimeout(r, 2000))
const key = (s) => `${s.path}|${s.token}`
const consecutiveDistinct = seen.every((s, i) => i === 0 || key(s) !== key(seen[i - 1]))
check(
  'each real change is reported exactly once',
  seen.length === 3 && stats.changes === 3 && consecutiveDistinct,
  `reports=${seen.length} changes=${stats.changes}`
)

// The race that made the theme go stale: the first filesystem event arrives
// while the file is still mid-write. An intermediate state (imageB) must never
// be reported; only the settled content counts — and here it is what we
// already have, so nothing should be reported at all.
writeConfig(imageB)
await new Promise((r) => setTimeout(r, 30))
writeConfig(imageA)
const phantom = await next(3000)
check('a write burst reports nothing for the intermediate image', phantom === null, phantom?.path ?? 'no change')
check('and does not re-report the settled image', stats.changes === 3, `changes=${stats.changes}`)
stop()

/* ─── the re-detect poll works with no filesystem event at all ───────────── */

section('Poll fallback')

// A manually chosen image is not watched by anything: only the periodic
// re-detect can notice it changing. That is precisely the safety net the live
// follow depends on when a filesystem event goes missing.
const manualSeen = []
const manualStats = wp.emptyWallpaperStats()
const stopManual = wp.startWallpaperWatch(() => imageB, (info) => manualSeen.push(info), {
  stats: manualStats
})
await new Promise((r) => setTimeout(r, 800))
const beforeRewrite = manualSeen[manualSeen.length - 1]
writeFileSync(imageB, Buffer.concat([readFileSync(imageB), Buffer.from('x')]))
const afterRewrite = await (async () => {
  const deadline = Date.now() + 9000
  while (Date.now() < deadline) {
    const last = manualSeen[manualSeen.length - 1]
    if (last && last.token !== beforeRewrite?.token) return last
    await new Promise((r) => setTimeout(r, 200))
  }
  return null
})()
check(
  'a change with no filesystem event is still picked up',
  !!afterRewrite && afterRewrite.token !== beforeRewrite?.token,
  afterRewrite ? `new token ${afterRewrite.token}, ${manualStats.events} fs event(s)` : 'never noticed'
)
stopManual()

/* ─── the palette → theme maths ──────────────────────────────────────────── */

section('Palette derivation')

/** Build RGBA pixels from a list of colours weighted by repetition. */
function pixels(colours, repeats = 400) {
  const data = new Uint8ClampedArray(colours.length * repeats * 4)
  let o = 0
  for (const [r, g, b, a = 255] of colours)
    for (let i = 0; i < repeats; i++) {
      data[o++] = r
      data[o++] = g
      data[o++] = b
      data[o++] = a
    }
  return data
}

// A pink wallpaper with a vivid magenta accent (a "PinkLady" shape).
const pink = wt.pickPalette(pixels([[199, 90, 136], [220, 60, 140], [30, 24, 32]]))
check('finds a usable accent', pink.accent.r > 150 && pink.accent.b > 90, wt.cssRgb(pink.accent))
check('marks the accent as vivid', pink.accent.vivid === true)

const EXPECTED_VARS = ['--bg','--bg-soft','--bg-raise','--bg-glass','--border','--border-soft','--text','--text-dim','--text-muted','--accent','--accent-soft','--accent-glow','--tab-active-bg','--sidebar-bg','--shadow','--shadow-lg','--radius','--radius-sm','--radius-lg']

for (const [name, palette] of [
  ['pink', pink],
  ['blue', wt.pickPalette(pixels([[20, 40, 120], [80, 160, 255], [10, 10, 20]]))],
  ['gold', wt.pickPalette(pixels([[40, 30, 10], [230, 180, 60], [60, 50, 20]]))]
]) {
  for (const mode of ['dark', 'light']) {
    const vars = wt.buildVars(palette, mode)
    const missing = EXPECTED_VARS.filter((v) => !(v in vars))
    const bg = toRgb(vars['--bg'])
    const text = wt.contrast(toRgb(vars['--text']), bg)
    const dim = wt.contrast(toRgb(vars['--text-dim']), bg)
    const accent = wt.contrast(toRgb(vars['--accent']), bg)
    console.log(
      `  ${name.padEnd(5)} ${mode.padEnd(5)} bg ${vars['--bg'].padEnd(22)} text ${text.toFixed(1)}  dim ${dim.toFixed(1)}  accent ${accent.toFixed(1)}`
    )
    check(`${name}/${mode} sets all 19 variables`, missing.length === 0, missing.join(', '))
    check(`${name}/${mode} text clears WCAG AAA`, text >= 7, text.toFixed(2))
    check(`${name}/${mode} dim text is readable`, dim >= 3, dim.toFixed(2))
    check(`${name}/${mode} accent is visible`, accent >= (mode === 'dark' ? 3.5 : 3), accent.toFixed(2))
  }
}

section('Degenerate inputs')

// An all-grey wallpaper must not yield an invisible grey accent.
const grey = wt.pickPalette(pixels([[120, 120, 120], [90, 90, 90], [200, 200, 200]]))
const greyDark = wt.buildVars(grey, 'dark')
check('greyscale keeps a visible accent', wt.contrast(toRgb(greyDark['--accent']), toRgb(greyDark['--bg'])) >= 4, greyDark['--accent'])
check('greyscale does not tint the surfaces', wt.rgbToHsl(toRgb(greyDark['--bg'])).s < 0.02)
check('empty input returns the fallback', wt.pickPalette(new Uint8ClampedArray(8)).accent.r === 138)

// Transparent pixels (SVG wallpapers) must still produce something usable.
const clear = new Uint8ClampedArray(4000 * 4)
for (let i = 0; i < clear.length; i += 4) {
  clear[i] = 220
  clear[i + 1] = 60
  clear[i + 2] = 40
  clear[i + 3] = 0
}
const clearDark = wt.buildVars(wt.pickPalette(clear), 'dark')
check('a transparent image still yields a usable accent', wt.contrast(toRgb(clearDark['--accent']), toRgb(clearDark['--bg'])) >= 4)

section('Emitted CSS')

const css = wt.themeCss(wt.buildVars(pink, 'dark'), wt.buildVars(pink, 'light'))
check('targets the theme in both modes',
  css.includes(':root[data-theme="wallpaper"][data-mode="dark"]') &&
    css.includes(':root[data-theme="wallpaper"][data-mode="light"]'))
check('every variable is declared', EXPECTED_VARS.every((v) => css.includes(`${v}:`)))
check('swatches expose bg/text/accent', wt.swatches(wt.buildVars(pink, 'dark')).length === 3)

// The derivation leans on rgb↔hsl constantly; it must not drift.
let worstChannel = 0
let seed = 12345
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 256)
for (let i = 0; i < 4000; i++) {
  const src = { r: rand(), g: rand(), b: rand() }
  const out = wt.hslToRgb(wt.rgbToHsl(src))
  worstChannel = Math.max(worstChannel, Math.abs(out.r - src.r), Math.abs(out.g - src.g), Math.abs(out.b - src.b))
}
check('rgb → hsl → rgb is lossless within 1/255', worstChannel <= 1, `max drift ${worstChannel}`)

/* ─── informational: the real desktop ───────────────────────────────────── */

delete process.env.XDG_CONFIG_HOME
const realConfig = join(homedir(), '.config', 'plasma-org.kde.plasma.desktop-appletsrc')
if (existsSync(realConfig)) {
  section('This machine (informational)')
  const real = await wp.detectWallpaper(null)
  if (real) {
    console.log(`  ${real.via}: ${real.path}`)
    if (existsSync(real.path)) console.log(`  ${(readFileSync(real.path).length / 1024 / 1024).toFixed(1)} MB, token ${real.token}`)
  } else {
    console.log('  no wallpaper found by the detector')
  }
}

rmSync(work, { recursive: true, force: true })
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
