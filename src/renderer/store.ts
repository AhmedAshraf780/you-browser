import { create } from 'zustand'
import { Tab, TabType, titleFor, uid } from './tabs'
import { TreeNode } from './vault'

export type ThemeId =
  | 'abyss' | 'immortal' | 'rose-pine' | 'catppuccin' | 'gruvbox' | 'tokyo-night'
  | 'dracula' | 'nord' | 'everforest' | 'solarized' | 'ayu' | 'wallpaper'
export type ColorMode = 'dark' | 'light'
export type SidebarSide = 'left' | 'right'

/** The derived stylesheet for the "wallpaper" theme, one map per mode. */
export interface WallpaperTheme {
  dark: Record<string, string>
  light: Record<string, string>
}

/** Where the wallpaper theme's image came from. */
export interface WallpaperSource {
  path: string
  name: string
  /** kde-slideshow | kde | gnome | manual */
  via: string
  /** changes whenever the image does — also cache-busts you-wall:// */
  token: string
  /** user-chosen image rather than the auto-detected desktop one */
  manual: boolean
  /** diagnostics: how many wallpaper changes main has followed this session */
  changes?: number
}

/** The desktop wallpaper the "wallpaper" theme takes its colours from. */
export interface WallpaperState extends WallpaperSource {
  /** null until the image has been decoded */
  theme: WallpaperTheme | null
  /** set when the image couldn't be read */
  error: string | null
}

function stored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

export type PanelId = 'vault' | 'kanban' | 'calendar' | 'settings'

export interface BoardCard {
  id: string
  title: string
  createdAt: number
}

export interface BoardColumn {
  id: string
  title: string
  cards: BoardCard[]
}

const DEFAULT_BOARD: BoardColumn[] = [
  { id: 'backlog', title: 'Backlog', cards: [] },
  { id: 'todo', title: 'To Do', cards: [] },
  { id: 'doing', title: 'In Progress', cards: [] },
  { id: 'done', title: 'Done', cards: [] }
]

function loadBoard(): BoardColumn[] {
  const raw = loadJSON<BoardColumn[]>('ub.kanban', [])
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_BOARD
  const clean = raw
    .filter((c) => c && typeof c.id === 'string' && typeof c.title === 'string' && Array.isArray(c.cards))
    .map((c) => ({
      id: c.id,
      title: c.title.slice(0, 40),
      cards: c.cards
        .filter((k) => k && typeof k.id === 'string' && typeof k.title === 'string')
        .map((k) => ({ id: k.id, title: k.title, createdAt: typeof k.createdAt === 'number' ? k.createdAt : 0 }))
        .slice(0, 200)
    }))
    .filter((c) => c.title.length > 0)
  if (clean.length === 0) return DEFAULT_BOARD
  // migrate pre-Backlog boards
  if (!clean.some((c) => c.title.toLowerCase() === 'backlog')) {
    clean.unshift({ id: 'backlog', title: 'Backlog', cards: [] })
  }
  return clean
}

function persistBoard(board: BoardColumn[]): { board: BoardColumn[] } {
  saveJSON('ub.kanban', board)
  return { board }
}

/** Fresh starter columns for a brand-new board (global default + new files). */
export function freshBoard(): BoardColumn[] {
  return [
    { id: uid(), title: 'Backlog', cards: [] },
    { id: uid(), title: 'To Do', cards: [] },
    { id: uid(), title: 'In Progress', cards: [] },
    { id: uid(), title: 'Done', cards: [] }
  ]
}

export interface Visit {
  url: string
  title: string
  at: number
}

