/**
 * Live word sourcing. No baked-in vocabulary.
 *
 *  discover() — Datamuse turns the learner's *interests* into candidate words
 *               (`ml=` / `rel_trg=`) and, separately, `sp=* <particle>` yields
 *               live phrasal verbs (set up, give up…). Every hit carries a
 *               corpus-frequency tag; the level's frequency window filters them.
 *               Single words, lexical verbs and phrasal verbs are then
 *               round-robined so no part of speech dominates the feed.
 *  lookup()   — resolves a candidate to a real dictionary entry, trying
 *               Simple English Wiktionary (learner-register definitions),
 *               then Free Dictionary API, then Datamuse's own definitions.
 *
 * Everything is cached on disk (userData/word-cache.json) so a word is only
 * ever fetched once and repeat prompts are instant/offline-safe.
 */

import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { DEFAULT_STUDY, FREQ_BAND, type StudySettings, type WordEntry } from './study'

const UA = 'You/0.1 (English-study; offline-capable personal app)'
const CACHE_MAX = 2000

interface Candidate {
  word: string
  f: number
  pos: string
  interest: string
  proper: boolean
  kind: 'word' | 'verb' | 'phrasal'
}

/** Particles used to enumerate phrasal verbs from Datamuse (`sp=* up` …).
 *  This is grammar, not a vocabulary list — every resulting phrase is fetched
 *  live and level-filtered. */
const PARTICLES = [
  'up', 'out', 'off', 'on', 'in', 'down', 'back', 'away', 'over', 'through',
  'around', 'about', 'at', 'for', 'to', 'with', 'into', 'after', 'by', 'along',
  'upon', 'against', 'ahead', 'apart', 'aside'
]

/** Very explicit words are filtered out of a learner feed. Purely a guard —
 *  delete this line to disable it. */
const BLOCKED = /\b(fuck|fucking|shit|piss|cunt|cock|dick|bastard|bitch)\b/i

async function httpJson(
  url: string,
  headers?: Record<string, string>,
  timeoutMs = 7000
): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal })
    if (!res.ok) return null
    const text = await res.text()
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/* ── on-disk cache ────────────────────────────────────────────────────────── */

let cache: Record<string, WordEntry> | null = null

function cacheFile(): string {
  return join(app.getPath('userData'), 'word-cache.json')
}

async function ensureCache(): Promise<Record<string, WordEntry>> {
  if (cache) return cache
  try {
    const parsed = JSON.parse(await fs.readFile(cacheFile(), 'utf-8')) as Record<string, WordEntry>
    cache = parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    cache = {}
  }
  return cache
}

let saveQueued = false
function scheduleSave(): void {
  if (saveQueued) return
  saveQueued = true
  setTimeout(() => {
    saveQueued = false
    void (async () => {
      try {
        const c = cache ?? {}
        const keys = Object.keys(c)
        if (keys.length > CACHE_MAX) {
          for (const k of keys.slice(0, keys.length - CACHE_MAX)) delete c[k]
        }
        await fs.mkdir(app.getPath('userData'), { recursive: true })
        await fs.writeFile(cacheFile(), JSON.stringify(c), 'utf-8')
      } catch {
        // cache is best-effort
      }
    })()
  }, 400)
}

/* ── discovery: interests → candidate words ───────────────────────────────── */

function isInflection(word: string, pool: Set<string>): boolean {
  if (!/(ing|ed|ly|ies|es|s)$/.test(word)) return false
  const stems = [
    word.replace(/ies$/, 'y'),
    word.replace(/es$/, ''),
    word.replace(/s$/, ''),
    word.replace(/ing$/, ''),
    word.replace(/ed$/, ''),
    word.replace(/ly$/, '')
  ]
  return stems.some((s) => s.length >= 3 && s !== word && pool.has(s))
}

function keepCandidate(c: Candidate, level: StudySettings['level'], pool: Set<string>): boolean {
  if (!/^[a-z]+$/.test(c.word)) return false
  if (c.word.length < 4 || c.word.length > 12) return false
  if (c.proper || !c.pos) return false
  if (BLOCKED.test(c.word)) return false
  const [lo, hi] = FREQ_BAND[level]
  if (!(c.f >= lo && c.f < hi)) return false
  if (isInflection(c.word, pool)) return false
  return true
}

/** A phrasal verb: two or three lowercase words, tagged as a verb by Datamuse,
 *  inside the level's frequency window. */
function keepPhrasal(c: Candidate, level: StudySettings['level']): boolean {
  const parts = c.word.split(' ')
  if (parts.length < 2 || parts.length > 3) return false
  if (parts[0]!.length < 2) return false
  if (!parts.every((p) => /^[a-z]+$/.test(p))) return false
  if (c.proper || c.pos !== 'verb') return false
  if (BLOCKED.test(c.word)) return false
  const [lo, hi] = FREQ_BAND[level]
  return c.f >= lo && c.f < hi
}

