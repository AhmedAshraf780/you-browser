import { useEffect, useMemo, useRef, useState } from 'react'
import { parseVocabFile, useStore } from '../store'
import { baseName, recentVaultFiles } from '../vault'
import { uid } from '../tabs'

/** Modal for capturing a word (from a page selection, the omnibox, or typed)
 *  into the global deck or any `.vocab` file in the vault. */
export function WordCapture({
  initialText,
  source,
  onClose
}: {
  initialText: string
  source: string
  onClose: () => void
}): JSX.Element {
  const tree = useStore((s) => s.tree)
  const addVocab = useStore((s) => s.addVocab)
  const refreshTree = useStore((s) => s.refreshTree)

  const decks = useMemo(
    () => recentVaultFiles(tree, ['.vocab'], 100).map((f) => f.path),
    [tree]
  )

  const [deck, setDeck] = useState('') // '' → global default deck
  const [word, setWord] = useState(initialText.trim().slice(0, 120))
  const [meaning, setMeaning] = useState('')
  const [example, setExample] = useState('')
  const [busy, setBusy] = useState(false)
  const meaningRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    // jump straight to filling the definition when a word is already supplied
    if (word) meaningRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = async (): Promise<void> => {
    const w = word.trim()
    if (!w || busy) return
    setBusy(true)
    try {
      if (!deck) {
        addVocab({ word: w, meaning, example, source })
      } else {
        const r = await window.vault.read(deck)
        const cards = parseVocabFile(r.data) ?? []
        cards.push({
          id: uid(),
          word: w.slice(0, 120),
          meaning: meaning.slice(0, 2000),
          example: example.slice(0, 2000),
          source: source.slice(0, 500),
          tags: [],
          srs: { ease: 2.5, interval: 0, due: Date.now(), reps: 0, lapses: 0 },
          createdAt: Date.now()
        })
        await window.vault.write(deck, JSON.stringify({ version: 1, name: baseName(deck), cards }, null, 2))
        await refreshTree()
      }
      onClose()
    } catch (e) {
      alert(`Could not save: ${e instanceof Error ? e.message : e}`)
      setBusy(false)
    }
  }

  return (
    <div className="voc-cap-overlay" onClick={onClose}>
      <div className="voc-cap" onClick={(e) => e.stopPropagation()}>
        <div className="voc-cap-head">
          <span>Add to vocabulary</span>
          <button className="voc-icon" onClick={onClose} title="Close">
            ×
          </button>
        </div>

        <label className="voc-cap-label">Word / phrase</label>
        <input
          className="voc-input"
          value={word}
          autoFocus={!word}
          onChange={(e) => setWord(e.target.value)}
          placeholder="e.g. resilient"
        />

        <label className="voc-cap-label">Meaning</label>
        <input
          ref={meaningRef}
          className="voc-input"
          value={meaning}
          onChange={(e) => setMeaning(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
          placeholder="what it means"
        />

        <label className="voc-cap-label">Example (optional)</label>
        <input
          className="voc-input"
          value={example}
          onChange={(e) => setExample(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
          placeholder="a sentence using it"
        />

        <label className="voc-cap-label">Deck</label>
        <select className="voc-input" value={deck} onChange={(e) => setDeck(e.target.value)}>
          <option value="">Default deck</option>
          {decks.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>

        {source && <div className="voc-cap-source" title={source}>source: {source.replace(/^https?:\/\//, '').slice(0, 70)}</div>}

        <div className="voc-cap-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn on" onClick={() => void save()} disabled={!word.trim() || busy}>
            {busy ? 'Saving…' : 'Add word'}
          </button>
        </div>
      </div>
    </div>
  )
}