function originOf(url: string): string {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}`
  } catch {
    return url
  }
}

/** One entry per site (origin) — youtube.com/watch?v=a and /watch?v=b collapse. */
function dedupeVisits(list: Visit[]): Visit[] {
  const seen = new Set<string>()
  const out: Visit[] = []
  for (const v of list) {
    const key = originOf(v.url)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out
}

export interface Todo {
  id: string
  text: string
  done: boolean
  createdAt: number
}

/* ─── Vocabulary / spaced repetition ─────────────────────────────────────── */

export type SrsGrade = 'again' | 'hard' | 'good' | 'easy'

export interface SrsState {
  /** SM-2 ease factor, clamped 1.3–3.2 */
  ease: number
  /** current interval in days */
  interval: number
  /** next review, epoch ms */
  due: number
  reps: number
  lapses: number
}

export interface VocabCard {
  id: string
  word: string
  meaning: string
  example: string
  /** where the word came from (page URL / note path) */
  source: string
  tags: string[]
  srs: SrsState
  createdAt: number
  /** starred by the learner */
  favourite?: boolean
}

export interface VocabDraft {
  word: string
  meaning?: string
  example?: string
  source?: string
  tags?: string[]
  favourite?: boolean
}

/* ─── Study (system-fed word reminders) ──────────────────────────────────── */

export type StudyLevel = 'A2' | 'B1' | 'B2' | 'C1'

export interface StudySettings {
  enabled: boolean
  intervalMin: number
  level: StudyLevel
  /** free-text interests used as live dictionary search seeds */
  interests: string[]
  autoAdd: boolean
}

export const STUDY_LEVELS: StudyLevel[] = ['A2', 'B1', 'B2', 'C1']

export const DEFAULT_STUDY_UI: StudySettings = {
  enabled: true,
  intervalMin: 10,
  level: 'B1',
  interests: ['programming', 'lifestyle', 'conversation'],
  autoAdd: true
}

const DAY = 86_400_000

export function newSrs(now = Date.now()): SrsState {
  return { ease: 2.5, interval: 0, due: now, reps: 0, lapses: 0 }
}

/** SM-2 style scheduler. "again" re-queues in 10 minutes, the rest grow the
 *  interval through ease. Grade it honestly and the deck self-tunes. */
export function schedule(srs: SrsState, grade: SrsGrade, now = Date.now()): SrsState {
  let { ease, interval, reps, lapses } = srs
  ease = Math.min(3.2, Math.max(1.3, ease))
  if (grade === 'again') {
    return { ease: Math.max(1.3, ease - 0.2), interval: 0, reps: 0, lapses: lapses + 1, due: now + 10 * 60_000 }
  }
  if (grade === 'hard') ease = Math.max(1.3, ease - 0.15)
  else if (grade === 'easy') ease = Math.min(3.2, ease + 0.15)
  reps += 1
  if (reps === 1) interval = grade === 'easy' ? 3 : 1
  else if (reps === 2) interval = grade === 'easy' ? 8 : grade === 'hard' ? 3 : 6
  else interval = Math.max(1, Math.round(interval * ease * (grade === 'hard' ? 0.7 : 1)))
  return { ease, interval, reps, lapses, due: now + interval * DAY }
}

/** First learning step, in human terms — shown on the review card. */
export function dueLabel(due: number, now = Date.now()): string {
  const d = due - now
  if (d <= 0) return 'now'
  if (d < 60 * 60_000) return `${Math.max(1, Math.round(d / 60_000))}m`
  if (d < DAY) return `${Math.round(d / 3_600_000)}h`
  if (d < 30 * DAY) return `${Math.round(d / DAY)}d`
  return `${Math.round(d / (30 * DAY))}mo`
}

function normalizeSrs(raw: unknown): SrsState {
  const o = (raw ?? {}) as Record<string, unknown>
  const num = (v: unknown, fb: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fb)
  return {
    ease: Math.min(3.2, Math.max(1.3, num(o.ease, 2.5))),
    interval: Math.max(0, num(o.interval, 0)),
    due: num(o.due, Date.now()),
    reps: Math.max(0, num(o.reps, 0)),
    lapses: Math.max(0, num(o.lapses, 0))
  }
}

function normalizeVocabCard(raw: unknown): VocabCard | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.word !== 'string' || !o.word.trim()) return null
  return {
    id: typeof o.id === 'string' && o.id ? o.id : uid(),
    word: o.word.slice(0, 120),
    meaning: typeof o.meaning === 'string' ? o.meaning.slice(0, 2000) : '',
    example: typeof o.example === 'string' ? o.example.slice(0, 2000) : '',
    source: typeof o.source === 'string' ? o.source.slice(0, 500) : '',
    tags: Array.isArray(o.tags) ? o.tags.filter((t) => typeof t === 'string').slice(0, 10) : [],
    srs: normalizeSrs(o.srs),
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : Date.now(),
    favourite: o.favourite === true
  }
}

/** Parse a `.vocab` file: `{ version, name, cards }` or a bare card array.
 *  Returns null on unreadable input so callers can fall back. */
export function parseVocabFile(text: string): VocabCard[] | null {
  try {
    const parsed: unknown = JSON.parse(text)
    const raw = Array.isArray(parsed) ? parsed : (parsed as { cards?: unknown }).cards
    if (!Array.isArray(raw)) return null
    const cards: VocabCard[] = []
    for (const c of raw.slice(0, 5000)) {
      const card = normalizeVocabCard(c)
      if (card) cards.push(card)
    }
    return cards
  } catch {
    return null
  }
}

function loadVocab(): VocabCard[] {
  const raw = loadJSON<unknown[]>('ub.vocab', [])
  if (!Array.isArray(raw)) return []
  const cards: VocabCard[] = []
  for (const c of raw.slice(0, 5000)) {
    const card = normalizeVocabCard(c)
    if (card) cards.push(card)
  }
  return cards
}

function persistVocab(vocab: VocabCard[]): { vocab: VocabCard[] } {
  saveJSON('ub.vocab', vocab)
  return { vocab }
}

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function saveJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // private mode — persistence skipped
  }
}

interface BrowserState {
  tabs: Tab[]
  activeId: string | null
  tree: TreeNode[]
  omnibox: string
  vaultPath: string
  adsEnabled: boolean
  theme: ThemeId
  mode: ColorMode
  sidebarOpen: boolean
  sidebarSide: SidebarSide
  panel: PanelId
  panelOpen: boolean
  termFontSize: number
  splitTabId: string | null
  vimMode: boolean
  visits: Visit[]
  todos: Todo[]
  board: BoardColumn[]
  vocab: VocabCard[]
  study: StudySettings
  dayNotes: Record<string, string>
  wallpaper: WallpaperState | null
  openTab: (type: TabType, target: string) => void
  closeTab: (id: string) => void
  setActive: (id: string) => void
  updateTab: (id: string, patch: Partial<Tab>) => void
  setTree: (tree: TreeNode[]) => void
  refreshTree: () => Promise<void>
  setOmnibox: (v: string) => void
  setVaultPath: (v: string) => void
  setAdsEnabled: (v: boolean) => void
  setTheme: (v: ThemeId) => void
  setMode: (v: ColorMode) => void
  toggleSidebar: () => void
  setSidebarSide: (v: SidebarSide) => void
  setPanel: (v: PanelId) => void
  setPanelOpen: (v: boolean) => void
  setTermFontSize: (v: number) => void
  setSplitTabId: (v: string | null) => void
  swapSplit: () => void
  setVimMode: (v: boolean) => void
  clearVisits: () => void
  recordVisit: (url: string, title: string) => void
  retitleVisit: (url: string, title: string) => void
  addTodo: (text: string) => void
  toggleTodo: (id: string) => void
  removeTodo: (id: string) => void
  clearDone: () => void
  addCard: (colId: string, title: string) => void
  moveCard: (cardId: string, toColId: string) => void
  updateCard: (colId: string, cardId: string, title: string) => void
  deleteCard: (colId: string, cardId: string) => void
  addColumn: (title: string) => void
  renameColumn: (colId: string, title: string) => void
  deleteColumn: (colId: string) => void
  setDayNote: (key: string, text: string) => void
  addVocab: (draft: VocabDraft) => VocabCard | null
  updateVocab: (id: string, patch: Partial<Omit<VocabCard, 'id' | 'createdAt' | 'srs'>>) => void
  deleteVocab: (id: string) => void
  gradeVocab: (id: string, grade: SrsGrade) => void
  toggleFavourite: (id: string) => void
  setStudy: (patch: Partial<StudySettings>) => void
  hydrateStudy: () => Promise<void>
  setWallpaper: (v: WallpaperSource | null) => void
  patchWallpaper: (patch: Partial<WallpaperState>) => void
}

const seed: Tab[] = [{ id: uid(), type: 'home', title: 'Home', target: 'home' }]

const VALID_TYPES: TabType[] = ['web', 'markdown', 'excalidraw', 'pdf', 'home', 'kanban', 'calendar', 'terminal', 'vocab']

function validTab(t: unknown): t is Tab {
  if (!t || typeof t !== 'object') return false
  const o = t as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.target === 'string' &&
    typeof o.title === 'string' &&
    (VALID_TYPES as string[]).includes(o.type as string)
  )
}

interface PersistedSession {
  tabs: Tab[]
  activeId: string | null
  splitTabId: string | null
}

function loadSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem('ub.tabs')
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedSession>
    if (!Array.isArray(parsed.tabs)) return null
    const tabs = parsed.tabs.filter(validTab).slice(0, 30)
    if (tabs.length === 0) return null
    const ids = new Set(tabs.map((t) => t.id))
    const activeId = typeof parsed.activeId === 'string' && ids.has(parsed.activeId) ? parsed.activeId : tabs[0].id
    const splitTabId =
      typeof parsed.splitTabId === 'string' && ids.has(parsed.splitTabId) && parsed.splitTabId !== activeId
        ? parsed.splitTabId
        : null
    return { tabs, activeId, splitTabId }
  } catch {
    return null
  }
}

function persistSession(s: { tabs: Tab[]; activeId: string | null; splitTabId: string | null }): void {
  try {
    localStorage.setItem('ub.tabs', JSON.stringify({ tabs: s.tabs, activeId: s.activeId, splitTabId: s.splitTabId }))
  } catch {
    // private mode — session just won't restore
  }
}

export const useStore = create<BrowserState>((set) => {
  const restored = loadSession()
  return {
  tabs: restored?.tabs ?? seed,
  activeId: restored?.activeId ?? seed[0]?.id ?? null,
  splitTabId: restored?.splitTabId ?? null,
  vimMode: stored('ub.vim', '0') === '1',
  tree: [],
  omnibox: '',
  vaultPath: '',
  adsEnabled: true,
  theme: ((): ThemeId => {
    const t = stored('ub.theme', 'abyss')
    return t === 'abyss' || t === 'immortal' || t === 'rose-pine' || t === 'catppuccin' || t === 'gruvbox' || t === 'tokyo-night'
      || t === 'dracula' || t === 'nord' || t === 'everforest' || t === 'solarized' || t === 'ayu' || t === 'wallpaper'
      ? (t as ThemeId)
      : 'abyss'
  })(),
  mode: (stored('ub.mode', 'dark') === 'light' ? 'light' : 'dark') as ColorMode,
  sidebarOpen: stored('ub.sidebar', '1') !== '0',
  sidebarSide: (stored('ub.sidebarSide', 'left') === 'right' ? 'right' : 'left') as SidebarSide,
  panelOpen: stored('ub.panelOpen', '1') !== '0',
  termFontSize: ((): number => {
    const n = parseInt(stored('ub.termZoom', '14'), 10)
    return Number.isFinite(n) ? Math.min(30, Math.max(8, n)) : 14
  })(),
  panel: ((): PanelId => {
    const p = stored('ub.panel', 'vault')
    return p === 'settings' ? (p as PanelId) : 'vault'
  })(),
  board: loadBoard(),
  vocab: loadVocab(),
  study: { ...DEFAULT_STUDY_UI },
  wallpaper: null,
  dayNotes: ((): Record<string, string> => {
    const raw = loadJSON<Record<string, string>>('ub.daynotes', {})
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw).slice(0, 1000)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && typeof v === 'string' && v.trim()) {
        out[k] = v.slice(0, 20000)
      }
    }
    return out
  })(),
  visits: dedupeVisits(
    loadJSON<Visit[]>('ub.visits', []).filter((v) => v && typeof v.url === 'string')
  ).slice(0, 30),
  todos: loadJSON<Todo[]>('ub.todos', [])
    .filter((t) => t && typeof t.text === 'string' && typeof t.id === 'string')
    .slice(0, 200),
  openTab: (type, target) =>
    set((s) => {
      // reuse existing tab with same target
      const existing = s.tabs.find((t) => t.type === type && t.target === target)
      if (existing) {
        const next = { ...s, activeId: existing.id }
        persistSession(next)
        return next
      }
      const tab: Tab = { id: uid(), type, title: titleFor(type, target), target }
      const next = { tabs: [...s.tabs, tab], activeId: tab.id, omnibox: target }
      persistSession({ tabs: next.tabs, activeId: next.activeId, splitTabId: s.splitTabId })
      return next
    }),
  closeTab: (id) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id)
      const tabs = s.tabs.filter((t) => t.id !== id)
      let activeId = s.activeId
      if (activeId === id) {
        activeId = tabs[Math.max(0, idx - 1)]?.id ?? null
      }
      const splitTabId = s.splitTabId === id ? null : s.splitTabId
      persistSession({ tabs, activeId, splitTabId })
      return { tabs, activeId, splitTabId }
    }),
  setActive: (id) =>
    set((s) => {
      const next = {
        activeId: id,
        omnibox: s.tabs.find((t) => t.id === id)?.target ?? s.omnibox
      }
      persistSession({ tabs: s.tabs, activeId: next.activeId, splitTabId: s.splitTabId })
      return next
    }),
  setSplitTabId: (splitTabId) =>
    set((s) => {
      persistSession({ tabs: s.tabs, activeId: s.activeId, splitTabId })
      return { splitTabId }
    }),
  swapSplit: () =>
    set((s) => {
      if (!s.splitTabId || !s.activeId) return {}
      const next = { activeId: s.splitTabId, splitTabId: s.activeId }
      persistSession({ tabs: s.tabs, activeId: next.activeId, splitTabId: next.splitTabId })
      return next
    }),
  setVimMode: (vimMode) =>
    set(() => {
      try {
        localStorage.setItem('ub.vim', vimMode ? '1' : '0')
      } catch {
        // ignore
      }
      return { vimMode }
    }),
  updateTab: (id, patch) =>
    set((s) => {
      const tabs = s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t))
      persistSession({ tabs, activeId: s.activeId, splitTabId: s.splitTabId })
      return { tabs }
    }),
  setTree: (tree) => set({ tree }),
  refreshTree: (() => {
    // Autosaves fire chokidar on every keystroke pause; collapse the
    // resulting refresh storms into one trailing rebuild (leading edge
    // stays instant so first paint never waits).
    let timer: ReturnType<typeof setTimeout> | null = null
    let last = 0
    const run = async (): Promise<void> => {
      last = Date.now()
      try {
        set({ tree: await window.vault.tree() })
      } catch {
        set({ tree: [] })
      }
    }
    return async () => {
      if (!timer && Date.now() - last > 400) {
        await run()
        return
      }
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void run()
      }, 400)
    }
  })(),
  setOmnibox: (omnibox) => set({ omnibox }),
  setVaultPath: (vaultPath) => set({ vaultPath }),
  setAdsEnabled: (adsEnabled) => set({ adsEnabled }),
  setTheme: (theme) => set({ theme }),
  setMode: (mode) => set({ mode }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarSide: (sidebarSide) =>
    set(() => {
      try {
        localStorage.setItem('ub.sidebarSide', sidebarSide)
      } catch {
        // ignore
      }
      return { sidebarSide }
    }),
  setPanelOpen: (panelOpen) =>
    set(() => {
      try {
        localStorage.setItem('ub.panelOpen', panelOpen ? '1' : '0')
      } catch {
        // ignore
      }
      return { panelOpen }
    }),
  setTermFontSize: (n) =>
    set(() => {
      const termFontSize = Math.min(30, Math.max(8, Math.round(n)))
      try {
        localStorage.setItem('ub.termZoom', String(termFontSize))
      } catch {
        // ignore
      }
      return { termFontSize }
    }),
  setPanel: (panel) =>
    set(() => {
      try {
        localStorage.setItem('ub.panel', panel)
      } catch {
        // ignore
      }
      return { panel }
    }),
  clearVisits: () =>
    set(() => {
      saveJSON('ub.visits', [])
      return { visits: [] }
    }),
  recordVisit: (url, title) =>
    set((s) => {
      const origin = originOf(url)
      const visits = [{ url, title: title || url, at: Date.now() }, ...s.visits.filter((v) => originOf(v.url) !== origin)].slice(0, 30)
      saveJSON('ub.visits', visits)
      return { visits }
    }),
  retitleVisit: (url, title) =>
    set((s) => {
      const i = s.visits.findIndex((v) => v.url === url)
      if (i < 0) return {}
      const visits = s.visits.map((v, j) => (j === i ? { ...v, title } : v))
      saveJSON('ub.visits', visits)
      return { visits }
    }),
  addTodo: (text) =>
    set((s) => {
      const todos = [...s.todos, { id: uid(), text, done: false, createdAt: Date.now() }]
      saveJSON('ub.todos', todos)
      return { todos }
    }),
  toggleTodo: (id) =>
    set((s) => {
      const todos = s.todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
      saveJSON('ub.todos', todos)
      return { todos }
    }),
  removeTodo: (id) =>
    set((s) => {
      const todos = s.todos.filter((t) => t.id !== id)
      saveJSON('ub.todos', todos)
      return { todos }
    }),
  clearDone: () =>
    set((s) => {
      const todos = s.todos.filter((t) => !t.done)
      saveJSON('ub.todos', todos)
      return { todos }
    }),
  addCard: (colId, title) =>
    set((s) =>
      persistBoard(
        s.board.map((c) =>
          c.id === colId ? { ...c, cards: [...c.cards, { id: uid(), title, createdAt: Date.now() }] } : c
        )
      )
    ),
  moveCard: (cardId, toColId) =>
    set((s) => {
      let card: BoardCard | null = null
      const stripped = s.board.map((c) => {
        const found = c.cards.find((k) => k.id === cardId)
        if (found) card = found
        return { ...c, cards: c.cards.filter((k) => k.id !== cardId) }
      })
      if (!card) return {}
      return persistBoard(
        stripped.map((c) => (c.id === toColId && card ? { ...c, cards: [...c.cards, card] } : c))
      )
    }),
  updateCard: (colId, cardId, title) =>
    set((s) =>
      persistBoard(
        s.board.map((c) =>
          c.id === colId
            ? { ...c, cards: c.cards.map((k) => (k.id === cardId ? { ...k, title } : k)) }
            : c
        )
      )
    ),
  deleteCard: (colId, cardId) =>
    set((s) =>
      persistBoard(
        s.board.map((c) => (c.id === colId ? { ...c, cards: c.cards.filter((k) => k.id !== cardId) } : c))
      )
    ),
  addColumn: (title) =>
    set((s) => persistBoard([...s.board, { id: uid(), title, cards: [] }])),
  renameColumn: (colId, title) =>
    set((s) => persistBoard(s.board.map((c) => (c.id === colId ? { ...c, title } : c)))),
  deleteColumn: (colId) =>
    set((s) => {
      // only empty columns go quietly; the UI hides × otherwise
      if (s.board.find((c) => c.id === colId)?.cards.length) return {}
      return persistBoard(s.board.filter((c) => c.id !== colId))
    }),
  setDayNote: (key, text) =>
    set((s) => {
      const dayNotes = { ...s.dayNotes }
      const v = text.slice(0, 20000)
      if (v.trim()) dayNotes[key] = v
      else delete dayNotes[key]
      const keys = Object.keys(dayNotes)
      if (keys.length > 1000) {
        for (const k of keys.slice(0, keys.length - 1000)) delete dayNotes[k]
      }
      saveJSON('ub.daynotes', dayNotes)
      return { dayNotes }
    }),
  addVocab: (draft) => {
    const word = draft.word.trim().slice(0, 120)
    if (!word) return null
    const card: VocabCard = {
      id: uid(),
      word,
      meaning: (draft.meaning ?? '').slice(0, 2000),
      example: (draft.example ?? '').slice(0, 2000),
      source: (draft.source ?? '').slice(0, 500),
      tags: (draft.tags ?? []).filter((t) => typeof t === 'string').slice(0, 10),
      srs: newSrs(),
      createdAt: Date.now(),
      favourite: draft.favourite === true
    }
    set((s) => persistVocab([...s.vocab, card]))
    return card
  },
  updateVocab: (id, patch) =>
    set((s) =>
      persistVocab(
        s.vocab.map((c) =>
          c.id === id
            ? {
                ...c,
                ...patch,
                word: patch.word !== undefined ? patch.word.slice(0, 120) : c.word,
                tags: patch.tags !== undefined ? patch.tags.slice(0, 10) : c.tags
              }
            : c
        )
      )
    ),
  deleteVocab: (id) => set((s) => persistVocab(s.vocab.filter((c) => c.id !== id))),
  gradeVocab: (id, grade) =>
    set((s) =>
      persistVocab(
        s.vocab.map((c) => (c.id === id ? { ...c, srs: schedule(c.srs, grade) } : c))
      )
    ),
  toggleFavourite: (id) =>
    set((s) =>
      persistVocab(s.vocab.map((c) => (c.id === id ? { ...c, favourite: !c.favourite } : c)))
    ),
  setStudy: (patch) => {
    // instant local update, then persist in the main process (owns the timer)
    set((s) => ({ study: { ...s.study, ...patch } }))
    void window.study
      .set(patch)
      .then((cfg) =>
        set(() => ({
          study: {
            enabled: cfg.enabled,
            intervalMin: cfg.intervalMin,
            level: cfg.level as StudyLevel,
            interests: cfg.interests,
            autoAdd: cfg.autoAdd
          }
        }))
      )
      .catch(() => {
        // main unavailable — keep the optimistic local value
      })
  },
  hydrateStudy: async () => {
    try {
      const cfg = await window.study.get()
      set(() => ({
        study: {
          enabled: cfg.enabled,
          intervalMin: cfg.intervalMin,
          level: cfg.level as StudyLevel,
          interests: cfg.interests,
          autoAdd: cfg.autoAdd
        }
      }))
    } catch {
      // no bridge (e.g. tests) — defaults stay
    }
  },
  setWallpaper: (info) =>
    set((s) => ({
      wallpaper: info
        ? {
            ...info,
            // keep the derived theme when the image is still the same one
            theme: s.wallpaper?.token === info.token ? s.wallpaper.theme : null,
            error: null
          }
        : null
    })),
  patchWallpaper: (patch) =>
    set((s) => (s.wallpaper ? { wallpaper: { ...s.wallpaper, ...patch } } : {}))
  }
})
