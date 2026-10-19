import { app, BrowserWindow, dialog, ipcMain, nativeTheme, Notification, session, shell } from 'electron'

// Stable window class so taskbars/docks group the app under one icon
// (matches StartupWMClass in you.desktop).
app.commandLine.appendSwitch('class', 'You')
// Display name everywhere (window titles, notifications, WM_CLASS).
// userData stays pinned below, so existing settings/vault/engine/cache
// keep working instead of moving to a fresh folder.
app.setName('You')
app.setPath('userData', join(app.getPath('appData'), 'unibrowser'))
import { join, relative, resolve, sep } from 'path'
import { promises as fs, constants as fsConstants, accessSync } from 'fs'
import { watch, type FSWatcher } from 'chokidar'
import { ElectronBlocker } from '@ghostery/adblocker-electron'
import { NetworkFilter } from '@ghostery/adblocker'
import { listFonts } from './fonts'
import { killTerm, resizeTerm, spawnTerm, writeTerm } from './pty'
import { serveAppProtocol, serveVaultProtocol, serveWallpaperProtocol } from './protocol'
import { DEFAULT_STUDY, normalizeStudy, type StudySettings, type WordEntry } from './study'
import { fetchWord } from './wordsource'
import {
  detectWallpaper,
  emptyWallpaperStats,
  startWallpaperWatch,
  type WallpaperInfo,
  type WallpaperPayload
} from './wallpaper'

let win: BrowserWindow | null = null
let watcher: FSWatcher | null = null
let vaultDir = ''
let notifyTimer: NodeJS.Timeout | null = null
let blocker: ElectronBlocker | null = null
let adsEnabled = true
let study: StudySettings = { ...DEFAULT_STUDY }
let studyTimer: NodeJS.Timeout | null = null
let studyFiring = false
/** The wallpaper the "Wallpaper" theme derives its colours from (null = none found). */
let wallpaperInfo: WallpaperInfo | null = null
/** User-chosen image that overrides detection ('' = follow the desktop). */
let manualWallpaper = ''
/** How the live wallpaper watch is doing — makes "is it following?" visible. */
const wallpaperStats = emptyWallpaperStats()

// --- settings (persist chosen vault across restarts) ---

interface Settings {
  vaultPath?: string
  adsEnabled?: boolean
  study?: StudySettings
  wallpaperPath?: string
}

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

async function loadSettings(): Promise<Settings> {
  try {
    return JSON.parse(await fs.readFile(settingsFile(), 'utf-8')) as Settings
  } catch {
    return {}
  }
}

async function saveSettings(s: Settings): Promise<void> {
  const prev = await loadSettings()
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(settingsFile(), JSON.stringify({ ...prev, ...s }, null, 2), 'utf-8')
}

function defaultVault(): string {
  if (app.isPackaged) return join(app.getPath('userData'), 'vault')
  return join(app.getAppPath(), 'vault')
}

async function resolveVault(): Promise<string> {
  const s = await loadSettings()
  if (s.vaultPath) {
    try {
      const st = await fs.stat(s.vaultPath)
      if (st.isDirectory()) return s.vaultPath
    } catch {
      // stored folder deleted — fall through to default
    }
  }
  const d = defaultVault()
  await fs.mkdir(d, { recursive: true })
  return d
}

/** Resolve a vault-relative path, rejecting traversal outside the vault. */
function inside(relPath: string): string {
  const full = resolve(vaultDir, relPath)
  const rel = relative(vaultDir, full)
  if (rel === '..' || rel.startsWith(`..${sep}`) || rel === '') {
    throw new Error('invalid path')
  }
  return full
}

export interface VaultTreeNode {
  name: string
  path: string
  isDir: boolean
  children?: VaultTreeNode[]
  mtimeMs?: number
}