function shuffle<T>(list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[list[i], list[j]] = [list[j] as T, list[i] as T]
  }
  return list
}

/** Round-robin the pools so the feed mixes phrasal verbs, verbs and nouns
 *  instead of draining the (much larger) noun pool first. */
function interleave(pools: Candidate[][]): Candidate[] {
  const out: Candidate[] = []
  const depth = Math.max(0, ...pools.map((p) => p.length))
  for (let i = 0; i < depth; i++) {
    for (const pool of pools) {
      const item = pool[i]
      if (item) out.push(item)
    }
  }
  return out
}

function parseDatamuse(json: unknown, interest: string, phrasal: boolean): Candidate[] {
  const out: Candidate[] = []
  if (!Array.isArray(json)) return out
  for (const raw of json as Array<Record<string, unknown>>) {
    const word = typeof raw['word'] === 'string' ? (raw['word'] as string) : ''
    if (!word) continue
    const tags = Array.isArray(raw['tags']) ? (raw['tags'] as string[]) : []
    const fTag = tags.find((t) => t.startsWith('f:'))
    const f = fTag ? Number(fTag.slice(2)) : 0
    const tag = tags.find((t) => t === 'n' || t === 'v' || t === 'adj' || t === 'adv') ?? ''
    const pos = tag === 'n' ? 'noun' : tag === 'v' ? 'verb' : tag
    out.push({
      word,
      f: Number.isFinite(f) ? f : 0,
      pos,
      interest,
      proper: tags.includes('prop'),
      kind: phrasal ? 'phrasal' : pos === 'verb' ? 'verb' : 'word'
    })
  }
  return out
}

/** Topical candidates: what the learner's interests are about. */
async function loadTopical(interests: string[]): Promise<Candidate[]> {
  const groups = await Promise.all(
    interests.map(async (interest): Promise<Candidate[]> => {
      const out: Candidate[] = []
      for (const url of [
        `https://api.datamuse.com/words?ml=${encodeURIComponent(interest)}&md=fp&max=1000`,
        `https://api.datamuse.com/words?rel_trg=${encodeURIComponent(interest)}&md=fp&max=300`
      ]) {
        out.push(...parseDatamuse(await httpJson(url, { 'User-Agent': UA }), interest, false))
      }
      return out
    })
  )
  const merged = new Map<string, Candidate>()
  for (const group of groups) for (const c of group) if (!merged.has(c.word)) merged.set(c.word, c)
  return [...merged.values()]
}

/** Phrasal verbs cost one Datamuse request *per particle*, so the raw pool is
 *  held in memory and reused across prompts rather than refetched each time. */
let phrasalPool: { at: number; items: Candidate[] } | null = null
const PHRASAL_TTL = 6 * 60 * 60_000

async function loadPhrasal(): Promise<Candidate[]> {
  if (phrasalPool && Date.now() - phrasalPool.at < PHRASAL_TTL) return phrasalPool.items
  const groups = await Promise.all(
    PARTICLES.map((p) =>
      httpJson(`https://api.datamuse.com/words?sp=*%20${p}&md=fp&max=100`, {
        'User-Agent': UA
      }).then((json) => parseDatamuse(json, '', true))
    )
  )
  const merged = new Map<string, Candidate>()
  for (const group of groups) for (const c of group) if (!merged.has(c.word)) merged.set(c.word, c)
  phrasalPool = { at: Date.now(), items: [...merged.values()] }
  return phrasalPool.items
}

async function discover(study: StudySettings): Promise<Candidate[]> {
  const interests = study.interests.length ? study.interests : DEFAULT_STUDY.interests
  const [topical, phrasal] = await Promise.all([loadTopical(interests), loadPhrasal()])

  const pool = new Set(topical.map((c) => c.word))
  const kept = topical.filter((c) => keepCandidate(c, study.level, pool))

  const phrasals = shuffle(phrasal.filter((c) => keepPhrasal(c, study.level)))
  const verbs = shuffle(kept.filter((c) => c.kind === 'verb'))
  const words = shuffle(kept.filter((c) => c.kind !== 'verb'))

  // mix the three kinds so the feed isn't noun-dominated
  return interleave([phrasals, verbs, words])
}

/* ── content providers ────────────────────────────────────────────────────── */

/** Grammar/usage labels that open a definition and carry no meaning for a
 *  learner. Matched as a stack, e.g. "(transitive, also reflexive)", while
 *  domain labels like "(computing)" are left intact. */
