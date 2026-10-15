import { create } from 'zustand'
import { Tab, TabType, titleFor, uid } from './tabs'
import { TreeNode } from './vault'

export type ThemeId = 'immortal' | 'rose-pine' | 'catppuccin' | 'gruvbox' | 'tokyo-night'
export type ColorMode = 'dark' | 'light'

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
  panel: PanelId
  visits: Visit[]
  todos: Todo[]
  board: BoardColumn[]
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
  setPanel: (v: PanelId) => void
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
}

const seed: Tab[] = [{ id: uid(), type: 'home', title: 'Home', target: 'home' }]

export const useStore = create<BrowserState>((set) => ({
  tabs: seed,
  activeId: seed[0]?.id ?? null,
  tree: [],
  omnibox: '',
  vaultPath: '',
  adsEnabled: true,
  theme: ((): ThemeId => {
    const t = stored('ub.theme', 'rose-pine')
    return t === 'immortal' || t === 'rose-pine' || t === 'catppuccin' || t === 'gruvbox' || t === 'tokyo-night'
      ? t
      : 'rose-pine'
  })(),
  mode: (stored('ub.mode', 'dark') === 'light' ? 'light' : 'dark') as ColorMode,
  sidebarOpen: stored('ub.sidebar', '1') !== '0',
  panel: ((): PanelId => {
    const p = stored('ub.panel', 'vault')
    return p === 'calendar' || p === 'settings' ? (p as PanelId) : 'vault'
  })(),
  board: loadBoard(),
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
      if (existing) return { ...s, activeId: existing.id }
      const tab: Tab = { id: uid(), type, title: titleFor(type, target), target }
      return { tabs: [...s.tabs, tab], activeId: tab.id, omnibox: target }
    }),
  closeTab: (id) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id)
      const tabs = s.tabs.filter((t) => t.id !== id)
      let activeId = s.activeId
      if (activeId === id) {
        activeId = tabs[Math.max(0, idx - 1)]?.id ?? null
      }
      return { tabs, activeId }
    }),
  setActive: (id) =>
    set((s) => ({
      activeId: id,
      omnibox: s.tabs.find((t) => t.id === id)?.target ?? s.omnibox
    })),
  updateTab: (id, patch) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  setTree: (tree) => set({ tree }),
  refreshTree: async () => {
    try {
      set({ tree: await window.vault.tree() })
    } catch {
      set({ tree: [] })
    }
  },
  setOmnibox: (omnibox) => set({ omnibox }),
  setVaultPath: (vaultPath) => set({ vaultPath }),
  setAdsEnabled: (adsEnabled) => set({ adsEnabled }),
  setTheme: (theme) => set({ theme }),
  setMode: (mode) => set({ mode }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
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
    })
}))
