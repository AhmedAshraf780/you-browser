import { useEffect, useState } from 'react'
import { useStore } from '../store'

interface StudyWord {
  id?: string
  word: string
  ipa: string
  pos: string
  meaning: string
  example: string
  cat: string
  kind?: 'word' | 'verb' | 'phrasal'
}

/** The system-fed word card. The main process sources a live dictionary word
 *  on a timer and pushes it here (or via a notification when the window is
 *  unfocused). Shown bottom-centre so it never blocks the page you're reading. */
export function StudyOverlay(): JSX.Element | null {
  const autoAdd = useStore((s) => s.study.autoAdd)
  const openTab = useStore((s) => s.openTab)
  const vocab = useStore((s) => s.vocab)
  const [word, setWord] = useState<StudyWord | null>(null)
  const [cardId, setCardId] = useState<string | null>(null)
  const [justAdded, setJustAdded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // subscribe once — the main process pushes words whenever they're due
  useEffect(
    () =>
      window.study.onWord((w) => {
        setWord(w)
        setBusy(false)
        setError(null)
      }),
    []
  )

  // auto-file the shown word into the spaced-repetition deck
  useEffect(() => {
    if (!word) return
    setCardId(null)
    setJustAdded(false)
    if (!autoAdd) return
    const st = useStore.getState()
    const key = word.word.trim().toLowerCase()
    const existing = st.vocab.find((c) => c.word.trim().toLowerCase() === key)
    if (existing) {
      setCardId(existing.id)
      return
    }
    const created = st.addVocab({
      word: word.word,
      meaning: word.meaning,
      example: word.example,
      source: 'study',
      tags: word.cat ? [word.cat] : ['study']
    })
    if (created) {
      setCardId(created.id)
      setJustAdded(true)
    }
  }, [word, autoAdd])

  // Esc dismisses without grading
  useEffect(() => {
    if (!word) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setWord(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [word])

  const close = (): void => setWord(null)

  const request = async (): Promise<void> => {
    setError(null)
    setBusy(true)
    try {
      const w = await window.study.next()
      if (!w) setError('Could not reach the dictionary — check your connection.')
    } catch {
      setError('Could not reach the dictionary.')
    } finally {
      setBusy(false)
    }
  }

  const gotIt = (): void => {
    if (cardId) useStore.getState().gradeVocab(cardId, 'good')
    close()
  }

  const save = (): void => {
    if (!word) return
    if (!cardId) {
      const created = useStore.getState().addVocab({
        word: word.word,
        meaning: word.meaning,
        example: word.example,
        source: 'study',
        tags: word.cat ? [word.cat] : ['study']
      })
      if (created) useStore.getState().gradeVocab(created.id, 'good')
    }
    close()
  }

  const next = (): void => {
    close()
    void request()
  }

  const openDeck = (): void => {
    openTab('vocab', 'deck')
    close()
  }

  const isFav = word
    ? !!vocab.find((c) => c.word.trim().toLowerCase() === word.word.trim().toLowerCase())?.favourite
    : false

  const toggleFav = (): void => {
    if (!word) return
    const st = useStore.getState()
    const key = word.word.trim().toLowerCase()
    const existing = st.vocab.find((c) => c.word.trim().toLowerCase() === key)
    if (existing) {
      st.toggleFavourite(existing.id)
      return
    }
    // not in the deck yet (auto-save off) — filing it as a favourite does both
    const created = st.addVocab({
      word: word.word,
      meaning: word.meaning,
      example: word.example,
      source: 'study',
      tags: word.cat ? [word.cat] : ['study'],
      favourite: true
    })
    if (created) setCardId(created.id)
  }

  if (error && !word && !busy) {
    return (
      <div className="study-pop" role="alert">
        <div className="study-pop-head">
          <span className="study-pop-title">english words</span>
          <button className="study-x" onClick={() => setError(null)} title="Dismiss">
            ×
          </button>
        </div>
        <p className="study-meaning">{error}</p>
        <div className="study-actions">
          <button className="btn on" onClick={() => void request()}>
            Try again
          </button>
          <button className="study-link" onClick={openDeck}>
            open deck
          </button>
        </div>
      </div>
    )
  }

  if (busy && !word) {
    return (
      <div className="study-pop" role="status">
        <div className="study-pop-head">
          <span className="study-pop-title">english words</span>
        </div>
        <p className="study-meaning voc-muted">looking up a word…</p>
      </div>
    )
  }

  if (!word) return null

  const chip = word.cat ? word.cat.charAt(0).toUpperCase() + word.cat.slice(1) : ''
  const badge = word.kind === 'phrasal' ? 'phrasal verb' : ''

  return (
    <div className="study-pop" role="dialog" aria-live="polite">
      <div className="study-pop-head">
        {chip !== '' && <span className="study-chip">{chip}</span>}
        {badge !== '' && <span className="study-chip study-kind">{badge}</span>}
        <span className="study-pop-title">new word</span>
        <button
          className={`study-star${isFav ? ' on' : ''}`}
          onClick={toggleFav}
          title={isFav ? 'Remove from favourites' : 'Add to favourites'}
        >
          {isFav ? '★' : '☆'}
        </button>
        <button className="study-x" onClick={close} title="Dismiss (Esc)">
          ×
        </button>
      </div>

      <div className="study-word">
        {word.word}
        {word.ipa && <span className="study-ipa">{word.ipa}</span>}
        {word.pos && <span className="study-pos">{word.pos}</span>}
      </div>

      <p className="study-meaning">{word.meaning}</p>
      {word.example && <p className="study-example">“{word.example}”</p>}

      <div className="study-actions">
        {autoAdd ? (
          <button className="btn on" onClick={gotIt} title="Mark as known and hide">
            Got it{justAdded ? ' ✓' : ''}
          </button>
        ) : (
          <button className="btn on" onClick={save}>
            Add to deck
          </button>
        )}
        <button className="btn" onClick={next} title="Look up another word now">
          Next
        </button>
        <button className="study-link" onClick={openDeck}>
          open deck
        </button>
      </div>

      {autoAdd && justAdded && <div className="study-note">saved to your vocabulary deck</div>}
    </div>
  )
}