async function buildTree(base: string, rel = ''): Promise<VaultTreeNode[]> {
  let entries
  try {
    entries = await fs.readdir(join(base, rel), { withFileTypes: true })
  } catch {
    return []
  }
  const nodes: VaultTreeNode[] = []
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const p = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) {
      nodes.push({ name: e.name, path: p, isDir: true, children: await buildTree(base, p) })
    } else {
      let mtimeMs = 0
      try {
        mtimeMs = (await fs.stat(join(base, p))).mtimeMs
      } catch {
        // unreadable — still list it, sorts last
      }
      nodes.push({ name: e.name, path: p, isDir: false, mtimeMs })
    }
  }
  nodes.sort((a, b) =>
    a.isDir === b.isDir
      ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      : a.isDir
        ? -1
        : 1
  )
  return nodes
}

// --- live watching: external edits (VSCode, Obsidian, file manager) refresh the sidebar ---

function startWatcher(): void {
  void watcher?.close()
  watcher = null
  if (!win || !vaultDir) return
  watcher = watch(vaultDir, { ignoreInitial: true, depth: 10 })
  const notify = (): void => {
    if (notifyTimer) clearTimeout(notifyTimer)
    notifyTimer = setTimeout(() => win?.webContents.send('vault:changed'), 300)
  }
  watcher.on('all', notify)
}

async function setVaultDir(dir: string): Promise<void> {
  vaultDir = dir
  await saveSettings({ vaultPath: dir })
  startWatcher()
  win?.webContents.send('vault:changed')
}

// --- adblocker (uBlock-style filter lists on the browser session) ---

function browserSession(): Electron.Session {
  return session.fromPartition('persist:unibrowser')
}

async function initBlocker(): Promise<void> {
  adsEnabled = (await loadSettings()).adsEnabled ?? true
  try {
    blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
      path: join(app.getPath('userData'), 'adblock-engine.bin'),
      read: async (p) => fs.readFile(p),
      write: async (p, data) => {
        await fs.writeFile(p, data)
      }
    })
    if (adsEnabled) blocker.enableBlockingInSession(browserSession())
    // YouTube is owned by the in-page ad-skipper (see adskip.ts): killing ad
    // requests at the network level stalls the player and trips YouTube's
    // anti-adblock wall, so the engine leaves YouTube documents alone.
    try {
      const exceptions = ['@@||youtube.com^$document', '@@||youtu.be^$document']
        .map((line) => NetworkFilter.parse(line))
        .filter((f): f is NetworkFilter => f !== null)
      blocker.update({ newNetworkFilters: exceptions })
    } catch (e) {
      console.warn('adblocker youtube exception failed:', e instanceof Error ? e.message : e)
    }
    console.log('adblocker engine ready')
  } catch (e) {
    // offline on first run, CDN hiccup, etc. — browse unblocked rather than crash
    console.warn('adblocker unavailable:', e instanceof Error ? e.message : e)
    blocker = null
  }
}

async function setAdsEnabled(on: boolean): Promise<boolean> {
  adsEnabled = on
  await saveSettings({ adsEnabled: on })
  if (blocker) {
    if (on) blocker.enableBlockingInSession(browserSession())
    else blocker.disableBlockingInSession(browserSession())
  }
  return adsEnabled
}

// --- English word feeder ---------------------------------------------------
// The system owns word sourcing: on a timer it picks a B1 word from the
// bundled bank (see study.ts) and either drops it into the app as an overlay
// card (when You is focused) or fires a native notification (when it isn't).
// Clicking that notification focuses the window and shows the card.

function armStudy(): void {
  if (studyTimer) {
    clearInterval(studyTimer)
    studyTimer = null
  }
  if (!study.enabled) return
  const ms = Math.max(1, study.intervalMin) * 60_000
  studyTimer = setInterval(() => void fireStudy(false), ms)
}

async function fireStudy(manual: boolean): Promise<WordEntry | null> {
  if (!study.enabled && !manual) return null
  if (studyFiring) return null
  studyFiring = true
  try {
    const word = await fetchWord(study)
    if (!word) return null

    const consume = async (): Promise<void> => {
      study = { ...study, seen: [...study.seen, word.word].slice(-1000) }
      await saveSettings({ study })
    }

    if (!win || win.isDestroyed()) {
      await consume()
      return word
    }

    const focused = win.isFocused()
    if (manual || focused || !Notification.isSupported()) {
      await consume()
      win.webContents.send('study:word', word)
    } else {
      // attention-grabber only. The word isn't consumed yet, so if the notice
      // is ignored it can come round again instead of being silently spent.
      const note = new Notification({
        title: `New word · ${word.word}`,
        body: word.meaning
      })
      note.on('click', () => {
        void consume().then(() => {
          win?.show()
          win?.focus()
          win?.webContents.send('study:word', word)
        })
      })
      note.show()
    }
    return word
  } finally {
    studyFiring = false
    if (manual) armStudy()
  }
}

