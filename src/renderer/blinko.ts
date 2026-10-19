/**
 * Blinko workspace model + `.blinko` file format.
 *
 * A Blinko workspace is a stream of quick note cards ("blinks") rendered as a
 * masonry board. Cards are plain Markdown; tags are hashtags written inline
 * (`#idea`, `#todo`) exactly like the Blinko app. The whole workspace is one
 * vault file, `{ version: 1, cards: [...] }`, autosaved like `.kanban`.
 */
import { uid } from './tabs'

export interface BlinkoCard {
  id: string
  /** Markdown source of the blink. */
  content: string
  /** Accent colour, '' for none. */
  color: string
  pinned: boolean
  /**
   * Manual position on the board, ascending. Pinned cards form their own group
   * above the rest, so an `order` only ever competes with same-pin neighbours —
   * which is what keeps "pinned" a stable top section while drag-reorder works
   * inside each group.
   */
  order: number
  createdAt: number
  updatedAt: number
}

/** Accent palette — the same hues the board/habits pickers use. */
export const BLINKO_COLORS = [
  '#7aa2f7',
  '#c4a7e7',
  '#7bd88f',
  '#fabd2f',
  '#ff6b6b',
  '#4da3ff',
  '#f7768e',
  '#9ece6a'
]

/** Workspace the sidebar "Blinko" button opens when none exists yet. */
export const DEFAULT_BLINKO_PATH = 'Blinko.blinko'

const MAX_CONTENT = 20_000
const COLOR_RE = /^#[0-9a-f]{3,8}$/i

/**
 * Blinko hashtags: `#word` with a boundary before the `#` so URLs/anchors and
 * markdown headings (`# heading`, note the space) never count. Code spans and
 * fenced blocks are stripped first.
 */
const TAG_RE = /(^|[\s([{'"`,>])#([A-Za-z0-9][A-Za-z0-9_-]*)/g

export function extractTags(markdown: string): string[] {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
  const out: string[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(TAG_RE)) {
    const tag = match[2]
    if (!tag) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  return out
}

function normalizeCard(raw: unknown): BlinkoCard | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.content !== 'string' || !o.content.trim()) return null
  const created = typeof o.createdAt === 'number' && Number.isFinite(o.createdAt) ? o.createdAt : Date.now()
  return {
    id: typeof o.id === 'string' && o.id ? o.id : uid(),
    content: o.content.slice(0, MAX_CONTENT),
    color: typeof o.color === 'string' && COLOR_RE.test(o.color) ? o.color.slice(0, 9) : '',
    pinned: o.pinned === true,
    // NaN marks "no manual position yet"; parseBlinkoFile fills those in from
    // the old (pinned, newest-first) ordering so existing boards don't jump.
    order: typeof o.order === 'number' && Number.isFinite(o.order) ? o.order : Number.NaN,
    createdAt: created,
    updatedAt: typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt) ? o.updatedAt : created
  }
}

/** Parse a `.blinko` file: `{ version, cards }` or a bare card array.
 *  Returns null on unreadable input so callers fall back to an empty board. */
export function parseBlinkoFile(text: string): BlinkoCard[] | null {
  try {
    const parsed: unknown = JSON.parse(text)
    const raw = Array.isArray(parsed) ? parsed : (parsed as { cards?: unknown }).cards
    if (!Array.isArray(raw)) return null
    const cards: BlinkoCard[] = []
    for (const c of raw.slice(0, 2000)) {
      const card = normalizeCard(c)
      if (card) cards.push(card)
    }
    // Files written before `order` existed (or hand-edited ones): fall back to
    // the historical sort — pinned first, then newest — so nothing moves.
    const missing = cards.filter((c) => Number.isNaN(c.order))
    if (missing.length > 0) {
      const known = cards.filter((c) => !Number.isNaN(c.order))
      const highest = known.reduce((max, c) => Math.max(max, c.order), -1)
      const legacy = [...missing].sort(
        (a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt
      )
      legacy.forEach((card, i) => {
        card.order = highest + 1 + i
      })
    }
    return cards
  } catch {
    return null
  }
}

export function serializeBlinkoFile(cards: BlinkoCard[]): string {
  return JSON.stringify({ version: 1, cards }, null, 2)
}

/** Pinned first, then the manual order; ties fall back to newest-first. */
export function orderCards(cards: BlinkoCard[]): BlinkoCard[] {
  return [...cards].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order || b.createdAt - a.createdAt
  )
}

/**
 * The `order` for a card that should sit above everything else — a brand-new
 * blink, or a card whose pin state just changed (so it lands at the top of its
 * new group). Always lower than every existing card, so ordering stays a pure
 * comparison with no renumbering needed.
 */
export function nextOrder(cards: BlinkoCard[], excludeId?: string): number {
  return cards.reduce((min, c) => (c.id === excludeId ? min : Math.min(min, c.order)), 0) - 1
}

/** Move `id` next to `targetId` (before it, or after) and renumber the board. */
export function moveCard(
  cards: BlinkoCard[],
  id: string,
  targetId: string,
  after: boolean
): BlinkoCard[] {
  const ordered = orderCards(cards)
  const moving = ordered.find((c) => c.id === id)
  const target = ordered.find((c) => c.id === targetId)
  // Different pin states live in different sections — dropping across the
  // boundary is a no-op rather than a card that silently jumps back.
  if (!moving || !target || moving.id === target.id || moving.pinned !== target.pinned) return cards
  const rest = ordered.filter((c) => c.id !== id)
  const at = rest.indexOf(target)
  if (at < 0) return cards
  const insertAt = after ? at + 1 : at
  const next = [...rest.slice(0, insertAt), moving, ...rest.slice(insertAt)]
  // Renumber to 0…n-1 in display order; the list is pinned-first, so the sort
  // key (pinned, order) reproduces exactly this sequence.
  return next.map((c, i) => (c.order === i ? c : { ...c, order: i }))
}
