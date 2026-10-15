import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { typeForPath } from '../tabs'
import { baseName } from '../vault'

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

function dayKey(y: number, m: number, d: number): string {
  const mm = String(m + 1).padStart(2, '0')
  const dd = String(d).padStart(2, '0')
  return `${y}-${mm}-${dd}`
}

function todayKey(): string {
  const t = new Date()
  return dayKey(t.getFullYear(), t.getMonth(), t.getDate())
}

export function CalendarPanel(): JSX.Element {
  const tree = useStore((s) => s.tree)
  const openTab = useStore((s) => s.openTab)
  const refreshTree = useStore((s) => s.refreshTree)

  const now = new Date()
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [sel, setSel] = useState<string>(todayKey())

  // vault activity: files modified per calendar day
  const dayMap = useMemo(() => {
    const map = new Map<string, string[]>()
    const walk = (nodes: typeof tree): void => {
      for (const n of nodes) {
        if (n.isDir) walk(n.children ?? [])
        else if (n.mtimeMs) {
          const d = new Date(n.mtimeMs)
          const k = dayKey(d.getFullYear(), d.getMonth(), d.getDate())
          const arr = map.get(k) ?? []
          arr.push(n.path)
          map.set(k, arr)
        }
      }
    }
    walk(tree)
    for (const arr of map.values()) arr.sort()
    return map
  }, [tree])

  const firstDow = (new Date(ym.y, ym.m, 1).getDay() + 6) % 7 // Monday start
  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate()
  const isTodayMonth = now.getFullYear() === ym.y && now.getMonth() === ym.m
  const monthLabel = new Date(ym.y, ym.m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  const shift = (delta: number): void => {
    const d = new Date(ym.y, ym.m + delta, 1)
    setYm({ y: d.getFullYear(), m: d.getMonth() })
  }

  const selPaths = dayMap.get(sel) ?? []
  const selDate = (() => {
    const [y, m, d] = sel.split('-').map(Number)
    return new Date(y as number, (m as number) - 1, d as number).toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    })
  })()

  const newDailyNote = async (): Promise<void> => {
    const target = `journal/${sel}.md`
    try {
      await window.vault.read(target)
    } catch {
      const [y, m, d] = sel.split('-').map(Number)
      const pretty = new Date(y as number, (m as number) - 1, d as number).toLocaleDateString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
      await window.vault.write(target, `# ${pretty}\n\n`).catch(() => {})
      refreshTree()
    }
    openTab('markdown', target)
  }

  return (
    <div className="cal">
      <div className="cal-head">
        <button className="btn" onClick={() => shift(-1)} title="Previous month">
          ‹
        </button>
        <span className="cal-title">{monthLabel}</span>
        <button className="btn" onClick={() => shift(1)} title="Next month">
          ›
        </button>
      </div>
      <button
        className="btn"
        style={{ width: '100%', marginTop: 2 }}
        onClick={() => {
          setYm({ y: now.getFullYear(), m: now.getMonth() })
          setSel(todayKey())
        }}
      >
        Today
      </button>

      <div className="cal-grid">
        {DOW.map((d, i) => (
          <span key={i} className="cal-dow">
            {d}
          </span>
        ))}
        {Array.from({ length: firstDow }).map((_, i) => (
          <span key={`b${i}`} />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const d = i + 1
          const k = dayKey(ym.y, ym.m, d)
          const files = dayMap.get(k) ?? []
          const cls = 'cal-day' + (isTodayMonth && d === now.getDate() ? ' today' : '') + (sel === k ? ' sel' : '')
          return (
            <button key={d} className={cls} title={files.length > 0 ? `${files.length} file${files.length > 1 ? 's' : ''} touched` : undefined} onClick={() => setSel(k)}>
              {d}
              {files.length > 0 && (
                <span className="cal-dots">
                  {files.slice(0, 3).map((f) => (
                    <i key={f} />
                  ))}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="cal-files">
        <div className="side-head">{selDate.toUpperCase()}</div>
        {selPaths.length === 0 && <div className="side-empty">nothing touched this day</div>}
        {selPaths.map((p) => (
          <div key={p} className="cal-file" title={p} onClick={() => openTab(typeForPath(p), p)}>
            <span className={`dot t-${typeForPath(p)}`} />
            <span className="cal-name">{baseName(p)}</span>
          </div>
        ))}
        <button className="btn" style={{ width: '100%', marginTop: 6 }} onClick={() => void newDailyNote()}>
          + Daily note
        </button>
      </div>
    </div>
  )
}
