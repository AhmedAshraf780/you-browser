import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { useStore, type PanelId } from './store'
import { normalizeInput, type Tab } from './tabs'
import { baseName } from './vault'
import { WebTab } from './components/WebTab'
import { ExcalidrawTab } from './components/ExcalidrawTab'
import { PdfTab } from './components/PdfTab'
import { HomeTab } from './components/HomeTab'
import { FileExplorer } from './components/FileExplorer'
import { KanbanTab } from './components/KanbanTab'
import { VocabTab } from './components/VocabTab'
import { WordCapture } from './components/WordCapture'
import { StudyOverlay } from './components/StudyOverlay'
import { CalendarTab } from './components/CalendarTab'
import { SettingsPanel } from './components/SettingsPanel'
import { QuickOpen } from './components/QuickOpen'
import { FindBar } from './components/FindBar'
import { TabIcon } from './components/TabIcon'
import { TerminalSessions } from './components/TerminalSessions'
import { getWebview, getEditor } from './webviews'
import { buildVars, loadPalette, themeCss } from './walltheme'
import { DEFAULT_BLINKO_PATH } from './blinko'
import type { EditorView } from '@codemirror/view'
import './styles.css'

// Heavy editors stay out of the initial bundle — parsed only on first open.
const MarkdownTab = lazy(() => import('./components/MarkdownTab').then((m) => ({ default: m.MarkdownTab })))
const BlinkoTab = lazy(() => import('./components/BlinkoTab').then((m) => ({ default: m.BlinkoTab })))
const TerminalTab = lazy(() => import('./components/TerminalTab').then((m) => ({ default: m.TerminalTab })))

function TabFallback(): JSX.Element {
  return <div className="empty">loading…</div>
}

// Icons for each tab type
const TAB_ICONS: Record<string, string> = {
  web: '🌐',
  markdown: '📝',
  excalidraw: '🎨',
  pdf: '📄',
  home: '⌂',
  kanban: '▦',
  blinko: '◆'
}

const NAV: Array<{ id: PanelId; icon: string; label: string }> = [
  { id: 'vault',    icon: '⌂',  label: 'Vault'     },
  { id: 'kanban',   icon: '▥',  label: 'Board'     },
  { id: 'blinko',   icon: '◆',  label: 'Blinko'    },
  { id: 'calendar', icon: '▦',  label: 'Calendar'  },
  { id: 'settings', icon: '⚙',  label: 'Settings'  }
]

