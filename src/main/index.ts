import { app, BrowserWindow, dialog, ipcMain, nativeTheme, session, shell } from 'electron'
import { join, relative, resolve, sep } from 'path'
import { promises as fs } from 'fs'
import { watch, type FSWatcher } from 'chokidar'
import { ElectronBlocker } from '@ghostery/adblocker-electron'
import { NetworkFilter } from '@ghostery/adblocker'

let win: BrowserWindow | null = null
let watcher: FSWatcher | null = null
let vaultDir = ''
let notifyTimer: NodeJS.Timeout | null = null
let blocker: ElectronBlocker | null = null
let adsEnabled = true

// --- settings (persist chosen vault across restarts) ---

interface Settings {
  vaultPath?: string
  adsEnabled?: boolean
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

// --- app-wide shortcuts that must fire even when a webview page has focus ---
// (Renderer keydown never sees keys typed inside a guest page, so the main
// process intercepts them pre-dispatch for both host and guest contents.)

function isPlainCtrl(input: Electron.Input): boolean {
  return input.type === 'keyDown' && !input.alt && !input.shift && (input.control || input.meta)
}

app.on('web-contents-created', (_e, contents) => {
  contents.on('before-input-event', (event, input) => {
    if (!isPlainCtrl(input)) return
    const key = input.key.toLowerCase()
    // Ctrl+T is browser-reserved: hijack everywhere, including video pages.
    if (key === 't') {
      event.preventDefault()
      win?.webContents.send('quick-open')
    } else if (key === 'b' && contents.getType() !== 'webview') {
      // Ctrl+B only outside pages — never steal bold from Google Docs etc.
      event.preventDefault()
      win?.webContents.send('toggle-sidebar')
    }
  })
})

// --- window ---

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
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
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  await setVaultDir(await resolveVault())
  await initBlocker()

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
    await fs.writeFile(full, Buffer.from(base64, 'base64'))
    return true
  })

  ipcMain.handle('blocker:isEnabled', () => adsEnabled)
  ipcMain.handle('blocker:setEnabled', async (_e, on: boolean) => setAdsEnabled(on))

  // Report our theme mode to Chromium so sites with native dark/light
  // support (prefers-color-scheme) follow it — including webview guests.
  ipcMain.handle('theme:setMode', (_e, m: string) => {
    nativeTheme.themeSource = m === 'light' ? 'light' : 'dark'
    return nativeTheme.themeSource
  })

  createWindow()
  startWatcher()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
