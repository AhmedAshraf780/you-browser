export type TabType = 'web' | 'markdown' | 'excalidraw' | 'pdf' | 'home' | 'kanban' | 'blinko' | 'terminal' | 'calendar' | 'vocab'

export interface Tab {
  id: string
  type: TabType
  title: string
  /** web: https URL. local: vault relative path like cache.md */
  target: string
}

export function titleFor(type: TabType, target: string): string {
  if (type === 'home') return 'Home'
  if (type === 'kanban') return target === 'board' ? 'Board' : target.split('/').pop() || target
  if (type === 'blinko') return (target.split('/').pop() || target).replace(/\.blinko$/i, '') || 'Blinko'
  if (type === 'vocab') return target === 'deck' ? 'Vocabulary' : target.split('/').pop() || target
  if (type === 'calendar') return 'Calendar'
  if (type === 'terminal') return target ? `nvim ${target.split('/').pop()}` : 'Terminal'
  if (type === 'web') {
    try {
      return new URL(target).hostname.replace(/^www\./, '') || target
    } catch {
      return target
    }
  }
  return target.split('/').pop() || target
}

export function typeForPath(path: string): TabType {
  if (path.endsWith('.md') || path.endsWith('.mf')) return 'markdown'
  if (path.endsWith('.excalidraw')) return 'excalidraw'
  if (path.endsWith('.kanban')) return 'kanban'
  if (path.endsWith('.blinko')) return 'blinko'
  if (path.endsWith('.vocab')) return 'vocab'
  if (path.endsWith('.pdf')) return 'pdf'
  return 'markdown'
}

/** Shared omnibox/quick-open resolution: URL, bare domain, vault file, or web search. */
export function normalizeInput(input: string): { type: TabType; target: string } {
  const v = input.trim()
  if (!v) return { type: 'web', target: 'https://www.google.com' }
  if (v.endsWith('.md') || v.endsWith('.mf') || v.endsWith('.excalidraw') || v.endsWith('.kanban') || v.endsWith('.blinko') || v.endsWith('.vocab') || v.endsWith('.pdf')) {
    if (/^https?:\/\//.test(v)) return { type: 'pdf', target: v }
    return { type: typeForPath(v), target: v }
  }
  if (/^https?:\/\//.test(v)) return { type: 'web', target: v }
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v)) return { type: 'web', target: 'https://' + v }
  return { type: 'web', target: 'https://www.google.com/search?q=' + encodeURIComponent(v) }
}

export const uid = (): string => Math.random().toString(36).slice(2, 10)
