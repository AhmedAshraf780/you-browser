/**
 * Desktop-wallpaper detection + live watching (main process).
 *
 * Deliberately Electron-free: it's plain node, so the Plasma ini parsing and
 * the file resolution can be unit-tested against a real appletsrc.
 *
 * The useful trick: KDE Plasma records the *currently displayed* image in its
 * appletsrc. With the slideshow wallpaper plugin that line is rewritten every
 * time the slide advances — so watching the config file gives us a live signal
 * to re-derive the theme. Nothing else about Plasma is assumed.
 */

import { promises as fs } from 'fs'
import { execFile } from 'child_process'
import { homedir } from 'os'
import { basename, extname, join } from 'path'
import { watch, type FSWatcher } from 'chokidar'

export interface WallpaperInfo {
  /** absolute path of the image currently behind the desktop */
  path: string
  /** file name, for the UI */
  name: string
  /** how it was found: kde-slideshow | kde | gnome | manual */
  via: string
  /** mtime + size of the image: busts the you-wall:// cache, signals changes */
  token: string
}

/** What the renderer receives, over IPC and on wallpaper changes. */
export interface WallpaperPayload extends WallpaperInfo {
  /** true when this is a user-chosen image rather than the detected desktop one */
  manual: boolean
}

const IMAGE_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.avif', '.bmp', '.gif', '.svg',
  '.jxl', '.heic', '.heif', '.tif', '.tiff'
])

export function configHome(): string {
  return process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config')
}

export function plasmaConfigPath(): string {
  return join(configHome(), 'plasma-org.kde.plasma.desktop-appletsrc')
}

function dconfPath(): string {
  return join(configHome(), 'dconf', 'user')
}

/* ─── Plasma appletsrc (ini) ─────────────────────────────────────────────── */

export type IniGroups = Record<string, Record<string, string>>

/**
 * Parse KDE's nested ini dialect. Sections stack as `[A][B][C]` and become the
 * key `A/B/C`; repeated keys inside a section keep the last value.
 */
export function parseIni(text: string): IniGroups {
  const out: IniGroups = {}
  let section: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    if (line.startsWith('[')) {
      section = line
        .split(']')
        .map((part) => part.replace(/^\[/, '').trim())
        .filter((part) => part.length > 0)
      continue
    }
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = section.join('/')
    const group = (out[key] ??= {})
    group[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  return out
}

/** The desktop containment carries this plugin id (panels carry others). */
const DESKTOP_PLUGIN = 'org.kde.plasma.folder'

/**
 * Find the image the desktop is showing. Containments are the desktops/screens;
 * only the folder plugin ones are wallpapers. The *active* wallpaper plugin's
 * own block wins, then any other wallpaper block in the same containment.
 * The last containment that yields a value is used (multi-screen).
 */
export function pickPlasmaWallpaper(groups: IniGroups): { value: string; via: string } | null {
  let found: { value: string; via: string } | null = null
  for (const [key, vals] of Object.entries(groups)) {
    const id = /^Containments\/(\d+)$/.exec(key)?.[1]
    if (!id || vals['plugin'] !== DESKTOP_PLUGIN) continue
    const active = vals['wallpaperplugin'] ?? 'org.kde.image'
    const groups_ = Object.keys(groups).filter(
      (k) => k.startsWith(`Containments/${id}/Wallpaper/`) && groups[k] !== undefined
    )
    const activeBlocks = groups_.filter((k) => k.split('/')[3] === active)
    const otherBlocks = groups_.filter((k) => k.split('/')[3] !== active)
    for (const block of [...activeBlocks, ...otherBlocks]) {
      const value = groups[block]?.['Image']?.trim()
      if (!value) continue
      found = { value, via: block.includes('slideshow') ? 'kde-slideshow' : 'kde' }
      break
    }
  }
  return found
}

/** `file:///a%20b.png` → `/a b.png`; plain paths pass through. */
export function fileUrlToPath(value: string): string {
  if (!value.startsWith('file:')) return value
  try {
    return decodeURIComponent(new URL(value).pathname)
  } catch {
    return value.replace(/^file:\/\//, '')
  }
}

/* ─── resolving to a real image file ─────────────────────────────────────── */

async function statSafe(path: string): Promise<Awaited<ReturnType<typeof fs.stat>> | null> {
  try {
    return await fs.stat(path)
  } catch {
    return null
  }
}

/** Plasma "wallpaper packages" are folders — take the biggest image inside. */
async function biggestImage(dir: string, depth: number): Promise<{ path: string; size: number } | null> {
  if (depth > 3) return null
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }
  let best: { path: string; size: number } | null = null
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      const inner = await biggestImage(full, depth + 1)
      if (inner && (!best || inner.size > best.size)) best = inner
    } else if (IMAGE_EXT.has(extname(entry.name).toLowerCase())) {
      const st = await statSafe(full)
      const size = st ? Number(st.size) : 0
      if (st?.isFile() && (!best || size > best.size)) best = { path: full, size }
    }
  }
  return best
}

