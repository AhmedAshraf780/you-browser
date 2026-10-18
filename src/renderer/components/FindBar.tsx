import { useEffect, useRef, useState } from 'react'
import { getWebview } from '../webviews'

interface FoundResult {
  activeMatchOrdinal: number
  matches: number
}

/** Floating find bar for the active web tab (Ctrl+F). */
export function FindBar({ tabId, onClose }: { tabId: string; onClose: () => void }): JSX.Element {
  const [q, setQ] = useState('')
  const [count, setCount] = useState<{ active: number; total: number } | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
    const el = getWebview(tabId)
    if (!el) return
    const onFound = (e: unknown): void => {
      const r = e as { result?: FoundResult }
      if (r.result) setCount({ active: r.result.activeMatchOrdinal, total: r.result.matches })
    }
    el.addEventListener('found-in-page', onFound)
    return () => {
      el.removeEventListener('found-in-page', onFound)
      try {
        el.stopFindInPage('clearSelection')
      } catch {
        // webview gone — nothing to clear
      }
    }
  }, [tabId])

  const search = (forward: boolean): void => {
    const el = getWebview(tabId)
    if (!el || !q) return
    try {
      el.findInPage(q, { forward })
    } catch {
      // webview gone mid-search
    }
  }

  useEffect(() => {
    if (!q) {
      const el = getWebview(tabId)
      try {
        el?.stopFindInPage('clearSelection')
      } catch {
        // ignore
      }
      setCount(null)
      return
    }
    const t = setTimeout(() => search(true), 150)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, tabId])

  return (
    <div className="findbar">
      <input
        ref={inputRef}
        value={q}
        placeholder="Find in page…"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') search(!e.shiftKey)
          else if (e.key === 'Escape') onClose()
          else if (e.key === 'ArrowDown') search(true)
          else if (e.key === 'ArrowUp') search(false)
        }}
      />
      {count && (
        <span className="find-count">
          {count.total === 0 ? 'no matches' : `${count.active}/${count.total}`}
        </span>
      )}
      <button className="btn" title="Previous (Shift+Enter)" onClick={() => search(false)}>
        ↑
      </button>
      <button className="btn" title="Next (Enter)" onClick={() => search(true)}>
        ↓
      </button>
      <button className="btn" title="Close (Esc)" onClick={onClose}>
        ×
      </button>
    </div>
  )
}