// --- app-wide shortcuts that must fire even when a webview page has focus ---
// (Renderer keydown never sees keys typed inside a guest page, so the main
// process intercepts them pre-dispatch for both host and guest contents.)

app.on('web-contents-created', (_e, contents) => {
  contents.on('before-input-event', (event, input) => {
    // Alt+1..5 jumps to Vault / Board / Calendar / Settings / Blinko (toggleable).
    // Plain Alt only — AltGr arrives as Ctrl+Alt and must keep typing.
    if (input.type === 'keyDown' && input.alt && !input.control && !input.meta && !input.shift) {
      const navIds = ['vault', 'kanban', 'calendar', 'settings', 'blinko'] as const
      if (input.key >= '1' && input.key <= '5') {
        event.preventDefault()
        win?.webContents.send('nav-key', navIds[Number(input.key) - 1])
        return
      }
    }
    if (input.type !== 'keyDown' || input.alt || !(input.control || input.meta)) return
    const key = input.key.toLowerCase()
    // Ctrl+T is browser-reserved: hijack everywhere, including video pages.
    if (key === 't' && !input.shift) {
      event.preventDefault()
      win?.webContents.send('quick-open')
    } else if (key === 'b' && !input.shift && contents.getType() !== 'webview') {
      // Ctrl+B only outside pages — never steal bold from Google Docs etc.
      event.preventDefault()
      win?.webContents.send('toggle-sidebar')
    } else if (key === 'tab') {
      // Ctrl+Tab / Ctrl+Shift+Tab cycles tabs, everywhere including guests
      event.preventDefault()
      win?.webContents.send('cycle-tab', input.shift ? -1 : 1)
    } else if (!input.shift && key.length === 1 && key >= '1' && key <= '9') {
      // Ctrl+1..8 jumps to tab N, Ctrl+9 to the last tab (browser convention)
      event.preventDefault()
      win?.webContents.send('goto-tab', Number(key) - 1)
    } else if (key === 'f' && !input.shift) {
      // Ctrl+F find: renderer decides web find-bar vs note search panel
      event.preventDefault()
      win?.webContents.send('find-open')
    } else if (key === 'enter' && !input.shift) {
      // Ctrl+Enter: root terminal — focus it, or open one at the vault root
      event.preventDefault()
      win?.webContents.send('open-terminal')
    } else if (key === 'e' && input.shift) {
      // Ctrl+Shift+E: capture the current selection as a vocabulary word
      event.preventDefault()
      win?.webContents.send('vocab-capture')
    }
  })
})

// --- window ---

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'You',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  win.on('closed', () => {
    win = null
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadURL('app://localhost/index.html')
  }
}