/** Turn a config value (file, or a wallpaper package folder) into an image file. */
export async function resolveWallpaperFile(path: string): Promise<string | null> {
  const st = await statSafe(path)
  if (!st) return null
  if (st.isFile()) return path
  if (!st.isDirectory()) return null
  return (await biggestImage(path, 0))?.path ?? null
}

/* ─── detection ──────────────────────────────────────────────────────────── */

async function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: 4000 }, (err, stdout) => resolve(err ? '' : stdout))
    } catch {
      resolve('')
    }
  })
}

async function makeInfo(path: string, via: string): Promise<WallpaperInfo | null> {
  const st = await statSafe(path)
  if (!st?.isFile()) return null
  return {
    path,
    name: basename(path),
    via,
    token: `${Math.round(Number(st.mtimeMs))}-${st.size}`
  }
}

function shouldQueryDbus(): boolean {
  if (configHome() !== join(homedir(), '.config') || configHome().includes('.cache/verify-wallpaper')) {
    return false
  }
  const xdg = (process.env['XDG_CURRENT_DESKTOP'] || '').toLowerCase()
  const session = (process.env['XDG_SESSION_DESKTOP'] || '').toLowerCase()
  const isKde = process.env['KDE_FULL_SESSION'] === 'true' || xdg.includes('kde') || session.includes('kde')
  return isKde || Boolean(process.env['DBUS_SESSION_BUS_ADDRESS'])
}

/**
 * Query KDE Plasma's running shell via D-Bus for the live active wallpaper.
 *
 * KDE Plasma's slideshow wallpaper plugin updates the current slide in memory
 * and intentionally does not flush it to plasma-org.kde.plasma.desktop-appletsrc
 * on each transition to save disk writes. Querying org.kde.PlasmaShell.wallpaper
 * returns the live, currently displayed image.
 */
async function plasmaDbusWallpaper(): Promise<WallpaperInfo | null> {
  let out = await run('dbus-send', [
    '--session',
    '--dest=org.kde.plasmashell',
    '--type=method_call',
    '--print-reply',
    '/PlasmaShell',
    'org.kde.PlasmaShell.wallpaper',
    'uint32:0'
  ])

  let imgMatch: RegExpExecArray | null = null
  let pluginMatch: RegExpExecArray | null = null

  if (out) {
    imgMatch = /string\s+"Image"\s+variant\s+string\s+"([^"]+)"/.exec(out)
    pluginMatch = /string\s+"wallpaperPlugin"\s+variant\s+string\s+"([^"]+)"/.exec(out)
  }

  if (!imgMatch?.[1]) {
    for (const qdbus of ['qdbus6', 'qdbus']) {
      out = await run(qdbus, ['org.kde.plasmashell', '/PlasmaShell', 'org.kde.PlasmaShell.wallpaper', '0'])
      if (out) {
        imgMatch = /^Image:\s*(.+)$/m.exec(out)
        pluginMatch = /^wallpaperPlugin:\s*(.+)$/m.exec(out)
        if (imgMatch?.[1]) break
      }
    }
  }

  const rawPath = imgMatch?.[1]?.trim()
  if (!rawPath) return null

  const via = pluginMatch?.[1]?.includes('slideshow') ? 'kde-slideshow' : 'kde'
  const file = await resolveWallpaperFile(fileUrlToPath(rawPath))
  return file ? makeInfo(file, via) : null
}

