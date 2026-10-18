import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { typeForPath } from '../tabs'
import { baseName } from '../vault'
import type { TreeNode } from '../vault'

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function dayKey(y: number, m: number, d: number): string {
  const mm = String(m + 1).padStart(2, '0')
  const dd = String(d).padStart(2, '0')
  return `${y}-${mm}-${dd}`
}

function todayKey(): string {
  const t = new Date()
  return dayKey(t.getFullYear(), t.getMonth(), t.getDate())
}

function prettyDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y as number, (m as number) - 1, d as number).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  })
}

/** Full-page calendar. Every day is a writable cell (day notes, persisted
 *  locally); vault activity still shows as dots; selected day lists the
 *  files touched that day plus a one-click daily note. */
export function CalendarTab(): JSX.Element {
  const tree = useStore((s) => s.tree)
  const dayNotes = useStore((s) => s.dayNotes)
  const setDayNote = useStore((s) => s.setDayNote)
  const openTab = useStore((s) => s.openTab)
  const refreshTree = useStore((s) => s.refreshTree)

  const now = new Date()
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [sel, setSel] = useState<string>(todayKey())
  const [editing, setEditing] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  // vault activity: files modified per calendar day
  const dayMap = useMemo(() => {
    const map = new Map<string, string[]>()
    const walk = (nodes: TreeNode[]): void => {
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
  const trailing = (7 - ((firstDow + daysInMonth) % 7)) % 7
  const isTodayMonth = now.getFullYear() === ym.y && now.getMonth() === ym.m
  const monthLabel = new Date(ym.y, ym.m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  const shift = (delta: number): void => {
    const d = new Date(ym.y, ym.m + delta, 1)
    setYm({ y: d.getFullYear(), m: d.getMonth() })
  }

  const selPaths = dayMap.get(sel) ?? []

  const startEdit = (key: string): void => {
    setEditing(key)
    setEditText(dayNotes[key] ?? '')
  }

  const commitEdit = (): void => {
    if (editing) setDayNote(editing, editText)
    setEditing(null)
  }

  const cancelEdit = (): void => {
    setEditing(null)
  }

  const cellClick = (key: string): void => {
    setSel(key)
    if (sel !== key) return
    if (!editing) startEdit(key)
  }

  const newDailyNote = async (): Promise<void> => {
    const target = `journal/${sel}.md`
    try {
      await window.vault.read(target)
    } catch {
      const pretty = new Date(
        Number(sel.slice(0, 4)),
        Number(sel.slice(5, 7)) - 1,
        Number(sel.slice(8, 10))
      ).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
      await window.vault.write(target, `# ${pretty}\n\n`).catch(() => {})
      refreshTree()
    }
    openTab('markdown', target)
  }

  return (
    <div className="calp">
      <div className="calp-head">
        <button className="btn" onClick={() => shift(-1)} title="Previous month">
          ‹
        </button>
        <span className="calp-title">{monthLabel}</span>
        <button
          className="btn"
          onClick={() => {
            setYm({ y: now.getFullYear(), m: now.getMonth() })
            setSel(todayKey())
          }}
        >
          Today
        </button>
        <button className="btn" onClick={() => shift(1)} title="Next month">
          ›
        </button>
      </div>

      <div className="calp-grid">
        {DOW.map((d) => (
          <span key={d} className="calp-dow">
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
          const note = dayNotes[k] ?? ''
          const isToday = isTodayMonth && d === now.getDate()
          const cls = 'calp-cell' + (isToday ? ' today' : '') + (sel === k ? ' sel' : '')
          return (
            <div key={d} className={cls} title={files.length > 0 ? `${files.length} file${files.length > 1 ? 's' : ''} touched` : prettyDay(k)} onClick={() => cellClick(k)}>
              <div className="calp-dayrow">
                <span className="calp-daynum">{d}</span>
                {files.length > 0 && (
                  <span className="cal-dots">
                    {files.slice(0, 3).map((f) => (
                      <i key={f} />
                    ))}
                  </span>
                )}
              </div>
              {editing === k ? (
                <textarea
                  className="calp-edit"
                  autoFocus
                  value={editText}
                  placeholder="Type a note for this day…"
                  onChange={(e) => setEditText(e.target.value)}
                  onBlur={commitEdit}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Escape') cancelEdit()
                  }}
                />
              ) : (
                note && <div className="calp-note">{note}</div>
              )}
            </div>
          )
        })}
        {Array.from({ length: trailing }).map((_, i) => (
          <span key={`t${i}`} />
        ))}
      </div>

      <div className="calp-foot">
        <div className="side-head">{prettyDay(sel).toUpperCase()}</div>
        {selPaths.length === 0 && dayNotes[sel] == null && (
          <div className="side-empty">nothing here yet — click a day twice to write in it</div>
        )}
        {selPaths.map((p) => (
          <div key={p} className="cal-file" title={p} onClick={() => openTab(typeForPath(p), p)}>
            <span className={`dot t-${typeForPath(p)}`} />
            <span className="cal-name">{baseName(p)}</span>
          </div>
        ))}
        <button className="btn" style={{ marginTop: 6 }} onClick={() => void newDailyNote()}>
          + Daily note
        </button>
      </div>
    </div>
  )
}