app.whenReady().then(async () => {
  await setVaultDir(await resolveVault())
  await initBlocker()
  study = normalizeStudy((await loadSettings()).study)
  if (!process.env['ELECTRON_RENDERER_URL']) {
    serveAppProtocol(join(__dirname, '../renderer'))
  }
  // Available in dev too: the renderer decodes the wallpaper from here.
  serveWallpaperProtocol(() => wallpaperInfo?.path ?? null)
  // Card images / voice notes live in the vault; serve them to the renderer.
  serveVaultProtocol(() => vaultDir)
  manualWallpaper = (await loadSettings()).wallpaperPath ?? ''

  ipcMain.handle('vault:dir', () => vaultDir)

  ipcMain.handle('vault:pick', async () => {
    if (!win) return null
    const r = await dialog.showOpenDialog(win, {
      title: 'Open vault folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (r.canceled || r.filePaths.length === 0) return null
    await setVaultDir(r.filePaths[0] as string)
    return vaultDir
  })

  ipcMain.handle('vault:list', async () => {
    async function walk(base: string, rel = ''): Promise<string[]> {
      let entries
      try {
        entries = await fs.readdir(join(base, rel), { withFileTypes: true })
      } catch {
        return []
      }
      const out: string[] = []
      for (const e of entries) {
        if (e.name.startsWith('.')) continue
        const r = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) out.push(...(await walk(base, r)))
        else out.push(r)
      }
      return out.sort()
    }
    return walk(vaultDir)
  })

  ipcMain.handle('vault:tree', async () => buildTree(vaultDir))

  ipcMain.handle('vault:mkdir', async (_e, relPath: string) => {
    await fs.mkdir(inside(relPath), { recursive: true })
    return true
  })

  ipcMain.handle('vault:rename', async (_e, oldRel: string, newRel: string) => {
    const from = inside(oldRel)
    const to = inside(newRel)
    const exists = await fs
      .stat(to)
      .then(() => true)
      .catch(() => false)
    if (exists) throw new Error('a file or folder with that name already exists')
    await fs.mkdir(join(to, '..'), { recursive: true })
    await fs.rename(from, to)
    return true
  })

  ipcMain.handle('vault:remove', async (_e, relPath: string) => {
    await fs.rm(inside(relPath), { recursive: true, force: true })
    return true
  })

  ipcMain.handle('vault:read', async (_e, relPath: string) => {
    const full = inside(relPath)
    const buf = await fs.readFile(full)
    if (relPath.endsWith('.pdf')) return { encoding: 'base64', data: buf.toString('base64') }
    return { encoding: 'utf-8', data: buf.toString('utf-8') }
  })

  ipcMain.handle('vault:write', async (_e, relPath: string, data: string) => {
    const full = inside(relPath)
    await fs.mkdir(join(full, '..'), { recursive: true })
    await fs.writeFile(full, data, 'utf-8')
    return true
  })

  ipcMain.handle('vault:writeBinary', async (_e, relPath: string, base64: string) => {
    const full = inside(relPath)
    await fs.mkdir(join(full, '..'), { recursive: true })
    await fs.writeFile(full, Buffer.from(base64, 'base64'))
    return true
  })

  ipcMain.handle('blocker:isEnabled', () => adsEnabled)
  ipcMain.handle('blocker:setEnabled', async (_e, on: boolean) => setAdsEnabled(on))

  // --- embedded terminal / neovim (node-pty lives in main) ---

  const findBin = (cmd: string): string | null => {
    const path = process.env.PATH ?? ''
    for (const dir of path.split(':')) {
      const full = join(dir, cmd)
      try {
        accessSync(full, fsConstants.X_OK)
        return full
      } catch {
        // not here — keep looking
      }
    }
    return null
  }

  ipcMain.handle(
    'term:create',
    async (_e, opts: { cols: number; rows: number; target?: string }): Promise<{ id: string } | { error: string }> => {
      if (!win || win.isDestroyed()) return { error: 'no window' }
      let cwd = vaultDir
      let file: string | null = null
      const rel = (opts.target ?? '').trim()
      if (rel) {
        let full: string
        try {
          full = inside(rel)
        } catch {
          return { error: `invalid path: ${rel}` }
        }
        try {
          const st = await fs.stat(full)
          if (st.isDirectory()) cwd = full
          else file = full
        } catch {
          return { error: `not found: ${rel}` }
        }
      }
      const nvimBin = findBin('nvim')
      if (file && !nvimBin) return { error: 'nvim not found in PATH — install Neovim or open a plain shell instead.' }
      try {
        const id = spawnTerm(win, {
          cols: opts.cols || 80,
          rows: opts.rows || 24,
          cwd,
          file,
          nvimBin,
          shellBin: process.env.SHELL || '/bin/bash'
        })
        return { id }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle('term:write', async (_e, v: { id: string; data: string }) => {
    writeTerm(v.id, v.data)
  })

  ipcMain.handle('term:resize', async (_e, v: { id: string; cols: number; rows: number }) => {
    resizeTerm(v.id, v.cols, v.rows)
  })

  ipcMain.handle('term:kill', async (_e, id: string) => {
    killTerm(id)
  })

  // Monospace families on this machine, for the terminal font picker.
  ipcMain.handle('fonts:list', () => listFonts())

  // Report our theme mode to Chromium so sites with native dark/light
  // support (prefers-color-scheme) follow it — including webview guests.
  ipcMain.handle('theme:setMode', (_e, m: string) => {
    nativeTheme.themeSource = m === 'light' ? 'light' : 'dark'
    return nativeTheme.themeSource
  })

  // --- English word feeder (system-sourced B1 vocabulary) ---

  ipcMain.handle('study:get', () => study)
  ipcMain.handle('study:set', async (_e, patch: Partial<StudySettings>) => {
    study = normalizeStudy({ ...study, ...patch })
    await saveSettings({ study })
    armStudy()
    return study
  })
  ipcMain.handle('study:next', () => fireStudy(true))

  // --- downloads: ask where, then notify on completion ---

  const ses = browserSession()
  ses.on('will-download', (_e, item) => {
    if (!win || win.isDestroyed()) {
      item.cancel()
      return
    }
    const fallback = join(app.getPath('downloads'), item.getFilename())
    void dialog
      .showSaveDialog(win, { title: 'Save file', defaultPath: fallback })
      .then((r) => {
        if (r.canceled || !r.filePath) item.cancel()
        else item.setSavePath(r.filePath)
      })
      .catch(() => item.cancel())
    item.once('done', (_ev, state) => {
      if (state === 'completed' && Notification.isSupported()) {
        new Notification({ title: 'Download finished', body: item.getFilename() }).show()
      }
    })
  })

  // --- wallpaper: source for the "Wallpaper" theme ---

  const wallpaperPayload = (info: WallpaperInfo | null): WallpaperPayload | null =>
    info ? { ...info, manual: manualWallpaper !== '', ...wallpaperStats } : null

  const pushWallpaper = (info: WallpaperInfo | null): void => {
    if (win && !win.isDestroyed()) win.webContents.send('wallpaper:changed', wallpaperPayload(info))
  }

  ipcMain.handle('wallpaper:get', async () => {
    if (!wallpaperInfo) wallpaperInfo = await detectWallpaper(manualWallpaper || null)
    return wallpaperPayload(wallpaperInfo)
  })

  ipcMain.handle('wallpaper:refresh', async () => {
    wallpaperInfo = await detectWallpaper(manualWallpaper || null)
    return wallpaperPayload(wallpaperInfo)
  })

  ipcMain.handle('wallpaper:pick', async () => {
    if (!win || win.isDestroyed()) return null
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose a wallpaper image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp', 'gif', 'svg'] }]
    })
    if (r.canceled || r.filePaths.length === 0) return null
    const picked = r.filePaths[0] as string
    // Only commit the override if the choice really resolves to an image —
    // otherwise detectWallpaper silently falls back and we'd persist a path the
    // user never sees used.
    const info = await detectWallpaper(picked)
    if (!info || info.via !== 'manual') return null
    manualWallpaper = picked
    await saveSettings({ wallpaperPath: manualWallpaper })
    wallpaperInfo = info
    pushWallpaper(info)
    return wallpaperPayload(info)
  })

  ipcMain.handle('wallpaper:clear', async () => {
    manualWallpaper = ''
    await saveSettings({ wallpaperPath: '' })
    wallpaperInfo = await detectWallpaper(null)
    pushWallpaper(wallpaperInfo)
    return wallpaperPayload(wallpaperInfo)
  })

  createWindow()
  startWatcher()
  // Follow the desktop wallpaper: instant on Plasma rewriting its config, plus a
  // straight re-read every few seconds so a missed filesystem event can never
  // leave the theme stuck on yesterday's colours.
  startWallpaperWatch(
    () => manualWallpaper || null,
    (info) => {
      wallpaperInfo = info
      pushWallpaper(info)
    },
    {
      stats: wallpaperStats,
      // Lands in the journal (and in the terminal under `npm run dev`).
      log: (message) => console.log(`[wallpaper] ${message}`)
    }
  )
  armStudy()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
