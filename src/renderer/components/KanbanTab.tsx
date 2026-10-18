import { useEffect, useRef, useState } from 'react'
import { freshBoard, useStore } from '../store'
import type { BoardCard, BoardColumn } from '../store'
import { uid, type Tab } from '../tabs'

function parseBoardColumns(text: string): BoardColumn[] | null {
  try {
    const parsed: unknown = JSON.parse(text)
    const raw = Array.isArray(parsed)
      ? parsed
      : (parsed as { columns?: unknown }).columns
    if (!Array.isArray(raw)) return null
    const cols: BoardColumn[] = []
    for (const c of raw.slice(0, 50)) {
      if (!c || typeof c !== 'object') continue
      const o = c as Record<string, unknown>
      const title = typeof o.title === 'string' && o.title.trim() ? o.title.slice(0, 40) : 'Untitled'
      const cards: BoardCard[] = []
      if (Array.isArray(o.cards)) {
        for (const k of o.cards.slice(0, 500)) {
          if (k && typeof k === 'object' && typeof (k as Record<string, unknown>).title === 'string') {
            const ko = k as Record<string, unknown>
            cards.push({
              id: typeof ko.id === 'string' && ko.id ? ko.id : uid(),
              title: (ko.title as string).slice(0, 500),
              createdAt: typeof ko.createdAt === 'number' ? ko.createdAt : 0
            })
          }
        }
      }
      cols.push({ id: typeof o.id === 'string' && o.id ? o.id : uid(), title, cards })
    }
    return cols.length > 0 ? cols : null
  } catch {
    return null
  }
}

/** Full-page kanban board. Target `board` is the global workspace board;
 *  any other target is a vault `.kanban` file with autosave. Same UI both. */
