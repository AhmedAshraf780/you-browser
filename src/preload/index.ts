import { contextBridge, ipcRenderer } from 'electron'
import type { TreeNode } from '../renderer/vault'

export interface VaultReadResult {
  encoding: 'utf-8' | 'base64'
  data: string
}

const vault = {
  dir: (): Promise<string> => ipcRenderer.invoke('vault:dir'),
  /** Open a native folder picker, set it as the vault. Returns path or null if cancelled. */
  pick: (): Promise<string | null> => ipcRenderer.invoke('vault:pick'),
  list: (): Promise<string[]> => ipcRenderer.invoke('vault:list'),
  tree: (): Promise<TreeNode[]> => ipcRenderer.invoke('vault:tree'),
  mkdir: (relPath: string): Promise<boolean> => ipcRenderer.invoke('vault:mkdir', relPath),
  rename: (oldRel: string, newRel: string): Promise<boolean> =>
    ipcRenderer.invoke('vault:rename', oldRel, newRel),
  remove: (relPath: string): Promise<boolean> => ipcRenderer.invoke('vault:remove', relPath),
  read: (relPath: string): Promise<VaultReadResult> => ipcRenderer.invoke('vault:read', relPath),
  write: (relPath: string, data: string): Promise<boolean> =>
    ipcRenderer.invoke('vault:write', relPath, data),
  writeBinary: (relPath: string, base64: string): Promise<boolean> =>
    ipcRenderer.invoke('vault:writeBinary', relPath, base64),
  /** Fires when vault files change (own saves or external editors). Returns unsubscribe. */
  onChanged: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('vault:changed', handler)
    return () => ipcRenderer.removeListener('vault:changed', handler)
  }
}

contextBridge.exposeInMainWorld('vault', vault)

const blockerApi = {
  isEnabled: (): Promise<boolean> => ipcRenderer.invoke('blocker:isEnabled'),
  setEnabled: (on: boolean): Promise<boolean> => ipcRenderer.invoke('blocker:setEnabled', on)
}

contextBridge.exposeInMainWorld('blocker', blockerApi)

const shortcuts = {
  onQuickOpen: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('quick-open', handler)
    return () => ipcRenderer.removeListener('quick-open', handler)
  },
  onToggleSidebar: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('toggle-sidebar', handler)
    return () => ipcRenderer.removeListener('toggle-sidebar', handler)
  },
  onCycleTab: (cb: (dir: number) => void): (() => void) => {
    const handler = (_e: unknown, dir: number): void => cb(dir)
    ipcRenderer.on('cycle-tab', handler)
    return () => ipcRenderer.removeListener('cycle-tab', handler)
  },
  onGotoTab: (cb: (index: number) => void): (() => void) => {
    const handler = (_e: unknown, index: number): void => cb(index)
    ipcRenderer.on('goto-tab', handler)
    return () => ipcRenderer.removeListener('goto-tab', handler)
  },
  onNavKey: (cb: (id: string) => void): (() => void) => {
    const handler = (_e: unknown, id: string): void => cb(id)
    ipcRenderer.on('nav-key', handler)
    return () => ipcRenderer.removeListener('nav-key', handler)
  },
  onFindOpen: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('find-open', handler)
    return () => ipcRenderer.removeListener('find-open', handler)
  },
  onOpenTerminal: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('open-terminal', handler)
    return () => ipcRenderer.removeListener('open-terminal', handler)
  },
  onVocabCapture: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('vocab-capture', handler)
    return () => ipcRenderer.removeListener('vocab-capture', handler)
  }
}

contextBridge.exposeInMainWorld('shortcuts', shortcuts)

const themeApi = {
  setMode: (mode: string): Promise<string> => ipcRenderer.invoke('theme:setMode', mode)
}

contextBridge.exposeInMainWorld('theme', themeApi)

