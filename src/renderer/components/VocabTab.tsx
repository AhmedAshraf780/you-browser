import { useEffect, useMemo, useRef, useState } from 'react'
import { dueLabel, parseVocabFile, schedule, useStore } from '../store'
import type { SrsGrade, VocabCard, VocabDraft } from '../store'
import { uid, type Tab } from '../tabs'

const GRADES: Array<{ g: SrsGrade; label: string; hint: string }> = [
  { g: 'again', label: 'Again', hint: '10m' },
  { g: 'hard', label: 'Hard', hint: '~' },
  { g: 'good', label: 'Good', hint: '✓' },
  { g: 'easy', label: 'Easy', hint: '✓✓' }
]

/** Vocabulary deck. Target `deck` is the global workspace deck (localStorage);
 *  any other target is a vault `.vocab` file with autosave. Same UI both. */
export function VocabTab({ tab }: { tab: Tab }): JSX.Element {
  const isGlobal = tab.target === 'deck'
  const storeVocab = useStore((s) => s.vocab)
  const storeAdd = useStore((s) => s.addVocab)
  const storeUpdate = useStore((s) => s.updateVocab)
  const storeDelete = useStore((s) => s.deleteVocab)
  const storeGrade = useStore((s) => s.gradeVocab)
  const storeToggleFav = useStore((s) => s.toggleFavourite)
  // every tab stays mounted; only the on-screen one (active or split) owns the keys
  const visible = useStore((s) => s.activeId === tab.id || s.splitTabId === tab.id)

  const [fileCards, setFileCards] = useState<VocabCard[] | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [view, setView] = useState<'review' | 'all'>('review')
  const [queue, setQueue] = useState<string[]>([])
  const [revealed, setRevealed] = useState(false)
  const [query, setQuery] = useState('')
  const [favOnly, setFavOnly] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<VocabDraft>({ word: '', meaning: '', example: '' })
  const [tick, setTick] = useState(0)

  // Load a file deck; the global deck comes from the store.
  useEffect(() => {
    if (isGlobal) return
    let alive = true
    setFileCards(null)
    window.vault
      .read(tab.target)
      .then((r) => {
        if (alive) setFileCards(parseVocabFile(r.data) ?? [])
      })
      .catch(() => {
        if (alive) setFileCards([])
      })
    return () => {
      alive = false
    }
  }, [tab.target, isGlobal])

  // Reset the session when the deck changes.
  useEffect(() => {
    setQueue([])
    setRevealed(false)
    setView('review')
    setQuery('')
    setEditing(null)
  }, [tab.target])

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    },
    []
  )

  const persistFile = (cards: VocabCard[]): void => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      window.vault
        .write(tab.target, JSON.stringify({ version: 1, name: tab.title, cards }, null, 2))
        .catch(() => {
          // save failed — the next edit retries
        })
    }, 700)
  }

  const cards = isGlobal ? storeVocab : (fileCards ?? [])

  const mutateFile = (fn: (list: VocabCard[]) => VocabCard[]): void => {
    setFileCards((prev) => {
      const next = fn(prev ?? [])
      persistFile(next)
      return next
    })
  }

  const add = (d: VocabDraft): void => {
    if (isGlobal) {
      storeAdd(d)
      return
    }
    const word = d.word.trim().slice(0, 120)
    if (!word) return
    mutateFile((list) => [
      ...list,
      {
        id: uid(),
        word,
        meaning: (d.meaning ?? '').slice(0, 2000),
        example: (d.example ?? '').slice(0, 2000),
        source: (d.source ?? '').slice(0, 500),
        tags: (d.tags ?? []).slice(0, 10),
        srs: { ease: 2.5, interval: 0, due: Date.now(), reps: 0, lapses: 0 },
        createdAt: Date.now(),
        favourite: d.favourite === true
      }
    ])
  }

  const update = (id: string, patch: Partial<Omit<VocabCard, 'id' | 'createdAt' | 'srs'>>): void => {
    if (isGlobal) {
      storeUpdate(id, patch)
      return
    }
    mutateFile((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  const remove = (id: string): void => {
    if (isGlobal) {
      storeDelete(id)
      return
    }
    mutateFile((list) => list.filter((c) => c.id !== id))
    setQueue((q) => q.filter((x) => x !== id))
  }

  const toggleFav = (id: string): void => {
    if (isGlobal) {
      storeToggleFav(id)
      return
    }
    mutateFile((list) => list.map((c) => (c.id === id ? { ...c, favourite: !c.favourite } : c)))
  }

  const grade = (id: string, g: SrsGrade): void => {
    if (isGlobal) {
      storeGrade(id, g)
    } else {
      mutateFile((list) => list.map((c) => (c.id === id ? { ...c, srs: schedule(c.srs, g) } : c)))
    }
  }

  const now = useMemo(() => Date.now(), [tick])
  const dueIds = useMemo(
    () => cards.filter((c) => c.srs.due <= now).map((c) => c.id),
    [cards, now]
  )

  const current = queue.length ? cards.find((c) => c.id === queue[0]) ?? null : null

  const startReview = (): void => {
    setQueue(dueIds)
    setRevealed(false)
  }

  const answer = (g: SrsGrade): void => {
    if (!current) return
    const id = current.id
    grade(id, g)
    setRevealed(false)
    setQueue((q) => {
      const rest = q.slice(1)
      return g === 'again' ? [...rest, id] : rest
    })
  }

  // Review keyboard: Space/Enter reveals, 1–4 grade.
  const answerRef = useRef(answer)
  answerRef.current = answer
  useEffect(() => {
    if (!visible || view !== 'review' || !current) return
    const onKey = (e: KeyboardEvent): void => {
      if (!revealed) {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          setRevealed(true)
        }
        return
      }
      const g = ({ '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' } as Record<string, SrsGrade>)[e.key]
      if (g) {
        e.preventDefault()
        answerRef.current(g)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, view, current, revealed])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = cards
    if (favOnly) list = list.filter((c) => c.favourite)
    if (q)
      list = list.filter(
        (c) => c.word.toLowerCase().includes(q) || c.meaning.toLowerCase().includes(q)
      )
    return [...list].sort((a, b) => a.srs.due - b.srs.due)
  }, [cards, query, favOnly])

  const commitNew = (): void => {
    const word = draft.word.trim()
    if (!word) return
    add(draft)
    setDraft({ word: '', meaning: '', example: '' })
  }

  if (!isGlobal && !fileCards) {
    return <div className="empty">loading deck…</div>
  }

  const learned = cards.filter((c) => c.srs.reps > 0).length
  const favCount = cards.filter((c) => c.favourite).length

  return (
    <div className="voc">
      <div className="voc-head">
        <div className="voc-modes">
          <button className={`btn${view === 'review' ? ' on' : ''}`} onClick={() => setView('review')}>
            Review{dueIds.length > 0 ? ` · ${dueIds.length}` : ''}
          </button>
          <button className={`btn${view === 'all' ? ' on' : ''}`} onClick={() => setView('all')}>
            All · {cards.length}
          </button>
        </div>
        <div className="voc-stats">
          <span title="cards learned (reviewed at least once)">{learned} learned</span>
          <span title="cards due right now">{dueIds.length} due</span>
          <span title="favourites">{favCount} ★</span>
        </div>
      </div>

      {view === 'review' ? (
        <div className="voc-review">
          {current ? (
            <div className="voc-card">
              <div className="voc-word-row">
                <span className="voc-word">{current.word}</span>
                <button
                  className={`voc-icon voc-star${current.favourite ? ' on' : ''}`}
                  title={current.favourite ? 'Remove from favourites' : 'Add to favourites'}
                  onClick={() => toggleFav(current.id)}
                >
                  {current.favourite ? '★' : '☆'}
                </button>
              </div>
              {current.tags.length > 0 && (
                <div className="voc-tags">
                  {current.tags.map((t) => (
                    <span key={t} className="voc-tag">
                      {t}
                    </span>
                  ))}
                </div>
              )}
              {revealed ? (
                <div className="voc-answer">
                  {current.meaning ? (
                    <p className="voc-meaning">{current.meaning}</p>
                  ) : (
                    <p className="voc-meaning voc-muted">— no meaning yet (edit in All) —</p>
                  )}
                  {current.example && <p className="voc-example">“{current.example}”</p>}
                  {current.source && (
                    <a
                      className="voc-source"
                      href={current.source}
                      title={current.source}
                      onClick={(e) => {
                        if (!/^https?:/.test(current.source)) e.preventDefault()
                        else {
                          e.preventDefault()
                          useStore.getState().openTab('web', current.source)
                        }
                      }}
                    >
                      {current.source.replace(/^https?:\/\//, '').slice(0, 60)}
                    </a>
                  )}
                </div>
              ) : (
                <button className="btn voc-reveal" onClick={() => setRevealed(true)}>
                  Show answer
                </button>
              )}
              {revealed && (
                <div className="voc-grades">
                  {GRADES.map(({ g, label }) => (
                    <button key={g} className={`btn voc-grade g-${g}`} onClick={() => answer(g)}>
                      {label}
                      <span className="voc-grade-key">{g === 'again' ? '1' : g === 'hard' ? '2' : g === 'good' ? '3' : '4'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : dueIds.length > 0 ? (
            <div className="voc-empty">
              <p>
                <strong>{dueIds.length}</strong> cards due.
              </p>
              <button className="btn on" onClick={startReview}>
                Start review
              </button>
            </div>
          ) : (
            <div className="voc-empty">
              <p className="voc-done">All caught up 🎉</p>
              {cards.length === 0 && (
                <p className="voc-muted">
                  No words yet. Add some in <strong>All</strong>, or select text on a page and press{' '}
                  <kbd>Ctrl+Shift+E</kbd>.
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="voc-all">
          <div className="voc-add">
            <input
              className="voc-input"
              placeholder="word or phrase"
              value={draft.word}
              onChange={(e) => setDraft((d) => ({ ...d, word: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && commitNew()}
            />
            <input
              className="voc-input"
              placeholder="meaning"
              value={draft.meaning}
              onChange={(e) => setDraft((d) => ({ ...d, meaning: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && commitNew()}
            />
            <button className="btn on" onClick={commitNew}>
              + Add
            </button>
          </div>

          <div className="voc-all-head">
            <input
              className="voc-search"
              placeholder="search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              className={`btn${favOnly ? ' on' : ''}`}
              title="Show favourites only"
              onClick={() => setFavOnly((v) => !v)}
            >
              ★ {favCount}
            </button>
          </div>

          <div className="voc-list">
            {filtered.length === 0 && (
              <div className="voc-muted voc-pad">
                {favOnly ? 'no favourites yet — tap ☆ on a word' : 'no cards'}
              </div>
            )}
            {filtered.map((c) =>
              editing === c.id ? (
                <div key={c.id} className="voc-row voc-row-edit">
                  <input
                    className="voc-input"
                    value={draft.word}
                    placeholder="word"
                    onChange={(e) => setDraft((d) => ({ ...d, word: e.target.value }))}
                  />
                  <input
                    className="voc-input"
                    value={draft.meaning}
                    placeholder="meaning"
                    onChange={(e) => setDraft((d) => ({ ...d, meaning: e.target.value }))}
                  />
                  <input
                    className="voc-input"
                    value={draft.example}
                    placeholder="example"
                    onChange={(e) => setDraft((d) => ({ ...d, example: e.target.value }))}
                  />
                  <div className="voc-row-actions">
                    <button
                      className="btn on"
                      onClick={() => {
                        update(c.id, {
                          word: draft.word,
                          meaning: draft.meaning ?? '',
                          example: draft.example ?? ''
                        })
                        setEditing(null)
                      }}
                    >
                      Save
                    </button>
                    <button className="btn" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div key={c.id} className="voc-row">
                  <div className="voc-row-main">
                    <span className="voc-row-word">{c.word}</span>
                    {c.meaning && <span className="voc-row-meaning">{c.meaning}</span>}
                  </div>
                  <span className="voc-row-due" title="next review">
                    {dueLabel(c.srs.due)}
                  </span>
                  <button
                    className={`voc-icon voc-star${c.favourite ? ' on' : ''}`}
                    title={c.favourite ? 'Remove from favourites' : 'Add to favourites'}
                    onClick={() => toggleFav(c.id)}
                  >
                    {c.favourite ? '★' : '☆'}
                  </button>
                  <button
                    className="voc-icon"
                    title="Edit"
                    onClick={() => {
                      setEditing(c.id)
                      setDraft({ word: c.word, meaning: c.meaning, example: c.example })
                    }}
                  >
                    ✎
                  </button>
                  <button className="voc-icon voc-del" title="Delete" onClick={() => remove(c.id)}>
                    ×
                  </button>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  )
}
