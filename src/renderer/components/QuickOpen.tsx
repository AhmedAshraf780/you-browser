import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { normalizeInput, typeForPath } from '../tabs'
import { baseName, flattenTree } from '../vault'

interface Item {
  key: string
  label: string
  hint: string
  run: () => void
}

function isURLLike(q: string): boolean {
  return /^https?:\/\//.test(q) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(q)
}

export function QuickOpen({ onClose }: { onClose: () => void }): JSX.Element {
  const tabs = useStore((s) => s.tabs)
  const tree = useStore((s) => s.tree)
  const openTab = useStore((s) => s.openTab)
  const setActive = useStore((s) => s.setActive)
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)

  const items = useMemo<Item[]>(() => {
    const query = q.trim()
    const ql = query.toLowerCase()
    const out: Item[] = []
    if (!ql) {
      for (const t of tabs.slice(0, 8)) {
        const id = t.id
        out.push({ key: `tab:${id}`, label: t.title, hint: t.target, run: () => setActive(id) })
      }
      return out
    }
    for (const t of tabs) {
      if (t.title.toLowerCase().includes(ql) || t.target.toLowerCase().includes(ql)) {
        const id = t.id
        out.push({ key: `tab:${id}`, label: t.title, hint: 'switch to tab', run: () => setActive(id) })
        if (out.length >= 4) break
      }
    }
    for (const f of flattenTree(tree).filter((f) => f.toLowerCase().includes(ql)).slice(0, 6)) {
      out.push({ key: `file:${f}`, label: baseName(f), hint: f, run: () => openTab(typeForPath(f), f) })
    }
    const { type, target } = normalizeInput(query)
    if (type === 'web') {
      const urlMode = isURLLike(query)
      out.push({
        key: `web:${target}`,
        label: urlMode ? target : `Search Google for "${query}"`,
        hint: urlMode ? 'open page' : 'web search',
        run: () => openTab('web', target)
      })
    } else {
      out.push({
        key: `vault:${target}`,
        label: baseName(target),
        hint: 'open vault file',
        run: () => openTab(type, target)
      })
    }
    return out
  }, [q, tabs, tree, openTab, setActive])

  useEffect(() => {
    setIdx(0)
  }, [q])

  const sel = items.length === 0 ? -1 : Math.min(Math.max(0, idx), items.length - 1)
  const runSel = (): void => {
    const it = sel >= 0 ? items[sel] : undefined
    if (!it) return
    it.run()
    onClose()
  }

  return (
    <>
      <div className="qo-overlay" onClick={onClose} />
      <div className="qo-pop">
        <input
          className="qo-input"
          autoFocus
          value={q}
          placeholder="Search tabs, vault files, or type a URL…"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIdx((i) => (items.length === 0 ? 0 : (i + 1) % items.length))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIdx((i) => (items.length === 0 ? 0 : (i - 1 + items.length) % items.length))
            } else if (e.key === 'Enter') {
              runSel()
            } else if (e.key === 'Escape') {
              onClose()
            }
          }}
        />
        <div className="qo-list">
          {items.map((it, i) => (
            <div
              key={it.key}
              className={`qo-item${i === sel ? ' sel' : ''}`}
              onClick={() => {
                it.run()
                onClose()
              }}
              onMouseMove={() => setIdx(i)}
            >
              <span className="qo-label">{it.label}</span>
              <span className="qo-hint">{it.hint}</span>
            </div>
          ))}
          {items.length === 0 && <div className="qo-empty">No matches — try a URL or different words.</div>}
        </div>
      </div>
    </>
  )
}
