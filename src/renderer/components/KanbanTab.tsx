import { useState } from 'react'
import { useStore } from '../store'
import type { BoardColumn } from '../store'

/** Full-page kanban board. Same persisted board as everywhere else,
 *  laid out in wide horizontal columns like a classic board view. */
export function KanbanTab(): JSX.Element {
  const board = useStore((s) => s.board)
  const addCard = useStore((s) => s.addCard)
  const moveCard = useStore((s) => s.moveCard)
  const updateCard = useStore((s) => s.updateCard)
  const deleteCard = useStore((s) => s.deleteCard)
  const addColumn = useStore((s) => s.addColumn)
  const renameColumn = useStore((s) => s.renameColumn)
  const deleteColumn = useStore((s) => s.deleteColumn)

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
    if (title) addCard(colId, title)
  }

  const commitEdit = (colId: string, cardId: string): void => {
    const title = editText.trim()
    setEditing(null)
    if (title) updateCard(colId, cardId, title)
  }

  const commitNewCol = (): void => {
    const title = newColName.trim().slice(0, 40)
    setAddingCol(false)
    setNewColName('')
    if (title) addColumn(title)
  }

  const commitColRename = (col: BoardColumn): void => {
    const title = colDraft.trim().slice(0, 40)
    setRenamingCol(null)
    if (title && title !== col.title) renameColumn(col.id, title)
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
                  <button className="kb-x" title="Delete column" onClick={() => deleteColumn(col.id)}>
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
              if (dragId) moveCard(dragId, col.id)
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
                      <button className="kb-x" title="Delete ticket" onClick={() => deleteCard(col.id, c.id)}>
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