const LABEL_TERM =
  'not comparable|countable|uncountable|transitive|intransitive|reflexive|idiomatic|figurative|literally|usually|chiefly|mainly|generally|especially|often|sometimes|attributive|predicative|comparable|progressive|informal|formal|slang|dated|archaic|obsolete|rare|proscribed|nonstandard|historical|poetic|plural|singular|also|British|American'

const GRAMMAR_LABEL = new RegExp(
  `^\\s*\\((?:${LABEL_TERM})(?:\\s*[&,]\\s*(?:${LABEL_TERM}))*\\)\\s*`,
  'i'
)

/** Wiktionary meta-senses that define nothing ("Used other than figuratively…:
 *  see give, up") — common as the *first* sense of phrasal verbs. */
const META_SENSE =
  /\b(used other than figuratively|alternative form of|alternative spelling of|misspelling of|abbreviation of|initialism of|synonym of|eye dialect of)\b/i

/** Leading usage labels marking a sense as not worth teaching. */
const DATED_LABEL =
  /^\s*\([^)]*\b(obsolete|archaic|dated|rare|nonstandard|proscribed|historical|poetic)\b[^)]*\)/i

function cleanText(s: string): string {
  let t = s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
  while (GRAMMAR_LABEL.test(t)) t = t.replace(GRAMMAR_LABEL, '').trim()
  t = t.replace(/^[#*:\s-]+/, '').trim()
  // Wiktionary-style tail lists ("… people. Synonyms: a, b; Antonyms: c")
  return t.replace(/\s*\b(?:Synonym|Antonym|Related terms|See also|Derived terms)s?:.*$/i, '').trim()
}

function shortPos(pos: string): string {
  const p = pos.toLowerCase()
  if (p.startsWith('noun')) return 'noun'
  if (p.startsWith('verb')) return 'verb'
  if (p.startsWith('adj')) return 'adj'
  if (p.startsWith('adv')) return 'adv'
  if (p === 'n') return 'noun'
  if (p === 'v') return 'verb'
  return p
}

/** Simple English Wiktionary — definitions written in learner-friendly English. */
async function fromSimpleWiktionary(word: string, preferPos?: string): Promise<WordEntry | null> {
  const url =
    `https://simple.wiktionary.org/w/api.php?action=query&prop=extracts&explaintext=1` +
    `&redirects=1&format=json&titles=${encodeURIComponent(word)}`
  const json = (await httpJson(url, { 'User-Agent': UA })) as
    | { query?: { pages?: Record<string, { extract?: string; missing?: unknown }> } }
    | null
  const pages = json?.query?.pages
  if (!pages) return null
  const page = Object.values(pages)[0]
  if (!page || page.missing !== undefined || !page.extract) return null

  const text = page.extract
  const ipaMatch = text.match(/IPA[^\n]*?(\/[^/\n]+?\/)/)
  const headingRe =
    /^==+\s*(Noun|Verb|Adjective|Adverb|Preposition|Pronoun|Conjunction|Determiner|Interjection|Phrase)\s*==+/gim
  const matches = [...text.matchAll(headingRe)]

  const sections = matches.map((m, i) => ({
    pos: shortPos(m[1] ?? ''),
    body: text.slice(
      (m.index ?? 0) + m[0].length,
      i + 1 < matches.length ? matches[i + 1]?.index : undefined
    )
  }))
  const chosen = (preferPos && sections.find((s) => s.pos === preferPos)) || sections[0]

  let meaning = ''
  let example = ''
  if (chosen) {
    const lines = chosen.body.split('\n').map((l) => l.trim())
    let seenDef = false
    for (const line of lines) {
      if (!line) continue
      if (/^=+/.test(line)) break
      if (!seenDef) {
        meaning = line
        seenDef = true
        continue
      }
      // the line right after a definition is usually an example sentence
      if (/^[A-Z"']/.test(line) && !line.startsWith('(') && line.split(' ').length >= 4) {
        example = line
      }
      break
    }
  }

  const cleaned = cleanText(meaning)
  if (!cleaned) return null
  return {
    word,
    ipa: ipaMatch ? ipaMatch[1] : '',
    pos: chosen?.pos ?? '',
    meaning: cleaned.slice(0, 260),
    example: cleanText(example).slice(0, 200),
    cat: ''
  }
}

/** Free Dictionary API (Wiktionary-derived), gives IPA + examples. */
async function fromFreeDictionary(word: string, preferPos?: string): Promise<WordEntry | null> {
  const json = (await httpJson(
    `https://freedictionaryapi.com/api/v1/entries/en/${encodeURIComponent(word)}`,
    { 'User-Agent': UA }
  )) as
    | {
        entries?: Array<{
          language?: { code?: string }
          partOfSpeech?: string
          pronunciations?: Array<{ type?: string; text?: string }>
          senses?: Array<{ definition?: string; examples?: Array<string | { text?: string }> }>
        }>
      }
    | null

  const english = (json?.entries || []).filter((e) => e.language?.code === 'en')
  if (!english.length) return null
  const entry = (preferPos && english.find((e) => shortPos(e.partOfSpeech ?? '') === preferPos)) || english[0]
  if (!entry) return null

  const ipa = (entry.pronunciations || []).find((p) => p.type === 'ipa')?.text ?? ''
  const senses = (entry.senses || [])
    .map((s) => {
      const raw = s.definition ?? ''
      const def = cleanText(raw)
      return {
        raw,
        def,
        ex:
          (s.examples || [])
            .map((e) => (typeof e === 'string' ? e : e.text ?? ''))
            .map(cleanText)
            .find((x) => x.length > 8) ?? '',
        paren: /\(/.test(def)
      }
    })
    .filter((s) => s.def.length > 8 && !META_SENSE.test(s.raw) && !DATED_LABEL.test(s.raw))

  if (!senses.length) return null
  senses.sort(
    (a, b) =>
      Number(a.paren) - Number(b.paren) ||
      Number(a.ex === '') - Number(b.ex === '') ||
      a.def.length - b.def.length
  )
  const best = senses[0] as (typeof senses)[number]

  return {
    word,
    ipa,
    pos: shortPos(entry.partOfSpeech ?? ''),
    meaning: best.def.slice(0, 260),
    example: (best.ex ?? '').slice(0, 200),
    cat: ''
  }
}

/** Datamuse definitions — last resort, no IPA. */
async function fromDatamuse(word: string, _preferPos?: string): Promise<WordEntry | null> {
  const json = (await httpJson(
    `https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&md=dp&max=1`,
    { 'User-Agent': UA }
  )) as Array<{ defs?: string[]; tags?: string[] }> | null
  const first = Array.isArray(json) ? json[0] : null
  const raw = first?.defs?.[0]
  if (!raw) return null
  const [tag, ...rest] = raw.split('\t')
  const meaning = cleanText(rest.join(' '))
  if (!meaning) return null
  return {
    word,
    ipa: '',
    pos: shortPos(tag ?? ''),
    meaning: meaning.slice(0, 260),
    example: '',
    cat: ''
  }
}

const PROVIDERS = [fromSimpleWiktionary, fromFreeDictionary, fromDatamuse]

/** Dictionaries describe inflections with a pointer ("the past participle of
 *  speak") rather than a meaning. Those are not worth learning as headwords, so
 *  a pointer makes the whole word unusable and the caller tries the next one. */
const FORM_OF = /\b(present participle|past participle|simple past|past tense|third-person singular|plural of|form of)\b/i

async function lookup(word: string, preferPos = ''): Promise<WordEntry | null> {
  const c = await ensureCache()
  const hit = c[word]
  if (hit && hit.meaning) return hit
  for (const provider of PROVIDERS) {
    try {
      const entry = await provider(word, preferPos)
      if (entry && entry.meaning) {
        if (FORM_OF.test(entry.meaning) || META_SENSE.test(entry.meaning)) return null
        c[word] = entry
        scheduleSave()
        return entry
      }
    } catch {
      // try the next provider
    }
  }
  return null
}

/* ── public entry point ───────────────────────────────────────────────────── */

/** Produce one fresh, level-appropriate word. Returns null only when the
 *  network is unreachable *and* nothing has been cached yet. */
export async function fetchWord(study: StudySettings): Promise<WordEntry | null> {
  const c = await ensureCache()
  const seen = new Set(study.seen)

  const candidates = await discover(study)
  const fresh = candidates.filter((x) => !seen.has(x.word))

  // a handful of attempts covers words with no dictionary entry
  for (const cand of fresh.slice(0, 12)) {
    const entry = await lookup(cand.word, cand.pos)
    if (!entry || !entry.meaning) continue
    // Datamuse sometimes tags a noun 'v'; trust the dictionary's part of speech
    const kind = cand.kind === 'verb' && entry.pos !== 'verb' ? 'word' : cand.kind
    return { ...entry, cat: cand.interest, kind }
  }

  // offline / exhausted: reuse anything cached that hasn't been shown this cycle
  const cached = Object.values(c).filter((e) => e.meaning && !seen.has(e.word))
  if (cached.length) {
    const pick = cached[Math.floor(Math.random() * cached.length)] as WordEntry
    return { ...pick, kind: pick.kind ?? 'word' }
  }
  return null
}
