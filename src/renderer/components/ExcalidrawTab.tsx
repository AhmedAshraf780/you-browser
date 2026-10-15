import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { Tab } from '../tabs'

// Lazy-load Excalidraw so a missing/slow install doesn't break the shell.
export function ExcalidrawTab({ tab }: { tab: Tab }): JSX.Element {
  const mode = useStore((s) => s.mode)
  const [Comp, setComp] = useState<React.ComponentType<{
    initialData: unknown
    scrollToContent?: boolean
    theme?: 'light' | 'dark'
    onChange(e: unknown[], s: unknown): void
  }> | null>(null)
  const [initialData, setInitialData] = useState<unknown>(null)
  const [status, setStatus] = useState('loading…')
  const pending = useRef<{ elements: unknown[] } | null>(null)

  useEffect(() => {
    let alive = true
    // Excalidraw ships its styles separately — without this the canvas
    // renders unstyled with a broken (zero-height) layout.
    Promise.all([import('@excalidraw/excalidraw'), import('@excalidraw/excalidraw/index.css')])
      .then(([m]) => {
        if (alive) setComp(() => m.Excalidraw as unknown as typeof Comp)
      })
      .catch(() => alive && setStatus('excalidraw install failed: run npm install'))
    window.vault
      .read(tab.target)
      .then((r) => {
        if (!alive) return
        try {
          const parsed = JSON.parse(r.data)
          setInitialData({ elements: parsed.elements ?? parsed ?? [], appState: {}, scrollToContent: true })
        } catch {
          setInitialData({ elements: [], appState: {}, scrollToContent: true })
        }
        setStatus('loaded')
      })
      .catch(() => {
        if (alive) {
          setInitialData({ elements: [], appState: {}, scrollToContent: true })
          setStatus('new drawing — autosaves')
        }
      })
    return () => {
      alive = false
    }
  }, [tab.target])

  useEffect(() => {
    const t = setInterval(() => {
      if (pending.current) {
        window.vault.write(tab.target, JSON.stringify(pending.current, null, 2)).then(() => {
          setStatus(`saved ${new Date().toLocaleTimeString()}`)
        })
        pending.current = null
      }
    }, 1000)
    return () => clearInterval(t)
  }, [tab.target])

  if (!Comp || !initialData) {
    return <div style={{ padding: 20, color: 'var(--text-dim)' }}>{status} — {tab.target}</div>
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', padding: '6px 10px', background: 'var(--bg-soft)' }}>
        {tab.target} · {status}
      </div>
      {/* Excalidraw needs a sized box: flex:1 alone collapses without minHeight:0 + relative */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <Comp
          initialData={initialData}
          scrollToContent={true}
          theme={mode}
          onChange={(elements) => {
            pending.current = { elements }
          }}
        />
      </div>
    </div>
  )
}