export interface StudyWord {
  id: string
  word: string
  ipa: string
  pos: string
  meaning: string
  example: string
  cat: string
  kind?: 'word' | 'verb' | 'phrasal'
}

export interface StudyConfig {
  enabled: boolean
  intervalMin: number
  level: string
  interests: string[]
  autoAdd: boolean
}

const studyApi = {
  get: (): Promise<StudyConfig> => ipcRenderer.invoke('study:get'),
  set: (patch: Partial<StudyConfig>): Promise<StudyConfig> => ipcRenderer.invoke('study:set', patch),
  /** ask the system for one word right now; null when offline with no cache */
  next: (): Promise<StudyWord | null> => ipcRenderer.invoke('study:next'),
  onWord: (cb: (w: StudyWord) => void): (() => void) => {
    const handler = (_e: unknown, w: StudyWord): void => cb(w)
    ipcRenderer.on('study:word', handler)
    return () => ipcRenderer.removeListener('study:word', handler)
  }
}

contextBridge.exposeInMainWorld('study', studyApi)

/** The desktop wallpaper the "Wallpaper" theme derives its colours from. */
export interface WallpaperInfo {
  path: string
  name: string
  via: string
  token: string
  manual: boolean
  /** how many times main has seen the wallpaper change this session */
  changes: number
  /** when main last re-checked (ms since epoch) */
  checkedAt: number
}

const wallpaperApi = {
  get: (): Promise<WallpaperInfo | null> => ipcRenderer.invoke('wallpaper:get'),
  /** Re-scan the desktop now (and re-derive the theme). */
  refresh: (): Promise<WallpaperInfo | null> => ipcRenderer.invoke('wallpaper:refresh'),
  /** Pick an image to derive the theme from instead of the desktop wallpaper. */
  pick: (): Promise<WallpaperInfo | null> => ipcRenderer.invoke('wallpaper:pick'),
  /** Forget the picked image and follow the desktop wallpaper again. */
  clear: (): Promise<WallpaperInfo | null> => ipcRenderer.invoke('wallpaper:clear'),
  /** Fires whenever the wallpaper changes (slideshow advance, new background). */
  onChanged: (cb: (info: WallpaperInfo | null) => void): (() => void) => {
    const handler = (_e: unknown, info: WallpaperInfo | null): void => cb(info)
    ipcRenderer.on('wallpaper:changed', handler)
    return () => ipcRenderer.removeListener('wallpaper:changed', handler)
  }
}

contextBridge.exposeInMainWorld('wallpaper', wallpaperApi)

export interface TermCreateResult {
  id?: string
  error?: string
}

const terminal = {
  create: (opts: { cols: number; rows: number; target?: string }): Promise<TermCreateResult> =>
    ipcRenderer.invoke('term:create', opts),
  write: (id: string, data: string): Promise<void> => ipcRenderer.invoke('term:write', { id, data }),
  resize: (id: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke('term:resize', { id, cols, rows }),
  kill: (id: string): Promise<void> => ipcRenderer.invoke('term:kill', id),
  onOutput: (cb: (id: string, data: string) => void): (() => void) => {
    const handler = (_e: unknown, v: { id: string; data: string }): void => cb(v.id, v.data)
    ipcRenderer.on('term:output', handler)
    return () => ipcRenderer.removeListener('term:output', handler)
  },
  onExit: (cb: (id: string, exitCode: number) => void): (() => void) => {
    const handler = (_e: unknown, v: { id: string; exitCode: number }): void => cb(v.id, v.exitCode)
    ipcRenderer.on('term:exit', handler)
    return () => ipcRenderer.removeListener('term:exit', handler)
  }
}

contextBridge.exposeInMainWorld('terminal', terminal)

declare global {
  interface Window {
    vault: typeof vault
    blocker: typeof blockerApi
    shortcuts: typeof shortcuts
    theme: typeof themeApi
    terminal: typeof terminal
    study: typeof studyApi
    wallpaper: typeof wallpaperApi
  }
}
