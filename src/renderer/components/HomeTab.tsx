import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { typeForPath } from '../tabs'
import { baseName, recentVaultFiles } from '../vault'

/* ═══════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════ */

const POMO_PRESETS = [
  { label: 'Focus',  work: 25, rest: 5  },
  { label: 'Deep',   work: 50, rest: 10 },
  { label: 'Quick',  work: 15, rest: 3  },
]

function greeting(h: number): string {
  if (h < 5)  return 'Good night'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  const m = s / 60
  if (m < 60) return `${Math.floor(m)}m ago`
  const h = m / 60
  if (h < 24) return `${Math.floor(h)}h ago`
  const d = h / 24
  if (d < 30)  return `${Math.floor(d)}d ago`
  return new Date(ms).toLocaleDateString()
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

function fmtSecs(s: number): string {
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function loadJ<T>(k: string, fb: T): T {
  try { const r = localStorage.getItem(k); return r ? (JSON.parse(r) as T) : fb } catch { return fb }
}
function saveJ(k: string, v: unknown): void {
  try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* ignore */ }
}

/* ═══════════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════════ */

interface Habit { id: string; label: string; color: string }
interface FocusSession { id: string; label: string; mins: number; at: number }
interface Bookmark { id: string; label: string; url: string; icon: string }

const HABIT_COLORS = ['#7aa2f7','#c4a7e7','#7bd88f','#ff6b6b','#fabd2f','#4da3ff','#c792ea','#f7768e']

/* ═══════════════════════════════════════════════════════════════════
   SUB-COMPONENTS
   ═══════════════════════════════════════════════════════════════════ */

function SiteIcon({ host }: { host: string }): JSX.Element {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [host])
  if (failed || !host) return <span className="site-av">{(host || '?').slice(0, 1).toUpperCase()}</span>
  return <img className="site-img" src={`https://${host}/favicon.ico`} alt="" draggable={false} onError={() => setFailed(true)} />
}

