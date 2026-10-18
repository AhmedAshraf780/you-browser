/**
 * English study system — types and settings.
 *
 * The learner's words are NOT stored in code. They are discovered live from
 * Datamuse (which returns topical words together with a word-frequency tag)
 * and defined live by Simple English Wiktionary / Free Dictionary API, then
 * cached locally. See wordsource.ts for the fetching pipeline.
 *
 * What lives here is only *configuration*: how often to prompt, which level
 * band to aim at, and which interests to search around. Nothing here contains
 * a vocabulary list.
 */

export type Level = 'A2' | 'B1' | 'B2' | 'C1'

/** What kind of item this is — single word, lexical verb, or phrasal verb. */
export type WordKind = 'word' | 'verb' | 'phrasal'

export interface WordEntry {
  word: string
  ipa: string
  pos: string
  meaning: string
  example: string
  /** the interest/seed this word was discovered from */
  cat: string
  /** word / verb / phrasal verb (absent on legacy cached entries) */
  kind?: WordKind
}

export interface StudySettings {
  enabled: boolean
  /** minutes between prompts */
  intervalMin: number
  level: Level
  /** free-text interests used as live search seeds — editable by the learner */
  interests: string[]
  autoAdd: boolean
  /** words already shown; skipped so a prompt is always new */
  seen: string[]
}

export const DEFAULT_STUDY: StudySettings = {
  enabled: true,
  intervalMin: 10,
  level: 'B1',
  interests: ['programming', 'lifestyle', 'conversation'],
  autoAdd: true,
  seen: []
}

export const LEVELS: Level[] = ['A2', 'B1', 'B2', 'C1']

/** Level is approximated by corpus frequency (occurrences per million).
 *  Commoner words sit lower on CEFR; this maps each level to a frequency
 *  window, which is how we keep the feed near the learner's band. */
export const FREQ_BAND: Record<Level, [number, number]> = {
  A2: [40, Number.POSITIVE_INFINITY],
  B1: [4, 40],
  B2: [0.7, 4],
  C1: [0.1, 0.7]
}

export function normalizeStudy(raw: unknown): StudySettings {
  const o = (raw ?? {}) as Record<string, unknown>

  const level: Level =
    o.level === 'A2' || o.level === 'B1' || o.level === 'B2' || o.level === 'C1'
      ? o.level
      : DEFAULT_STUDY.level

  const interval =
    typeof o.intervalMin === 'number' && Number.isFinite(o.intervalMin) && o.intervalMin >= 1
      ? Math.min(240, Math.round(o.intervalMin))
      : DEFAULT_STUDY.intervalMin

  const interests = Array.isArray(o.interests)
    ? o.interests
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim().toLowerCase().replace(/[^a-z0-9 -]/g, ''))
        .filter(Boolean)
        .slice(0, 12)
    : []

  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : DEFAULT_STUDY.enabled,
    intervalMin: interval,
    level,
    interests: interests.length ? interests : [...DEFAULT_STUDY.interests],
    autoAdd: typeof o.autoAdd === 'boolean' ? o.autoAdd : DEFAULT_STUDY.autoAdd,
    seen: Array.isArray(o.seen) ? o.seen.filter((s): s is string => typeof s === 'string').slice(-1000) : []
  }
}
