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
  }
}

contextBridge.exposeInMainWorld('shortcuts', shortcuts)

const themeApi = {
  setMode: (mode: string): Promise<string> => ipcRenderer.invoke('theme:setMode', mode)
}

contextBridge.exposeInMainWorld('theme', themeApi)

declare global {
  interface Window {
    vault: typeof vault
    blocker: typeof blockerApi
    shortcuts: typeof shortcuts
    theme: typeof themeApi
  }
}