async function plasmaWallpaper(allowDbus = true): Promise<WallpaperInfo | null> {
  if (allowDbus && shouldQueryDbus()) {
    try {
      const live = await plasmaDbusWallpaper()
      if (live) return live
    } catch {
      // Fall through to appletsrc file parsing
    }
  }

  let text: string
  try {
    text = await fs.readFile(plasmaConfigPath(), 'utf-8')
  } catch {
    return null
  }
  const picked = pickPlasmaWallpaper(parseIni(text))
  if (!picked) return null
  const file = await resolveWallpaperFile(fileUrlToPath(picked.value))
  return file ? makeInfo(file, picked.via) : null
}

async function gnomeWallpaper(): Promise<WallpaperInfo | null> {
  for (const key of ['picture-uri-dark', 'picture-uri']) {
    const out = (await run('gsettings', ['get', 'org.gnome.desktop.background', key])).trim()
    if (!out) continue
    const value = out.replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1')
    if (!value) continue
    const file = await resolveWallpaperFile(fileUrlToPath(value))
    if (file) return makeInfo(file, 'gnome')
  }
  return null
}

export interface DetectOptions {
  /**
   * Allow sources that shell out (GNOME's gsettings, KDE D-Bus query). Off
   * for the frequent static re-detect: reading config files is free, spawning
   * a process is not.
   */
  shell?: boolean
}

/**
 * The image to derive a theme from: the manual override when set and still
 * readable, else whatever the desktop is showing.
 */
export async function detectWallpaper(
  manual: string | null,
  options: DetectOptions = {}
): Promise<WallpaperInfo | null> {
  if (manual) {
    const file = await resolveWallpaperFile(manual)
    const info = file ? await makeInfo(file, 'manual') : null
    if (info) return info
  }
  const allowShell = options.shell !== false
  const plasma = await plasmaWallpaper(allowShell)
  if (plasma) return plasma
  if (!allowShell) return null
  return await gnomeWallpaper()
}

/* ─── content sniffing (so you-wall:// serves a decodable mime) ──────────── */

export function sniffMime(buf: Buffer): string {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png'
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp'
  }
  if (buf.length > 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12)
    if (brand.startsWith('avif') || brand === 'avis') return 'image/avif'
    if (brand.startsWith('heic') || brand.startsWith('heix') || brand.startsWith('mif1')) return 'image/heic'
  }
  if (buf.length > 3 && buf.toString('ascii', 0, 3) === 'GIF') return 'image/gif'
  if (buf.length > 2 && buf.toString('ascii', 0, 2) === 'BM') return 'image/bmp'
  if (buf.length > 5 && buf.toString('ascii', 0, 5) === '<?xml') return 'image/svg+xml'
  if (buf.length > 4 && buf.toString('ascii', 0, 4) === '<svg') return 'image/svg+xml'
  return 'application/octet-stream'
}

/* ─── watching ───────────────────────────────────────────────────────────── */

/** Cheap diagnostics, surfaced so "is it following?" is answerable at a glance. */
export interface WallpaperStats {
  /** filesystem events seen on the watched config files */
  events: number
  /** re-detections performed */
  checks: number
  /** times the detected wallpaper actually changed */
  changes: number
  /** when the last detection ran (ms since epoch) */
  checkedAt: number
}

export function emptyWallpaperStats(): WallpaperStats {
  return { events: 0, checks: 0, changes: 0, checkedAt: 0 }
}

