import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useStore } from '../store'
import { Tab } from '../tabs'

type TermStatus = 'starting' | 'live' | { exited: number } | { error: string }

function termTheme(mode: 'dark' | 'light'): Record<string, string> {
  let background = '#0c0c0e'
  let foreground = '#eeeeee'
  let accent = '#ffffff'
  try {
    const cs = getComputedStyle(document.documentElement)
    background = cs.getPropertyValue('--bg').trim() || background
    foreground = cs.getPropertyValue('--text').trim() || foreground
    accent = cs.getPropertyValue('--accent').trim() || accent
  } catch {
    // host styles unavailable — fallbacks above apply
  }
  const ansi =
    mode === 'dark'
      ? {
          black: '#1e1e1e',
          red: '#f14c4c',
          green: '#23d18b',
          yellow: '#e5e510',
          blue: '#3b8eea',
          magenta: '#bc3fbc',
          cyan: '#29b8db',
          white: '#e5e5e5',
          brightBlack: '#666666',
          brightRed: '#f14c4c',
          brightGreen: '#23d18b',
          brightYellow: '#f5f543',
          brightBlue: '#3b8eea',
          brightMagenta: '#d670d6',
          brightCyan: '#29b8db',
          brightWhite: '#e5e5e5'
        }
      : {
          black: '#000000',
          red: '#cd3131',
          green: '#00bc00',
          yellow: '#949800',
          blue: '#0451a5',
          magenta: '#bc05bc',
          cyan: '#0598bc',
          white: '#555555',
          brightBlack: '#666666',
          brightRed: '#cd3131',
          brightGreen: '#00bc00',
          brightYellow: '#949800',
          brightBlue: '#0451a5',
          brightMagenta: '#bc05bc',
          brightCyan: '#0598bc',
          brightWhite: '#a5a5a5'
        }
  return {
    background,
    foreground,
    cursor: accent,
    cursorAccent: background,
    selectionBackground: mode === 'dark' ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.18)',
    ...ansi
  }
}

/**
 * Embedded terminal tab. Target is a vault path: a file opens in the
 * user's own Neovim (config, plugins, LSP — all of it), a folder (or
 * empty target) drops to a plain shell rooted there.
 */
export function TerminalTab({ tab }: { tab: Tab }): JSX.Element {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const ptyRef = useRef<string | null>(null)
  const mode = useStore((s) => s.mode)
  const termFontSize = useStore((s) => s.termFontSize)
  const closeTab = useStore((s) => s.closeTab)
  const [status, setStatus] = useState<TermStatus>('starting')

  const spawn = async (): Promise<void> => {
    const term = termRef.current
    const fit = fitRef.current
    if (!term || !fit) return
    setStatus('starting')
    try {
      fit.fit()
    } catch {
      // hidden tab (display:none) — fallback dims, ResizeObserver corrects on show
    }
    const dims = (() => {
      try {
        return fit.proposeDimensions()
      } catch {
        return undefined
      }
    })()
    const res = await window.terminal.create({
      cols: dims?.cols ?? 80,
      rows: dims?.rows ?? 24,
      target: tab.target || undefined
    })
    if ('error' in res && res.error) {
      setStatus({ error: res.error })
      return
    }
    if (!res.id) {
      setStatus({ error: 'terminal failed to start' })
      return
    }
    ptyRef.current = res.id
    setStatus('live')
  }

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const term = new Terminal({
      theme: termTheme(useStore.getState().mode),
      fontSize: useStore.getState().termFontSize,
      fontFamily: "'SymbolsNerdFontMono', ui-monospace, SFMono-Regular, Menlo, monospace",
      cursorBlink: true
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(box)
    // Ctrl/Cmd + =/-/0 zooms the terminal instead of reaching the shell.
    // preventDefault + stopPropagation are what actually stop Chromium's
    // own page-zoom accelerator — returning false alone only stops xterm.
    term.attachCustomKeyEventHandler((e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return true
      const st = useStore.getState()
      const zoomBy = (delta: number): boolean => {
        e.preventDefault()
        e.stopPropagation()
        st.setTermFontSize(st.termFontSize + delta)
        return false
      }
      if (e.key === '=' || e.key === '+') return zoomBy(1)
      if (e.key === '-' || e.key === '_') return zoomBy(-1)
      if (e.key === '0' && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        st.setTermFontSize(14)
        return false
      }
      return true
    })
    termRef.current = term
    fitRef.current = fit

    let alive = true
    const offOut = window.terminal.onOutput((id, data) => {
      if (alive && id === ptyRef.current) term.write(data)
    })
    const offExit = window.terminal.onExit((id, exitCode) => {
      if (alive && id === ptyRef.current) {
        ptyRef.current = null
        setStatus({ exited: exitCode })
      }
    })
    const offData = term.onData((d) => {
      const id = ptyRef.current
      if (id) void window.terminal.write(id, d)
    })
    void spawn()
    const ro = new ResizeObserver(() => {
      const id = ptyRef.current
      if (!id) return
      try {
        fit.fit()
        const dims = fit.proposeDimensions()
        if (dims) void window.terminal.resize(id, dims.cols, dims.rows)
      } catch {
        // box hidden mid-transition — next resize covers it
      }
    })
    ro.observe(box)
    term.focus()

    return () => {
      alive = false
      offOut()
      offExit()
      offData.dispose()
      ro.disconnect()
      const id = ptyRef.current
      ptyRef.current = null
      if (id) void window.terminal.kill(id)
      term.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id])

  // repaint on palette/mode switch
  useEffect(() => {
    const term = termRef.current
    if (term) {
      ;(term as unknown as { options: { theme: unknown } }).options.theme = termTheme(mode)
    }
  }, [mode])

  // zoom: apply font size, refit, tell the pty the new grid
  useEffect(() => {
    const term = termRef.current
    const fit = fitRef.current
    const id = ptyRef.current
    if (!term || !fit) return
    ;(term as unknown as { options: { fontSize: number } }).options.fontSize = termFontSize
    try {
      fit.fit()
      const dims = fit.proposeDimensions()
      if (id && dims) void window.terminal.resize(id, dims.cols, dims.rows)
    } catch {
      // hidden tab — ResizeObserver corrects on show
    }
  }, [termFontSize])

  return (
    <div
      ref={boxRef}
      onClick={() => termRef.current?.focus()}
      style={{ position: 'relative', flex: 1, minHeight: 0, background: 'var(--bg)', padding: 8, overflow: 'hidden' }}
    >
      {status !== 'live' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            background: 'var(--bg)',
            color: 'var(--text-dim)',
            fontSize: 13,
            zIndex: 2
          }}
        >
          {status === 'starting' && <span>starting terminal…</span>}
          {typeof status === 'object' && 'exited' in status && (
            <>
              <span>process exited (code {status.exited})</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => void spawn()}>
                  Restart
                </button>
                <button className="btn" onClick={() => closeTab(tab.id)}>
                  Close tab
                </button>
              </div>
            </>
          )}
          {typeof status === 'object' && 'error' in status && (
            <>
              <span style={{ maxWidth: 420, textAlign: 'center', lineHeight: 1.5 }}>{status.error}</span>
              <button className="btn" onClick={() => closeTab(tab.id)}>
                Close tab
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
