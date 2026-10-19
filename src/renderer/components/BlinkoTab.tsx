import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { Check, GripVertical, Pencil, Pin, Trash2, X, Zap } from 'lucide-react'
import { useStore } from '../store'
import { uid, type Tab } from '../tabs'
import { renderMarkdown } from '../markdown/pipeline'
import { escapeHtml } from '../markdown/escape'
import { cardFontStack } from '../fonts'
import {
  BLINKO_COLORS,
  extractTags,
  moveCard,
  nextOrder,
  orderCards,
  parseBlinkoFile,
  serializeBlinkoFile,
  type BlinkoCard
} from '../blinko'
import { BlinkoEditor, type BlinkoEditorHandle } from './BlinkoEditor'
import 'katex/dist/katex.min.css'
import '../markdown/inkdrop.css'

function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  const m = s / 60
  if (m < 60) return `${Math.floor(m)}m ago`
  const h = m / 60
  if (h < 24) return `${Math.floor(h)}h ago`
  const d = h / 24
  if (d < 30) return `${Math.floor(d)}d ago`
  return new Date(ms).toLocaleDateString()
}

/** Colour picker row shared by the composer and the inline editor. */
function Swatches({ value, onChange }: { value: string; onChange: (c: string) => void }): JSX.Element {
  return (
    <div className="blp-swatches">
      <button
        type="button"
        className={`blp-swatch blp-swatch-none${value === '' ? ' on' : ''}`}
        title="No colour"
        onClick={() => onChange('')}
      />
      {BLINKO_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className={`blp-swatch${value === c ? ' on' : ''}`}
          style={{ background: c }}
          title={c}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  )
}

/** Full-page Blinko workspace. Target is a vault `.blinko` file with autosave. */
export function BlinkoTab({ tab }: { tab: Tab }): JSX.Element {
  const openTab = useStore((s) => s.openTab)
  const mode = useStore((s) => s.mode)
  const blinkoFont = useStore((s) => s.blinkoFont)

  const [cards, setCards] = useState<BlinkoCard[] | null>(null)
  const [htmlMap, setHtmlMap] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState('')
  const [color, setColor] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editColor, setEditColor] = useState('')
  const [filterTag, setFilterTag] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState('')
  const [lightbox, setLightbox] = useState<string | null>(null)
  /** Card currently being dragged, and the slot it would drop into. */
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropSlot, setDropSlot] = useState<{ id: string; after: boolean } | null>(null)

  const rootRef = useRef<HTMLDivElement>(null)
  const streamRef = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Per-card render caches so one edited card doesn't reparse the whole board.
  const srcCache = useRef(new Map<string, string>())
  const htmlCache = useRef(new Map<string, string>())
  const composerRef = useRef<BlinkoEditorHandle>(null)
  // Latest known list, so two mutations in one tick never lose an update.
  const cardsRef = useRef<BlinkoCard[]>([])
  cardsRef.current = cards ?? []
  // Drag state lives in a ref: the floating copy follows the pointer through
  // direct DOM writes, so a move doesn't re-render the board every frame.
  const dragRef = useRef<{
    id: string
    offsetX: number
    offsetY: number
    ghost: HTMLElement
    slot: { id: string; after: boolean } | null
  } | null>(null)
  /** Set on drop so the click that follows a drag can't open the editor. */
  const suppressClick = useRef(0)

  const showError = useCallback((message: string) => {
    setError(message)
    if (errorTimer.current) clearTimeout(errorTimer.current)
    errorTimer.current = setTimeout(() => setError(''), 5000)
  }, [])

  // Load the workspace file; a missing/invalid file starts a fresh stream.
  useEffect(() => {
    let alive = true
    setCards(null)
    setHtmlMap({})
    srcCache.current.clear()
    htmlCache.current.clear()
    window.vault
      .read(tab.target)
      .then((r) => {
        if (alive) setCards(parseBlinkoFile(r.data) ?? [])
      })
      .catch(() => {
        if (alive) setCards([])
      })
    return () => {
      alive = false
    }
  }, [tab.target])

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (errorTimer.current) clearTimeout(errorTimer.current)
      // A tab closed mid-drag must not leave its floating copy behind.
      dragRef.current?.ghost.remove()
      dragRef.current = null
      document.body.classList.remove('blp-dragging')
    },
    []
  )

  // Escape closes the image viewer.
  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setLightbox(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

  const persist = useCallback(
    (next: BlinkoCard[]): void => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      setSaveState('saving')
      saveTimer.current = setTimeout(() => {
        window.vault
          .write(tab.target, serializeBlinkoFile(next))
          .then(() => setSaveState('saved'))
          .catch(() => setSaveState('error'))
      }, 700)
    },
    [tab.target]
  )

  const mutate = (fn: (c: BlinkoCard[]) => BlinkoCard[]): void => {
    if (!cardsRef.current) return
    const next = fn(cardsRef.current)
    cardsRef.current = next
    setCards(next)
    persist(next)
  }

  // Render each card's Markdown through the Inkdrop pipeline, cached by source.
  useEffect(() => {
    if (!cards) return
    let alive = true
    void (async () => {
      const next: Record<string, string> = {}
      for (const card of cards) {
        if (srcCache.current.get(card.id) === card.content && htmlCache.current.has(card.id)) {
          next[card.id] = htmlCache.current.get(card.id) as string
          continue
        }
        try {
          const { html } = await renderMarkdown(card.content)
          srcCache.current.set(card.id, card.content)
          htmlCache.current.set(card.id, html)
          next[card.id] = html
        } catch (err) {
          next[card.id] = `<p class="mde-error-message">${escapeHtml(String(err))}</p>`
        }
      }
      if (alive) setHtmlMap(next)
    })()
    return () => {
      alive = false
    }
  }, [cards])

  // Mermaid diagrams inside cards render client-side, like the note preview.
  useEffect(() => {
    const root = streamRef.current
    if (!root) return
    const nodes = Array.from(root.querySelectorAll<HTMLElement>('.mermaid-dot-grid[data-mermaid-src]'))
    if (nodes.length === 0) return
    let cancelled = false
    const cleanups: Array<() => void> = []

    void (async () => {
      const mermaid = (await import('mermaid')).default
      const styles = getComputedStyle(document.documentElement)
      const cssVar = (name: string, fallback: string): string => styles.getPropertyValue(name).trim() || fallback
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        theme: 'base',
        themeVariables: {
          darkMode: mode === 'dark',
          background: cssVar('--bg', '#000000'),
          primaryColor: cssVar('--bg-raise', '#111111'),
          primaryTextColor: cssVar('--text', '#dddddd'),
          primaryBorderColor: cssVar('--border', '#333333'),
          lineColor: cssVar('--text-dim', '#888888'),
          secondaryColor: cssVar('--bg-raise', '#111111'),
          tertiaryColor: cssVar('--bg', '#000000'),
          fontSize: '16px'
        }
      })

      for (const node of nodes) {
        const diagram = node.closest('.mermaid-diagram') as HTMLElement | null
        const content = node.closest('.mermaid-diagram-content') as HTMLElement | null
        const source = decodeURIComponent(node.dataset.mermaidSrc || '')
        const id = `mermaid-${Math.random().toString(36).replace(/[^a-z]+/g, '').slice(0, 5)}`
        try {
          const { svg } = await mermaid.render(id, source)
          if (cancelled) return
          node.innerHTML = svg
        } catch (err) {
          if (cancelled) return
          node.innerHTML = ''
          const box = document.createElement('div')
          box.className = 'ui error message'
          box.innerHTML =
            `<div class="header">Failed to render Mermaid</div>` +
            `<div><pre>${escapeHtml(err instanceof Error ? err.message : String(err))}</pre></div>`
          diagram?.appendChild(box)
          continue
        }

        if (!diagram || !content) continue
        let scale = 1
        const setScale = (nextScale: number): void => {
          scale = Math.min(8, Math.max(0.2, nextScale))
          content.style.transform = `scale(${scale})`
        }
        const onToolbarClick = (event: Event): void => {
          const button = (event.target as HTMLElement).closest('button[data-mermaid-action]')
          if (!button) return
          switch (button.getAttribute('data-mermaid-action')) {
            case 'zoom-in':
              setScale(scale * 1.4)
              break
            case 'zoom-out':
              setScale(scale / 1.4)
              break
            case 'reset':
              setScale(1)
              break
            case 'expand':
              if (document.fullscreenElement) void document.exitFullscreen()
              else void diagram.requestFullscreen()
              break
          }
        }
        const toolbar = diagram.querySelector('.mermaid-toolbar')
        toolbar?.addEventListener('click', onToolbarClick)
        cleanups.push(() => toolbar?.removeEventListener('click', onToolbarClick))
      }
    })()

    return () => {
      cancelled = true
      for (const fn of cleanups) fn()
    }
  }, [htmlMap, mode])

  const onStreamClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement
      const copy = target.closest('.copy-to-clipboard') as HTMLButtonElement | null
      if (copy) {
        event.preventDefault()
        const code = copy.dataset.code ?? ''
        void navigator.clipboard.writeText(code).then(() => {
          copy.classList.add('copied')
          window.setTimeout(() => copy.classList.remove('copied'), 1500)
        })
        return
      }
      const tag = target.closest('.blp-tag') as HTMLElement | null
      if (tag) {
        event.preventDefault()
        const value = tag.dataset.tag || ''
        setFilterTag((cur) => (cur === value ? null : value))
        return
      }
      const image = target.closest('.blp-md img') as HTMLImageElement | null
      if (image) {
        event.preventDefault()
        setLightbox(image.currentSrc || image.src)
        return
      }
      const anchor = target.closest('a') as HTMLAnchorElement | null
      if (anchor) {
        const href = anchor.getAttribute('href') || ''
        if (href.startsWith('#')) return
        event.preventDefault()
        if (/^https?:\/\//i.test(href)) openTab('web', href)
      }
    },
    [openTab]
  )

  const allTags = useMemo(() => {
    const seen = new Map<string, string>()
    for (const c of cards ?? []) for (const t of extractTags(c.content)) seen.set(t.toLowerCase(), t)
    return [...seen.values()].sort((a, b) => a.localeCompare(b))
  }, [cards])

  const visible = useMemo(() => {
    const ordered = orderCards(cards ?? [])
    if (!filterTag) return ordered
    const key = filterTag.toLowerCase()
    return ordered.filter((c) => extractTags(c.content).some((t) => t.toLowerCase() === key))
  }, [cards, filterTag])

  const submit = (): void => {
    const content = draft.trim()
    if (!content) return
    const now = Date.now()
    mutate((cs) => [
      // Newest blinks take the lowest `order`, so they land on top of the
      // unpinned section without disturbing anything that's been placed.
      { id: uid(), content, color, pinned: false, order: nextOrder(cs), createdAt: now, updatedAt: now },
      ...cs
    ])
    setDraft('')
    setColor('')
    composerRef.current?.clear()
    composerRef.current?.focus()
  }

  const startEdit = (card: BlinkoCard): void => {
    // Opening another card shouldn't silently drop an in-progress edit.
    if (editingId && editingId !== card.id) saveEdit()
    setEditingId(card.id)
    setEditText(card.content)
    setEditColor(card.color)
  }

  const saveEdit = (): void => {
    const content = editText.trim()
    const id = editingId
    setEditingId(null)
    if (!id || !content) return
    mutate((cs) => cs.map((c) => (c.id === id ? { ...c, content, color: editColor, updatedAt: Date.now() } : c)))
  }

  /** Pinning also re-seats the card above its new group, so it visibly jumps up. */
  const togglePin = (id: string): void =>
    mutate((cs) => cs.map((c) => (c.id === id ? { ...c, pinned: !c.pinned, order: nextOrder(cs, id) } : c)))

  const remove = (id: string): void => mutate((cs) => cs.filter((c) => c.id !== id))

  /* ─── Drag to reorder ──────────────────────────────────────────────────── */

  /**
   * Where a drop would land for the pointer at (x, y): the card under the
   * pointer plus whether the pointer is past its midpoint. Only cards sharing
   * the dragged card's pin state count — the pinned section is a fixed band,
   * so dragging out of it is a no-op instead of a card that snaps back.
   */
  const dropSlotAt = (x: number, y: number, movingId: string): { id: string; after: boolean } | null => {
    const under = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('.blp-card') as
      | HTMLElement
      | null
    const targetId = under?.dataset.cardId ?? ''
    if (!under || !targetId || targetId === movingId) return null
    const ordered = orderCards(cardsRef.current)
    const moving = ordered.find((c) => c.id === movingId)
    const target = ordered.find((c) => c.id === targetId)
    if (!moving || !target || moving.pinned !== target.pinned) return null
    const rect = under.getBoundingClientRect()
    return { id: targetId, after: y > rect.top + rect.height / 2 }
  }

  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>, card: BlinkoCard): void => {
    if (event.button !== 0) return
    const article = (event.currentTarget as HTMLElement).closest('.blp-card') as HTMLElement | null
    if (!article || dragRef.current) return
    event.preventDefault()
    event.stopPropagation()

    const rect = article.getBoundingClientRect()
    const ghost = document.createElement('div')
    ghost.className = 'blp-drag-ghost'
    ghost.style.width = `${rect.width}px`
    // A copy follows the pointer while the real card dims in place, so the
    // drop line stays readable against a board that never reflows mid-drag.
    ghost.innerHTML = article.outerHTML
    ;(rootRef.current ?? document.body).appendChild(ghost)

    const state = { id: card.id, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, ghost, slot: null }
    dragRef.current = state
    document.body.classList.add('blp-dragging')
    setDragId(card.id)
    // Capture so the pointerup that ends the drag is delivered even if the
    // button re-renders or the pointer leaves the window.
    try {
      ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    } catch {
      // no capture support — window listeners still cover the common cases
    }

    const place = (cx: number, cy: number): void => {
      ghost.style.transform = `translate(${cx - state.offsetX}px, ${cy - state.offsetY}px)`
    }
    place(event.clientX, event.clientY)

    const onMove = (e: PointerEvent): void => {
      const current = dragRef.current
      if (!current) return
      place(e.clientX, e.clientY)
      // Nudge the stream along when the pointer reaches an edge.
      const stream = streamRef.current
      if (stream) {
        const box = stream.getBoundingClientRect()
        if (e.clientY < box.top + 48) stream.scrollTop -= 14
        else if (e.clientY > box.bottom - 48) stream.scrollTop += 14
      }
      const slot = dropSlotAt(e.clientX, e.clientY, current.id)
      if (slot?.id !== current.slot?.id || slot?.after !== current.slot?.after) {
        current.slot = slot
        setDropSlot(slot)
      }
    }

    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      document.body.classList.remove('blp-dragging')
      const finished = dragRef.current
      dragRef.current = null
      ghost.remove()
      setDragId(null)
      setDropSlot(null)
      if (!finished?.slot) return
      // The pointerup also delivers a click (and possibly a dblclick) to the
      // card underneath; swallow it so a drag never opens the editor.
      suppressClick.current = Date.now()
      const { id, slot } = finished
      mutate((cs) => moveCard(cs, id, slot.id, slot.after))
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  /** Blinko opens the editor on a click; here the card body answers to a double-click. */
  const onCardDoubleClick = (event: ReactMouseEvent<HTMLElement>, card: BlinkoCard): void => {
    if (editingId === card.id) return
    if (Date.now() - suppressClick.current < 400) return
    const target = event.target as HTMLElement
    // Never hijack a double-click aimed at something interactive.
    if (target.closest('button, a, .blp-tag, img, audio, video, input, textarea, .copy-to-clipboard')) return
    event.preventDefault()
    // The double-click has just selected a word — drop it before swapping in
    // the editor, otherwise the selection lands in the textarea.
    window.getSelection()?.removeAllRanges()
    startEdit(card)
  }

  if (!cards) return <div className="empty">loading workspace…</div>

  return (
    <div
      className="blp"
      ref={rootRef}
      style={blinkoFont ? ({ '--blp-font': cardFontStack(blinkoFont) } as React.CSSProperties) : undefined}
    >
      <div className="blp-top">
        <div className="blp-head">
          <span className="blp-mark">Blinko</span>
          <span className="blp-count">
            {cards.length} {cards.length === 1 ? 'card' : 'cards'}
          </span>
          <span className={`blp-save blp-save-${saveState}`}>
            {saveState === 'saving' ? 'saving…' : saveState === 'saved' ? 'saved' : saveState === 'error' ? 'save failed' : ''}
          </span>
        </div>

        {allTags.length > 0 && (
          <div className="blp-filters">
            <button className={`blp-chip${filterTag === null ? ' on' : ''}`} onClick={() => setFilterTag(null)}>
              All
            </button>
            {allTags.map((t) => (
              <button
                key={t}
                className={`blp-chip${filterTag === t ? ' on' : ''}`}
                onClick={() => setFilterTag((cur) => (cur === t ? null : t))}
              >
                #{t}
              </button>
            ))}
          </div>
        )}

        <div className="blp-composer">
          <BlinkoEditor
            ref={composerRef}
            value={draft}
            onChange={setDraft}
            onSubmit={submit}
            placeholder="Blink something… Markdown, #tags, images and voice notes"
            autoFocus
            target={tab.target}
            tags={allTags}
            onError={showError}
          />
          <div className="blp-composer-bar">
            <Swatches value={color} onChange={setColor} />
            <span className="blp-hint">Ctrl+Enter to blink</span>
            <button className="blp-send" disabled={!draft.trim()} onClick={submit}>
              Blink
            </button>
          </div>
        </div>
        {error && <div className="blp-error">{error}</div>}
      </div>

      <div className="blp-stream" ref={streamRef} onClick={onStreamClick}>
        {visible.length === 0 ? (
          <div className="blp-empty">
            {cards.length === 0
              ? 'This workspace is empty. Write your first blink above — it saves to ' + tab.target + '.'
              : `No cards tagged #${filterTag}.`}
          </div>
        ) : (
          <div className="blp-masonry">
            {visible.map((card) => (
              <article
                key={card.id}
                data-card-id={card.id}
                className={
                  'blp-card' +
                  (card.pinned ? ' is-pinned' : '') +
                  (dragId === card.id ? ' is-dragging' : '') +
                  (dropSlot && dropSlot.id === card.id ? (dropSlot.after ? ' drop-after' : ' drop-before') : '')
                }
                onDoubleClick={(event) => onCardDoubleClick(event, card)}
              >
                {card.color && <span className="blp-card-accent" style={{ background: card.color }} />}
                <header className="blp-card-head">
                  <span className="blp-time" title={new Date(card.createdAt).toLocaleString()}>
                    {ago(card.createdAt)}
                  </span>
                  {card.pinned && (
                    <span className="blp-pin-badge" title="Pinned to top">
                      <Pin size={10} />
                    </span>
                  )}
                  {editingId !== card.id && (
                    <div className="blp-tools">
                      <button
                        className="blp-icon-btn blp-grip"
                        title="Drag to reorder"
                        onPointerDown={(event) => beginDrag(event, card)}
                      >
                        <GripVertical size={14} />
                      </button>
                      <button
                        className={`blp-icon-btn${card.pinned ? ' on' : ''}`}
                        title={card.pinned ? 'Unpin' : 'Pin to top'}
                        onClick={() => togglePin(card.id)}
                      >
                        <Pin size={14} />
                      </button>
                      <button className="blp-icon-btn" title="Edit (or double-click the card)" onClick={() => startEdit(card)}>
                        <Pencil size={14} />
                      </button>
                      <button className="blp-icon-btn blp-del" title="Delete" onClick={() => remove(card.id)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </header>

                {editingId === card.id ? (
                  <div className="blp-edit">
                    <BlinkoEditor
                      value={editText}
                      onChange={setEditText}
                      onSubmit={saveEdit}
                      placeholder="Edit this blink…"
                      autoFocus
                      target={tab.target}
                      tags={allTags}
                      onError={showError}
                    />
                    <div className="blp-composer-bar">
                      <Swatches value={editColor} onChange={setEditColor} />
                      <button className="blp-icon-btn" title="Save (Ctrl+Enter)" onClick={saveEdit}>
                        <Check size={14} />
                      </button>
                      <button className="blp-icon-btn" title="Cancel (Esc)" onClick={() => setEditingId(null)}>
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div
                      className="mde-preview blp-md"
                      dangerouslySetInnerHTML={{ __html: htmlMap[card.id] ?? '' }}
                    />
                    {extractTags(card.content).length > 0 && (
                      <div className="blp-tags">
                        {extractTags(card.content).map((t) => (
                          <button key={t} className="blp-tag" data-tag={t} title={`Filter by #${t}`}>
                            #{t}
                          </button>
                        ))}
                      </div>
                    )}
                    <footer className="blp-card-foot">
                      <span className="blp-cat">
                        <Zap size={12} />
                        Blinko
                      </span>
                    </footer>
                  </>
                )}
              </article>
            ))}
          </div>
        )}
      </div>

      {lightbox && (
        <div className="blp-lightbox" onClick={() => setLightbox(null)} role="dialog" aria-label="Image preview">
          <img src={lightbox} alt="" />
        </div>
      )}
    </div>
  )
}