/* ─── Pomodoro Timer ─────────────────────────────────────────────── */
function PomodoroTimer({ onSessionDone }: { onSessionDone: (mins: number) => void }): JSX.Element {
  const [preset,    setPreset]    = useState(0)
  const [phase,     setPhase]     = useState<'work' | 'rest'>('work')
  const [running,   setRunning]   = useState(false)
  const [seconds,   setSeconds]   = useState(POMO_PRESETS[0].work * 60)
  const [completed, setCompleted] = useState(() => loadJ<number>('ub.pomo.done', 0))
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const preset_  = POMO_PRESETS[preset]
  const totalSec = phase === 'work' ? preset_.work * 60 : preset_.rest * 60
  const progress = 1 - seconds / totalSec

  // ring math
  const R = 54
  const CIRC = 2 * Math.PI * R
  const dash = CIRC * (1 - progress)

  useEffect(() => {
    if (!running) { if (intervalRef.current) clearInterval(intervalRef.current); return }
    intervalRef.current = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          clearInterval(intervalRef.current!)
          if (phase === 'work') {
            const done = completed + 1
            setCompleted(done)
            saveJ('ub.pomo.done', done)
            onSessionDone(preset_.work)
          }
          setPhase((p) => (p === 'work' ? 'rest' : 'work'))
          setRunning(false)
          setSeconds(phase === 'work' ? preset_.rest * 60 : preset_.work * 60)
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [running, phase, preset_, completed, onSessionDone])

  const reset = (): void => {
    setRunning(false)
    setPhase('work')
    setSeconds(preset_.work * 60)
  }

  const switchPreset = (i: number): void => {
    setPreset(i)
    setRunning(false)
    setPhase('work')
    setSeconds(POMO_PRESETS[i].work * 60)
  }

  return (
    <div className="pomo-wrap">
      {/* preset tabs */}
      <div className="pomo-tabs">
        {POMO_PRESETS.map((p, i) => (
          <button
            key={p.label}
            className={`pomo-tab${preset === i ? ' active' : ''}`}
            onClick={() => switchPreset(i)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* ring */}
      <div className="pomo-ring-wrap">
        <svg viewBox="0 0 128 128" className="pomo-ring">
          <circle cx="64" cy="64" r={R} fill="none" strokeWidth="6" stroke="var(--bg-raise)" />
          <circle
            cx="64" cy="64" r={R}
            fill="none"
            strokeWidth="6"
            stroke={phase === 'work' ? 'var(--accent)' : '#7bd88f'}
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={dash}
            transform="rotate(-90 64 64)"
            style={{ transition: running ? 'stroke-dashoffset 0.9s linear' : 'none' }}
          />
        </svg>
        <div className="pomo-center">
          <div className="pomo-time">{fmtSecs(seconds)}</div>
          <div className="pomo-phase">{phase === 'work' ? '🧠 Focus' : '☕ Rest'}</div>
        </div>
      </div>

      {/* controls */}
      <div className="pomo-controls">
        <button className="pomo-btn pomo-reset" onClick={reset} title="Reset">↺</button>
        <button
          className={`pomo-btn pomo-start${running ? ' running' : ''}`}
          onClick={() => setRunning((r) => !r)}
        >
          {running ? '⏸ Pause' : '▶ Start'}
        </button>
      </div>

      {/* tomato count */}
      <div className="pomo-tomatoes">
        {Array.from({ length: Math.min(completed, 12) }).map((_, i) => (
          <span key={i} title={`Session ${i + 1}`}>🍅</span>
        ))}
        {completed > 12 && <span className="pomo-extra">+{completed - 12}</span>}
        {completed === 0 && <span className="pomo-empty-tomato">Start your first session!</span>}
      </div>
    </div>
  )
}

/* ─── Habit Tracker ──────────────────────────────────────────────── */
function HabitTracker(): JSX.Element {
  const [habits, setHabits]   = useState<Habit[]>(() => loadJ('ub.habits', []))
  const [checks, setChecks]   = useState<Record<string, string[]>>(() => loadJ('ub.habit.checks', {}))
  const [adding, setAdding]   = useState(false)
  const [draft,  setDraft]    = useState('')
  const today = todayKey()

  const saveHabits = (h: Habit[]): void => { setHabits(h); saveJ('ub.habits', h) }
  const saveChecks = (c: Record<string, string[]>): void => { setChecks(c); saveJ('ub.habit.checks', c) }

  const toggle = (hid: string): void => {
    const todayChecks = checks[today] ?? []
    const next = todayChecks.includes(hid)
      ? todayChecks.filter((x) => x !== hid)
      : [...todayChecks, hid]
    saveChecks({ ...checks, [today]: next })
  }

  const addHabit = (): void => {
    const label = draft.trim()
    if (!label) return
    const h: Habit = { id: String(Date.now()), label, color: HABIT_COLORS[habits.length % HABIT_COLORS.length] }
    saveHabits([...habits, h])
    setDraft('')
    setAdding(false)
  }

  const removeHabit = (id: string): void => saveHabits(habits.filter((h) => h.id !== id))

  const todayChecks = checks[today] ?? []
  const doneToday = habits.filter((h) => todayChecks.includes(h.id)).length

  // last 7 days for streak mini-chart
  const last7 = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i))
    const key = d.toISOString().slice(0, 10)
    const done = (checks[key] ?? []).length
    return { key, done, label: d.toLocaleDateString(undefined, { weekday: 'narrow' }) }
  })

  return (
    <div className="habit-wrap">
      {/* streak bar */}
      {habits.length > 0 && (
        <div className="habit-streak">
          {last7.map(({ key, done, label }) => (
            <div key={key} className="habit-day">
              <div
                className="habit-bar"
                style={{
                  height: `${habits.length > 0 ? Math.round((done / habits.length) * 100) : 0}%`,
                  background: done > 0 ? 'var(--accent)' : 'var(--bg-raise)',
                  opacity: key === today ? 1 : 0.6
                }}
              />
              <div className="habit-day-label">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* progress */}
      {habits.length > 0 && (
        <div className="habit-progress-row">
          <div className="habit-progress-bar">
            <div
              className="habit-progress-fill"
              style={{ width: `${habits.length > 0 ? Math.round((doneToday / habits.length) * 100) : 0}%` }}
            />
          </div>
          <span className="habit-progress-label">{doneToday}/{habits.length} today</span>
        </div>
      )}

      {/* list */}
      {habits.map((h) => {
        const done = todayChecks.includes(h.id)
        return (
          <div key={h.id} className={`habit-item${done ? ' done' : ''}`}>
            <button
              className="habit-check"
              style={{ borderColor: h.color, background: done ? h.color : 'transparent' }}
              onClick={() => toggle(h.id)}
            >
              {done && '✓'}
            </button>
            <span className="habit-label">{h.label}</span>
            <button className="habit-rm" onClick={() => removeHabit(h.id)}>×</button>
          </div>
        )
      })}

      {habits.length === 0 && !adding && (
        <div className="home-empty">No habits yet — track anything daily.</div>
      )}

      {/* add */}
      {adding ? (
        <div className="habit-add-row">
          <input
            autoFocus
            className="todo-input"
            value={draft}
            placeholder="e.g. Read 30 min, Exercise, Meditate…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addHabit(); if (e.key === 'Escape') setAdding(false) }}
          />
          <button className="pomo-btn pomo-start" onClick={addHabit}>Add</button>
        </div>
      ) : (
        <button className="habit-add-btn" onClick={() => setAdding(true)}>+ Add habit</button>
      )}
    </div>
  )
}

/* ─── Focus Session Log ──────────────────────────────────────────── */
function FocusLog({ sessions }: { sessions: FocusSession[] }): JSX.Element {
  const todaySessions = sessions.filter((s) => new Date(s.at).toISOString().slice(0, 10) === todayKey())
  const totalMins = todaySessions.reduce((acc, s) => acc + s.mins, 0)
  const goal = 120 // 2 hours daily goal

  return (
    <div className="focus-wrap">
      {/* daily goal ring */}
      <div className="focus-stats-row">
        <div className="focus-ring-mini">
          <svg viewBox="0 0 44 44">
            <circle cx="22" cy="22" r="18" fill="none" strokeWidth="5" stroke="var(--bg-raise)" />
            <circle
              cx="22" cy="22" r="18"
              fill="none"
              strokeWidth="5"
              stroke="var(--accent)"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 18}`}
              strokeDashoffset={`${2 * Math.PI * 18 * (1 - Math.min(totalMins / goal, 1))}`}
              transform="rotate(-90 22 22)"
            />
          </svg>
          <span className="focus-ring-label">{Math.round((totalMins / goal) * 100)}%</span>
        </div>
        <div className="focus-stats-text">
          <div className="focus-big">{totalMins >= 60 ? `${Math.floor(totalMins / 60)}h ${totalMins % 60}m` : `${totalMins}m`}</div>
          <div className="focus-sub">focused today · goal {goal}m</div>
        </div>
      </div>

      {todaySessions.length === 0 && (
        <div className="home-empty">No sessions yet today. Start the Pomodoro timer!</div>
      )}
      {todaySessions.slice(-5).reverse().map((s) => (
        <div key={s.id} className="focus-item">
          <span className="focus-dot" />
          <span className="focus-item-label">{s.label}</span>
          <span className="focus-item-time">{s.mins}m · {new Date(s.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      ))}
    </div>
  )
}

/* ─── Study Bookmarks ────────────────────────────────────────────── */
function Bookmarks({ openTab }: { openTab: (type: 'web', url: string) => void }): JSX.Element {
  const [items,   setItems]   = useState<Bookmark[]>(() => loadJ('ub.bookmarks', []))
  const [adding,  setAdding]  = useState(false)
  const [dLabel,  setDLabel]  = useState('')
  const [dUrl,    setDUrl]    = useState('')

  const save = (b: Bookmark[]): void => { setItems(b); saveJ('ub.bookmarks', b) }

  const add = (): void => {
    const label = dLabel.trim()
    let url = dUrl.trim()
    if (!label || !url) return
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`
    save([...items, { id: String(Date.now()), label, url, icon: '' }])
    setDLabel(''); setDUrl(''); setAdding(false)
  }

  const remove = (id: string): void => save(items.filter((b) => b.id !== id))

  return (
    <div className="bm-wrap">
      <div className="bm-grid">
        {items.map((b) => (
          <div key={b.id} className="bm-item" title={b.url} onClick={() => openTab('web', b.url)}>
            <SiteIcon host={hostOf(b.url)} />
            <span className="bm-label">{b.label}</span>
            <button
              className="bm-rm"
              onClick={(e) => { e.stopPropagation(); remove(b.id) }}
            >×</button>
          </div>
        ))}
        <button className="bm-add" onClick={() => setAdding(true)}>+</button>
      </div>

      {adding && (
        <div className="bm-form">
          <input
            autoFocus
            className="todo-input"
            placeholder="Label (e.g. MDN Docs)"
            value={dLabel}
            onChange={(e) => setDLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setAdding(false)}
          />
          <input
            className="todo-input"
            placeholder="URL"
            value={dUrl}
            onChange={(e) => setDUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); if (e.key === 'Escape') setAdding(false) }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="pomo-btn pomo-start" onClick={add}>Add</button>
            <button className="pomo-btn pomo-reset" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Mini Stats / Daily Summary ────────────────────────────────── */
function DailyStats({ sessions, habits }: { sessions: FocusSession[]; habits?: never }): JSX.Element {
  const today = todayKey()
  const todaySessions = sessions.filter((s) => new Date(s.at).toISOString().slice(0, 10) === today)
  const totalMins = todaySessions.reduce((acc, s) => acc + s.mins, 0)

  const checks = loadJ<Record<string, string[]>>('ub.habit.checks', {})
  const habitsAll = loadJ<Habit[]>('ub.habits', [])
  const habitsDone = (checks[today] ?? []).length
  const habitsTotal = habitsAll.length

  const todos = loadJ<Array<{ done: boolean }>>('ub.todos', [])
  const todoDone = todos.filter((t) => t.done).length
  const todoTotal = todos.length

  const stats = [
    { label: 'Focus time',    value: totalMins >= 60 ? `${Math.floor(totalMins/60)}h ${totalMins%60}m` : `${totalMins}m`, color: 'var(--accent)' },
    { label: 'Sessions',      value: String(todaySessions.length), color: '#7aa2f7' },
    { label: 'Habits done',   value: habitsTotal > 0 ? `${habitsDone}/${habitsTotal}` : '—', color: '#7bd88f' },
    { label: 'Todos done',    value: todoTotal > 0 ? `${todoDone}/${todoTotal}` : '—', color: '#fabd2f' },
  ]

  return (
    <div className="dstats-grid">
      {stats.map((s) => (
        <div key={s.label} className="dstats-card">
          <div className="dstats-value" style={{ color: s.color }}>{s.value}</div>
          <div className="dstats-label">{s.label}</div>
        </div>
      ))}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN HOME TAB
   ═══════════════════════════════════════════════════════════════════ */

export function HomeTab(): JSX.Element {
  const visits    = useStore((s) => s.visits)
  const tree      = useStore((s) => s.tree)
  const todos     = useStore((s) => s.todos)
  const openTab   = useStore((s) => s.openTab)
  const addTodo   = useStore((s) => s.addTodo)
  const toggleTodo = useStore((s) => s.toggleTodo)
  const removeTodo = useStore((s) => s.removeTodo)
  const clearDone  = useStore((s) => s.clearDone)

  const [now,       setNow]       = useState(() => new Date())
  const [draft,     setDraft]     = useState('')
  const [scratch,   setScratch]   = useState(() => { try { return localStorage.getItem('ub.scratch') ?? '' } catch { return '' } })
  const [scratchSt, setScratchSt] = useState('')
  const [sessions,  setSessions]  = useState<FocusSession[]>(() => loadJ('ub.sessions', []))

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem('ub.scratch', scratch); setScratchSt(scratch ? `saved ${new Date().toLocaleTimeString()}` : '') } catch { setScratchSt('') }
    }, 400)
    return () => clearTimeout(t)
  }, [scratch])

  const notes     = useMemo(() => recentVaultFiles(tree, ['.md', '.mf', '.excalidraw'], 6), [tree])
  const openCount = todos.filter((t) => !t.done).length
  const doneCount = todos.length - openCount

  const hh   = String(now.getHours()).padStart(2, '0')
  const mm   = String(now.getMinutes()).padStart(2, '0')
  const ss   = String(now.getSeconds()).padStart(2, '0')
  const date = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

  const submitTodo = (): void => {
    const text = draft.trim()
    if (!text) return
    addTodo(text)
    setDraft('')
  }

  const handleSessionDone = (mins: number): void => {
    const label = `${POMO_PRESETS.find(p => p.work === mins)?.label ?? 'Focus'} session`
    const s: FocusSession = { id: String(Date.now()), label, mins, at: Date.now() }
    const updated = [...sessions, s]
    setSessions(updated)
    saveJ('ub.sessions', updated)
  }

  return (
    <div className="home">

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <div className="home-hero">
        <div className="home-clock">
          {hh}:{mm}<span className="home-secs">:{ss}</span>
        </div>
        <div className="home-date">{date}</div>
        <div className="home-greeting">{greeting(now.getHours())}</div>
      </div>

      {/* ── Daily stats strip ────────────────────────────────────── */}
      <DailyStats sessions={sessions} />

      {/* ── Row 1: Pomodoro + Focus Log ──────────────────────────── */}
      <div className="home-grid-3">
        <section className="home-card">
          <h3><span className="home-card-icon">🍅</span> POMODORO</h3>
          <PomodoroTimer onSessionDone={handleSessionDone} />
        </section>

        <section className="home-card home-card-span2">
          <h3><span className="home-card-icon">⚡</span> FOCUS LOG</h3>
          <FocusLog sessions={sessions} />
        </section>
      </div>

      {/* ── Row 2: Habit Tracker + Todos ─────────────────────────── */}
      <div className="home-grid">
        <section className="home-card">
          <h3><span className="home-card-icon">🎯</span> DAILY HABITS</h3>
          <HabitTracker />
        </section>

        <section className="home-card">
          <h3>
            <span className="home-card-icon">✅</span> TO-DO
            <span className="todo-count">{openCount} open{doneCount > 0 ? ` · ${doneCount} done` : ''}</span>
            {doneCount > 0 && <button className="btn todo-clear" onClick={clearDone}>Clear done</button>}
          </h3>
          <input
            className="todo-input"
            value={draft}
            placeholder="What needs doing? Enter to add…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitTodo()}
          />
          {todos.length === 0 && <div className="home-empty">Empty — add the first task.</div>}
          {todos.map((t) => (
            <div key={t.id} className={`todo${t.done ? ' done' : ''}`}>
              <input type="checkbox" checked={t.done} onChange={() => toggleTodo(t.id)} />
              <span className="t" onClick={() => toggleTodo(t.id)}>{t.text}</span>
              <button className="rm" onClick={() => removeTodo(t.id)}>×</button>
            </div>
          ))}
        </section>
      </div>

      {/* ── Row 3: Bookmarks + Recent Notes + Recent Sites ───────── */}
      <div className="home-grid-3">
        <section className="home-card">
          <h3><span className="home-card-icon">🔖</span> STUDY LINKS</h3>
          <Bookmarks openTab={(_, url) => openTab('web', url)} />
        </section>

        <section className="home-card">
          <h3><span className="home-card-icon">📝</span> RECENT NOTES</h3>
          {notes.length === 0 && <div className="home-empty">No notes yet.</div>}
          {notes.map((n) => (
            <div key={n.path} className="home-row" title={n.path} onClick={() => openTab(typeForPath(n.path), n.path)}>
              <span className={`dot t-${typeForPath(n.path)}`} />
              <span className="t">{baseName(n.path)}</span>
              <span className="s">{n.mtimeMs > 0 ? ago(n.mtimeMs) : ''}</span>
            </div>
          ))}
        </section>

        <section className="home-card">
          <h3><span className="home-card-icon">🌐</span> RECENT SITES</h3>
          {visits.length === 0 && <div className="home-empty">Browse something — it lands here.</div>}
          {visits.slice(0, 6).map((v) => (
            <div key={v.url} className="home-row" title={v.url} onClick={() => openTab('web', v.url)}>
              <SiteIcon host={hostOf(v.url)} />
              <span className="t">{v.title}</span>
              <span className="s">{ago(v.at)}</span>
            </div>
          ))}
        </section>
      </div>

      {/* ── Row 4: Scratchpad ────────────────────────────────────── */}
      <section className="home-card" style={{ marginTop: 16 }}>
        <h3>
          <span className="home-card-icon">💭</span> SCRATCHPAD
          <span className="todo-count">
            {scratchSt}
            {scratch.trim() ? ` · ${scratch.trim().split(/\s+/).length} words` : ''}
          </span>
        </h3>
        <textarea
          className="quick-input"
          value={scratch}
          rows={5}
          placeholder="Dump your thoughts here — kept locally, no file…"
          onChange={(e) => setScratch(e.target.value)}
        />
      </section>

    </div>
  )
}

