import type { BrowserWindow } from 'electron'
import * as pty from '@lydell/node-pty'

interface PtySession {
  proc: pty.IPty
}

const sessions = new Map<string, PtySession>()
let counter = 0

export interface SpawnOpts {
  cols: number
  rows: number
  cwd: string
  /** absolute file path → open in nvim; null → plain shell */
  file: string | null
  nvimBin: string | null
  shellBin: string
}

export function spawnTerm(win: BrowserWindow, opts: SpawnOpts): string {
  const id = `term-${Date.now().toString(36)}-${counter++}`
  const cmd = opts.file ? (opts.nvimBin as string) : opts.shellBin
  const args = opts.file ? [opts.file as string] : []
  const proc = pty.spawn(cmd, args, {
    name: 'xterm-256color',
    cols: Math.max(2, Math.floor(opts.cols)) || 80,
    rows: Math.max(2, Math.floor(opts.rows)) || 24,
    cwd: opts.cwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor'
    } as Record<string, string>
  })
  proc.onData((data) => {
    if (!win.isDestroyed()) win.webContents.send('term:output', { id, data })
  })
  proc.onExit(({ exitCode }) => {
    sessions.delete(id)
    if (!win.isDestroyed()) win.webContents.send('term:exit', { id, exitCode })
  })
  sessions.set(id, { proc })
  return id
}

export function writeTerm(id: string, data: string): void {
  try {
    sessions.get(id)?.proc.write(data)
  } catch {
    // session gone — renderer will learn via term:exit
  }
}

export function resizeTerm(id: string, cols: number, rows: number): void {
  try {
    sessions.get(id)?.proc.resize(Math.max(2, Math.floor(cols)), Math.max(2, Math.floor(rows)))
  } catch {
    // ignore resizes for dead sessions
  }
}

export function killTerm(id: string): void {
  const s = sessions.get(id)
  if (!s) return
  sessions.delete(id)
  try {
    s.proc.kill()
  } catch {
    // already dead
  }
}