export function App(): JSX.Element {
  const {
    tabs,
    activeId,
    omnibox,
    vaultPath,
    theme,
    mode,
    sidebarOpen,
    sidebarSide,
    panel,
    panelOpen,
    openTab,
    closeTab,
    setActive,
    setOmnibox,
    setVaultPath,
    setAdsEnabled,
    toggleSidebar,
    setPanel,
    setPanelOpen,
    refreshTree
  } = useStore()
  const active = tabs.find((t) => t.id === activeId) ?? null
  const [quickOpen, setQuickOpen] = useState(false)
  const [finding, setFinding] = useState<string | null>(null)
  const [capture, setCapture] = useState<{ text: string; source: string } | null>(null)
  const splitTabId = useStore((s) => s.splitTabId)
  const wallpaper = useStore((s) => s.wallpaper)
  const wallpaperToken = wallpaper?.token ?? ''
  const secondary = tabs.find((t) => t.id === splitTabId) ?? null
  const splitOn = !!secondary && !!active && secondary.id !== active.id

  // Load persisted vault + live updates.
  useEffect(() => {
    window.vault.dir().then(setVaultPath).catch(() => {})
    window.blocker.isEnabled().then(setAdsEnabled).catch(() => {})
    refreshTree()
    const offChanged = window.vault.onChanged(refreshTree)
    // Idle-prefetch the giant drawing engine so the first canvas opens fast.
    const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 2500))
    idle(() => {
      void import('@excalidraw/excalidraw')
      void import('@excalidraw/excalidraw/index.css')
    })
    void useStore.getState().hydrateStudy()
    return offChanged
  }, [refreshTree, setVaultPath, setAdsEnabled])

  // Apply theme + persist UI prefs.
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.dataset.mode = mode
    window.theme.setMode(mode).catch(() => {})
    try {
      localStorage.setItem('ub.theme', theme)
      localStorage.setItem('ub.mode', mode)
      localStorage.setItem('ub.sidebar', sidebarOpen ? '1' : '0')
    } catch {
      // private mode
    }
  }, [theme, mode, sidebarOpen])

  // Desktop wallpaper → the "wallpaper" theme. Main tells us which image the
  // desktop is showing and pushes every change; the pixels become real theme
  // variables so the picker, dark/light switching and overrides all just work.
  useEffect(() => {
    const off = window.wallpaper.onChanged((info) => useStore.getState().setWallpaper(info))
    window.wallpaper
      .get()
      .then((info) => useStore.getState().setWallpaper(info))
      .catch(() => undefined)
    return off
  }, [])

  useEffect(() => {
    if (!wallpaperToken) return
    let alive = true
    loadPalette(`you-wall://current?t=${encodeURIComponent(wallpaperToken)}`)
      .then((palette) => {
        if (!alive) return
        useStore.getState().patchWallpaper({
          theme: { dark: buildVars(palette, 'dark'), light: buildVars(palette, 'light') },
          error: null
        })
      })
      .catch(() => {
        if (alive) useStore.getState().patchWallpaper({ error: 'the wallpaper image could not be read' })
      })
    return () => {
      alive = false
    }
  }, [wallpaperToken])

  useEffect(() => {
    const derived = wallpaper?.theme
    if (!derived) return
    const id = 'ub-wallpaper-theme'
    let style = document.getElementById(id) as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = id
      document.head.appendChild(style)
    }
    style.textContent = themeCss(derived.dark, derived.light)
  }, [wallpaper?.theme])

  // Global shortcuts.
  useEffect(() => {
    const offQuick = window.shortcuts.onQuickOpen(() => setQuickOpen(true))
    const offSide  = window.shortcuts.onToggleSidebar(() => useStore.getState().toggleSidebar())
    const offTerm = window.shortcuts.onOpenTerminal(() => {
      const st = useStore.getState()
      const existing = st.tabs.find((t) => t.type === 'terminal' && !t.target)
      if (existing) st.setActive(existing.id)
      else st.openTab('terminal', '')
    })
    const offFind = window.shortcuts.onFindOpen(() => {
      const st = useStore.getState()
      const a = st.tabs.find((t) => t.id === st.activeId)
      if (!a) return
      if (a.type === 'web') {
        setFinding(a.id)
      } else if (a.type === 'markdown') {
        const view = getEditor(a.id) as EditorView | undefined
        if (view) {
          // search panel module loads on demand, not at startup
          void import('@codemirror/search').then(({ openSearchPanel }) => {
            const v = getEditor(a.id) as EditorView | undefined
            if (v) {
              openSearchPanel(v)
              v.focus()
            }
          })
          view.focus()
        }
      }
    })
    const offVocab = window.shortcuts.onVocabCapture(() => {
      const st = useStore.getState()
      const a = st.tabs.find((t) => t.id === st.activeId) ?? null
      const fromOmni = st.omnibox.trim()
      const fallback = (): void => {
        const sel = (window.getSelection()?.toString() ?? '').trim()
        setCapture({ text: sel || fromOmni, source: '' })
      }
      if (a && a.type === 'web') {
        const wv = getWebview(a.id)
        if (wv) {
          wv.executeJavaScript(
            'String((window.getSelection && window.getSelection().toString()) || "")'
          )
            .then((sel) => setCapture({ text: String(sel ?? '').trim() || fromOmni, source: a.target }))
            .catch(fallback)
          return
        }
      }
      if (a && a.type !== 'web' && a.type !== 'home') {
        const sel = (window.getSelection()?.toString() ?? '').trim()
        setCapture({ text: sel || fromOmni, source: a.target })
        return
      }
      fallback()
    })
    const offNav = window.shortcuts.onNavKey((id) => {
      const st = useStore.getState()
      if (id === 'kanban' || id === 'calendar' || id === 'blinko') {
        // pages toggle: open → activate → close-if-active
        const type = id as 'kanban' | 'calendar' | 'blinko'
        const existing = st.tabs.find((t) => t.type === type)
        if (existing && st.activeId === existing.id) st.closeTab(existing.id)
        else if (existing) st.setActive(existing.id)
        else st.openTab(type, id === 'kanban' ? 'board' : id === 'calendar' ? 'calendar' : DEFAULT_BLINKO_PATH)
      } else if (id === 'vault' || id === 'settings') {
        // panels toggle, same as rail click
        if (st.sidebarOpen && st.panel === id && st.panelOpen) st.setPanelOpen(false)
        else {
          if (!st.sidebarOpen) st.toggleSidebar()
          if (st.panel !== id) st.setPanel(id)
          st.setPanelOpen(true)
        }
      }
    })
    const offCycle = window.shortcuts.onCycleTab((dir) => {
      const st = useStore.getState()
      if (st.tabs.length === 0) return
      const i = st.tabs.findIndex((t) => t.id === st.activeId)
      const next = (i < 0 ? 0 : (i + dir + st.tabs.length) % st.tabs.length) as number
      const tab = st.tabs[next] as (typeof st.tabs)[number] | undefined
      if (tab) st.setActive(tab.id)
    })
    const offGoto = window.shortcuts.onGotoTab((index) => {
      const st = useStore.getState()
      // index 8 (Ctrl+9) means last tab, per browser convention
      const tab = index >= 8 ? st.tabs[st.tabs.length - 1] : st.tabs[index]
      if (tab) st.setActive(tab.id)
    })
    return () => { offQuick(); offSide(); offCycle(); offGoto(); offNav(); offFind(); offTerm(); offVocab() }
  }, [])

  const pickVault = async (): Promise<void> => {
    const picked = await window.vault.pick()
    if (picked) { setVaultPath(picked); refreshTree() }
  }

  const go = (): void => {
    const { type, target } = normalizeInput(omnibox)
    openTab(type, target)
    refreshTree()
  }

  const toggleSplit = (): void => {
    const st = useStore.getState()
    if (st.splitTabId && st.tabs.some((t) => t.id === st.splitTabId)) {
      st.setSplitTabId(null)
    } else {
      const other = st.tabs.find((t) => t.id !== st.activeId)
      if (other) st.setSplitTabId(other.id)
    }
  }

  const rowRef = useRef<HTMLDivElement | null>(null)
  const ratioRef = useRef(0.5)
  const [ratio, setRatio] = useState(() => {
    try {
      const v = parseFloat(localStorage.getItem('ub.splitRatio') ?? '0.5')
      return Number.isFinite(v) ? Math.min(0.85, Math.max(0.15, v)) : 0.5
    } catch {
      return 0.5
    }
  })
  const [dragging, setDragging] = useState(false)

  const startDrag = (e: React.MouseEvent): void => {
    e.preventDefault()
    setDragging(true)
    const move = (ev: MouseEvent): void => {
      const el = rowRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const v = Math.min(0.85, Math.max(0.15, (ev.clientX - r.left) / Math.max(1, r.width)))
      ratioRef.current = v
      setRatio(v)
    }
    const up = (): void => {
      setDragging(false)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      try {
        localStorage.setItem('ub.splitRatio', String(ratioRef.current))
      } catch {
        // private mode — ratio just won't persist
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const renderContent = (t: Tab): JSX.Element => (
    <>
      {t.type === 'web'        && <WebTab tab={t} />}
      {t.type === 'markdown'   && <Suspense fallback={<TabFallback />}><MarkdownTab tab={t} /></Suspense>}
      {t.type === 'excalidraw' && <ExcalidrawTab tab={t} />}
      {t.type === 'pdf'        && <PdfTab tab={t} />}
      {t.type === 'home'       && <HomeTab />}
      {t.type === 'kanban'     && <KanbanTab tab={t} />}
      {t.type === 'blinko'     && <Suspense fallback={<TabFallback />}><BlinkoTab tab={t} /></Suspense>}
      {t.type === 'vocab'      && <VocabTab tab={t} />}
      {t.type === 'calendar'   && <CalendarTab />}
      {t.type === 'terminal'   && <Suspense fallback={<TabFallback />}><TerminalTab tab={t} /></Suspense>}
    </>
  )

  const navClick = (id: PanelId): void => {
    // board + calendar live as full pages, not side panels
    if (id === 'kanban') { openTab('kanban', 'board'); return }
    if (id === 'blinko') { openTab('blinko', DEFAULT_BLINKO_PATH); return }
    if (id === 'calendar') { openTab('calendar', 'calendar'); return }
    const st = useStore.getState()
    // active panel icon collapses the panel pane only — tabs sidebar stays
    if (st.sidebarOpen && st.panel === id && st.panelOpen) st.setPanelOpen(false)
    else {
      if (!st.sidebarOpen) st.toggleSidebar()
      if (st.panel !== id) st.setPanel(id)
      st.setPanelOpen(true)
    }
  }

  const navSel = (id: PanelId): boolean =>
    id === 'kanban' || id === 'blinko' || id === 'calendar'
      ? active?.type === id
      : panel === id && panelOpen

  // Panel pane is independent from the tabs sidebar: either can collapse
  // without touching the other.
  const showPanel = sidebarOpen && panelOpen && panel !== 'kanban' && panel !== 'blinko' && panel !== 'calendar'

  // Whether the active tab is a web tab (show URL bar)
  const isWeb = active?.type === 'web'

  return (
    <div className={`shell${sidebarSide === 'right' ? ' side-right' : ''}`}>
      {/* ── Vertical sidebar ── */}
      <aside className={`sidebar${sidebarOpen ? '' : ' collapsed'}`}>
        {/* Header: logo + app name + collapse */}
        <div className="sidebar-header">
          <div className="sidebar-logo">Y</div>
          {sidebarOpen && <span className="sidebar-app-name">You</span>}
          {sidebarOpen && (
            <button className="sidebar-collapse" onClick={toggleSidebar} title="Collapse sidebar (Ctrl+B)">
              {sidebarSide === 'right' ? '›' : '‹'}
            </button>
          )}
          {!sidebarOpen && (
            <button
              style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: 52, background: 'none', border: 'none', cursor: 'pointer' }}
              onClick={toggleSidebar}
              title="Expand sidebar (Ctrl+B)"
            />
          )}
        </div>

        {/* Omnibox — only when expanded */}
        {sidebarOpen && (
          <div className="sidebar-omni-wrap">
            <input
              id="omnibox"
              className="sidebar-omni"
              value={omnibox}
              onChange={(e) => setOmnibox(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && go()}
              placeholder="Search or enter URL…"
            />
          </div>
        )}

        {/* Tab list */}
        <div className="sidebar-tabs">
          {sidebarOpen && (
            <div className="sidebar-section-label">
              <span>Tabs</span>
              <button className="sidebar-new-tab" onClick={() => setQuickOpen(true)} title="New tab (quick open)">
                +
              </button>
              <button
                className={`sidebar-new-tab${splitOn ? ' split-on' : ''}`}
                onClick={toggleSplit}
                title={splitOn ? 'Close split view' : 'Split view: active tab beside another'}
              >
                ◫
              </button>
            </div>
          )}
          {!sidebarOpen && (
            <button
              className="nav-btn"
              onClick={() => setQuickOpen(true)}
              title="New tab (quick open)"
              style={{ justifyContent: 'center', padding: '8px 0' }}
            >
              <span className="nav-icon">+</span>
            </button>
          )}

          {tabs.map((t) => (
            <div
              key={t.id}
              className={`tab${t.id === activeId ? ' active' : ''}`}
              onClick={() => setActive(t.id)}
              title={t.target}
            >
              <TabIcon type={t.type} target={t.target} />
              <span className="tab-title">{t.title}</span>
              <button
                className="tab-close"
                onClick={(e) => { e.stopPropagation(); closeTab(t.id) }}
                title="Close tab"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {/* Bottom nav: vault / board / calendar / settings */}
        <nav className="sidebar-nav">
          {NAV.map((r) => (
            <button
              key={r.id}
              className={`nav-btn${navSel(r.id) ? ' sel' : ''}`}
              title={r.label}
              onClick={() => navClick(r.id)}
            >
              <span className="nav-icon">{r.icon}</span>
              {sidebarOpen && <span className="nav-label">{r.label}</span>}
            </button>
          ))}
        </nav>
      </aside>

      {/* ── Panel pane (vault / calendar / settings) ── */}
      {showPanel && (
        <div className="panel-pane fade-in">
          <div className="panel-head">
            <span className="panel-head-title">
              {panel === 'vault' ? 'Vault' : 'Settings'}
            </span>
            {panel === 'vault' && (
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="panel-head-btn" onClick={() => void pickVault()} title="Change vault folder">
                  Change
                </button>
                <button className="panel-head-btn" onClick={() => void refreshTree()} title="Refresh tree">
                  ↺
                </button>
              </div>
            )}
            <button className="panel-head-btn" onClick={() => setPanelOpen(false)} title="Close panel">
              ×
            </button>
          </div>

          {panel === 'vault' && (
            <div className="panel-body">
              <div className="vault-bar">
                <div className="vault-name" title={vaultPath || '…'}>
                  {vaultPath ? baseName(vaultPath) : '…'}
                </div>
              </div>
              <FileExplorer />
              <TerminalSessions />
            </div>
          )}

          {panel === 'settings' && (
            <div className="panel-body">
              <div className="panel-scroll">
                <SettingsPanel />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Main content area ── */}
      <div className="main">
        <section className="content" style={{ position: 'relative' }}>
          {/* Web toolbar (URL bar + controls) only for web tabs */}
          {isWeb && (
            <div className="page-toolbar">
              <button
                className="btn"
                onClick={() => active && getWebview(active.id)?.goBack()}
                title="Back"
              >
                ←
              </button>
              <button
                className="btn"
                onClick={() => active && getWebview(active.id)?.goForward()}
                title="Forward"
              >
                →
              </button>
              <button
                className="btn"
                onClick={() => active && getWebview(active.id)?.reload()}
                title="Reload"
              >
                ↺
              </button>
              <input
                className="omni"
                value={omnibox}
                onChange={(e) => setOmnibox(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && go()}
                placeholder="Search or enter URL…"
              />
            </div>
          )}

          {/* Tab contents — every tab stays mounted (display:none when
              hidden) so web media keeps playing and editors keep undo.
              Split view shows the active + secondary panes side by side
              with a draggable divider. */}
          {tabs.length === 0 && (
            <div className="empty">
              Press <strong>+</strong> in the sidebar or <kbd>Ctrl+T</kbd> to open anything.
            </div>
          )}
          {splitOn && active && secondary ? (
            <div ref={rowRef} style={{ display: 'flex', flexDirection: 'row', flex: '1 1 auto', minHeight: 0, minWidth: 0 }}>
              <div style={{ flexGrow: ratio, flexShrink: 1, flexBasis: '0%', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                {renderContent(active)}
              </div>
              <div
                className={`split-divider${dragging ? ' drag' : ''}`}
                title="Drag to resize · double-click to reset"
                onMouseDown={startDrag}
                onDoubleClick={() => {
                  ratioRef.current = 0.5
                  setRatio(0.5)
                  try {
                    localStorage.setItem('ub.splitRatio', '0.5')
                  } catch {
                    // ignore
                  }
                }}
              />
              <div style={{ flexGrow: 1 - ratio, flexShrink: 1, flexBasis: '0%', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <div className="split-head">
                  <span className="split-title" title={secondary.target}>{secondary.title}</span>
                  <button className="btn" title="Swap panes" onClick={() => useStore.getState().swapSplit()}>
                    ⇆
                  </button>
                  <button className="btn" title="Close split" onClick={() => useStore.getState().setSplitTabId(null)}>
                    ×
                  </button>
                </div>
                {renderContent(secondary)}
              </div>
              {tabs
                .filter((t) => t.id !== active.id && t.id !== secondary.id)
                .map((t) => (
                  <div key={t.id} style={{ display: 'none' }}>
                    {renderContent(t)}
                  </div>
                ))}
            </div>
          ) : (
            <div
              style={{
                display: tabs.length === 0 ? 'none' : 'flex',
                flex: '1 1 auto',
                minHeight: 0,
                minWidth: 0,
                flexDirection: 'column'
              }}
            >
              {tabs.map((t) => (
                <div
                  key={t.id}
                  style={{
                    display: t.id === activeId ? 'flex' : 'none',
                    flex: '1 1 auto',
                    minHeight: 0,
                    minWidth: 0,
                    flexDirection: 'column'
                  }}
                >
                  {renderContent(t)}
                </div>
              ))}
            </div>
          )}
          {finding !== null && finding === activeId && active?.type === 'web' && (
            <FindBar tabId={finding} onClose={() => setFinding(null)} />
          )}
        </section>
      </div>

      {quickOpen && <QuickOpen onClose={() => setQuickOpen(false)} />}
      {capture && (
        <WordCapture
          initialText={capture.text}
          source={capture.source}
          onClose={() => setCapture(null)}
        />
      )}
      <StudyOverlay />
    </div>
  )
}