export function KanbanTab({ tab }: { tab: Tab }): JSX.Element {
  const isGlobal = tab.target === 'board'
  const storeBoard = useStore((s) => s.board)
  const addCard = useStore((s) => s.addCard)
  const moveCard = useStore((s) => s.moveCard)
  const updateCard = useStore((s) => s.updateCard)
  const deleteCard = useStore((s) => s.deleteCard)
  const addColumn = useStore((s) => s.addColumn)
  const renameColumn = useStore((s) => s.renameColumn)
  const deleteColumn = useStore((s) => s.deleteColumn)

  const [fileBoard, setFileBoard] = useState<BoardColumn[] | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (isGlobal) return
    let alive = true
    setFileBoard(null)
    window.vault
      .read(tab.target)
      .then((r) => {
        if (alive) setFileBoard(parseBoardColumns(r.data) ?? freshBoard())
      })
      .catch(() => {
        if (alive) setFileBoard(freshBoard())
      })
    return () => {
      alive = false
    }
  }, [tab.target, isGlobal])

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    },
    []
  )

  const persistFile = (cols: BoardColumn[]): void => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      window.vault.write(tab.target, JSON.stringify({ version: 1, columns: cols }, null, 2)).catch(() => {
        // save failed — next edit retries
      })
    }, 800)
  }

  const mutateFile = (fn: (cols: BoardColumn[]) => BoardColumn[]): void => {
    const cols = fn(fileBoard ?? [])
    setFileBoard(cols)
    persistFile(cols)
  }

  const board = isGlobal ? storeBoard : (fileBoard ?? [])

  const doAddCard = (colId: string, title: string): void => {
    if (isGlobal) return addCard(colId, title)
    mutateFile((cols) =>
      cols.map((c) => (c.id === colId ? { ...c, cards: [...c.cards, { id: uid(), title, createdAt: Date.now() }] } : c))
    )
  }

  const doMoveCard = (cardId: string, toColId: string): void => {
    if (isGlobal) return moveCard(cardId, toColId)
    mutateFile((cols) => {
      let card: BoardCard | null = null
      const stripped = cols.map((c) => {
        const found = c.cards.find((k) => k.id === cardId)
        if (found) card = found
        return { ...c, cards: c.cards.filter((k) => k.id !== cardId) }
      })
      if (!card) return cols
      return stripped.map((c) => (c.id === toColId && card ? { ...c, cards: [...c.cards, card] } : c))
    })
  }

  const doUpdateCard = (colId: string, cardId: string, title: string): void => {
    if (isGlobal) return updateCard(colId, cardId, title)
    mutateFile((cols) =>
      cols.map((c) => (c.id === colId ? { ...c, cards: c.cards.map((k) => (k.id === cardId ? { ...k, title } : k)) } : c))
    )
  }

  const doDeleteCard = (colId: string, cardId: string): void => {
    if (isGlobal) return deleteCard(colId, cardId)
    mutateFile((cols) => cols.map((c) => (c.id === colId ? { ...c, cards: c.cards.filter((k) => k.id !== cardId) } : c)))
  }

  const doAddColumn = (title: string): void => {
    if (isGlobal) return addColumn(title)
    mutateFile((cols) => [...cols, { id: uid(), title, cards: [] }])
  }

  const doRenameColumn = (colId: string, title: string): void => {
    if (isGlobal) return renameColumn(colId, title)
    mutateFile((cols) => cols.map((c) => (c.id === colId ? { ...c, title } : c)))
  }

  const doDeleteColumn = (colId: string): void => {
    if (isGlobal) return deleteColumn(colId)
    mutateFile((cols) => {
      if (cols.find((c) => c.id === colId)?.cards.length) return cols
      return cols.filter((c) => c.id !== colId)
    })
  }

  const [dragId, setDragId] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [renamingCol, setRenamingCol] = useState<string | null>(null)
  const [colDraft, setColDraft] = useState('')
  const [addingCol, setAddingCol] = useState(false)
  const [newColName, setNewColName] = useState('')

  const commitCard = (colId: string): void => {
    const title = (drafts[colId] ?? '').trim()
    setDrafts((d) => ({ ...d, [colId]: '' }))
    if (title) doAddCard(colId, title)
  }

  const commitEdit = (colId: string, cardId: string): void => {
    const title = editText.trim()
    setEditing(null)
    if (title) doUpdateCard(colId, cardId, title)
  }

  const commitNewCol = (): void => {
    const title = newColName.trim().slice(0, 40)
    setAddingCol(false)
    setNewColName('')
    if (title) doAddColumn(title)
  }

  const commitColRename = (col: BoardColumn): void => {
    const title = colDraft.trim().slice(0, 40)
    setRenamingCol(null)
    if (title && title !== col.title) doRenameColumn(col.id, title)
  }

  if (!isGlobal && !fileBoard) {
    return <div className="empty">loading board…</div>
  }

  return (
    <div className="kbp">
      {board.map((col) => (
        <div key={col.id} className="kbp-col">
          <div
            className="kbp-head"
            onDoubleClick={() => { setRenamingCol(col.id); setColDraft(col.title) }}
            title="Double-click to rename"
          >
            {renamingCol === col.id ? (
              <input
                className="kb-inline"
                autoFocus
                value={colDraft}
                onChange={(e) => setColDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitColRename(col)
                  if (e.key === 'Escape') setRenamingCol(null)
                }}
                onBlur={() => commitColRename(col)}
              />
            ) : (
              <>
                <span className="kbp-title">{col.title}</span>
                <span className="kb-count">{col.cards.length}</span>
                {col.cards.length === 0 && (
                  <button className="kb-x" title="Delete column" onClick={() => doDeleteColumn(col.id)}>
                    ×
                  </button>
                )}
              </>
            )}
          </div>

          <div
            className={`kbp-body${overCol === col.id ? ' over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setOverCol(col.id)
            }}
            onDragLeave={() => setOverCol((o) => (o === col.id ? null : o))}
            onDrop={() => {
              if (dragId) doMoveCard(dragId, col.id)
              setDragId(null)
              setOverCol(null)
            }}
          >
            {col.cards.length === 0 ? (
              <div className="kbp-empty">No tickets</div>
            ) : (
              col.cards.map((c) => (
                <div
                  key={c.id}
                  className={`kb-card${dragId === c.id ? ' drag' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move'
                    setDragId(c.id)
                  }}
                  onDragEnd={() => {
                    setDragId(null)
                    setOverCol(null)
                  }}
                  onDoubleClick={() => { setEditing(c.id); setEditText(c.title) }}
                  title="Drag to move · double-click to edit"
                >
                  {editing === c.id ? (
                    <input
                      className="kb-inline"
                      autoFocus
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEdit(col.id, c.id)
                        if (e.key === 'Escape') setEditing(null)
                      }}
                      onBlur={() => commitEdit(col.id, c.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <>
                      <span className="kb-text">{c.title}</span>
                      <button className="kb-x" title="Delete ticket" onClick={() => doDeleteCard(col.id, c.id)}>
                        ×
                      </button>
                    </>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="kbp-add">
            <input
              className="kbp-input"
              value={drafts[col.id] ?? ''}
              placeholder="Add a ticket…"
              onChange={(e) => setDrafts((d) => ({ ...d, [col.id]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitCard(col.id)
              }}
            />
            <button className="kbp-plus" title="Add ticket" onClick={() => commitCard(col.id)}>
              +
            </button>
          </div>
        </div>
      ))}

      {addingCol ? (
        <div className="kbp-col kbp-new">
          <input
            className="kb-inline"
            autoFocus
            value={newColName}
            placeholder="Column name…"
            onChange={(e) => setNewColName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitNewCol()
              if (e.key === 'Escape') { setAddingCol(false); setNewColName('') }
            }}
            onBlur={commitNewCol}
          />
        </div>
      ) : (
        <button className="kbp-addcol" onClick={() => { setAddingCol(true); setNewColName('') }}>
          + Add Column
        </button>
      )}
    </div>
  )
}