export interface WallpaperWatchOptions {
  /** shared counters; the caller can hand them to the UI */
  stats?: WallpaperStats
  /** one line per interesting event — used for the optional debug log */
  log?: (message: string) => void
}

/** How often the config is re-read from scratch. Cheap; no subprocesses. */
const POLL_MS = 5_000
/** Slower full detect, so a missed event on a shell source still gets caught. */
const DEEP_POLL_MS = 60_000

/**
 * Watch the desktop wallpaper and report every change.
 *
 * Two independent signals, because a theme that only follows *sometimes* is
 * worse than no theme at all:
 *   1. filesystem events on Plasma's config / dconf — instant;
 *   2. a straight re-read every few seconds — immune to missed events and to
 *      the config being replaced rather than rewritten in place.
 * Detection is de-duplicated by path + mtime/size, so re-reading is free.
 * Returns a teardown function.
 */
export function startWallpaperWatch(
  getManual: () => string | null,
  onChange: (info: WallpaperInfo | null) => void,
  options: WallpaperWatchOptions = {}
): () => void {
  const stats = options.stats ?? emptyWallpaperStats()
  const log = options.log ?? ((): void => undefined)
  let current: WallpaperInfo | null = null
  let currentSeen = false
  let running = false
  let again = false
  let againShell = false
  let settle: ReturnType<typeof setTimeout> | null = null
  const watchers: FSWatcher[] = []

  const check = async (shell: boolean): Promise<void> => {
    if (running) {
      // Coalesce: re-read once the in-flight detect finishes, remembering
      // whether any of the requests wanted a shell source.
      again = true
      againShell = againShell || shell
      return
    }
    running = true
    try {
      const next = await detectWallpaper(getManual(), { shell })
      stats.checks++
      stats.checkedAt = Date.now()
      const same =
        currentSeen &&
        ((!next && !current) ||
          (!!next && !!current && next.path === current.path && next.token === current.token))
      current = next
      currentSeen = true
      if (!same) {
        stats.changes++
        log(`detected ${next ? `${next.path} via ${next.via} [${next.token}]` : 'nothing'}`)
        onChange(next)
      }
    } catch (err) {
      log(`detect threw: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      running = false
      if (again) {
        again = false
        const wanted = againShell
        againShell = false
        void check(wanted)
      }
    }
  }

  const watchFile = (path: string): void => {
    try {
      const w = watch(path, { ignoreInitial: true, depth: 0 })
      w.on('all', (event) => {
        stats.events++
        if (path === plasmaConfigPath()) log(`fs ${event} on ${basename(path)}`)
        // Read *after* the writer has finished. Plasma rewrites this file (and
        // renames over it) while we're watching; reading on the first event can
        // catch a half-written file, decide "unchanged", and then never look
        // again because the follow-up event gets coalesced. Debouncing makes
        // the fast path both instant and correct.
        if (settle) clearTimeout(settle)
        settle = setTimeout(() => {
          settle = null
          void check(true)
        }, 150)
      })
      w.on('error', () => undefined)
      watchers.push(w)
    } catch (err) {
      // Unwatchable (missing, permissions) — polling still covers us.
      log(`watch failed on ${path}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  watchFile(plasmaConfigPath())
  watchFile(dconfPath())
  log(`watching ${plasmaConfigPath()} and ${dconfPath()}`)

  const poll = setInterval(() => {
    // In KDE slideshow mode, Plasma never rewrites its config on disk during
    // slide transitions to save SSD wear. Following a slideshow therefore requires
    // live D-Bus queries on poll. For static wallpapers, filesystem watching is instant.
    const isSlideshow = current?.via === 'kde-slideshow'
    void check(isSlideshow)
  }, POLL_MS)
  const deepPoll = setInterval(() => void check(true), DEEP_POLL_MS)

  void check(true)

  return () => {
    clearInterval(poll)
    clearInterval(deepPoll)
    if (settle) clearTimeout(settle)
    for (const w of watchers) void w.close()
  }
}
