import { useEffect, useState } from 'react'
import { useStore, type PanelId } from './store'
import { normalizeInput } from './tabs'
import { baseName } from './vault'
import { WebTab } from './components/WebTab'
import { MarkdownTab } from './components/MarkdownTab'
import { ExcalidrawTab } from './components/ExcalidrawTab'
import { PdfTab } from './components/PdfTab'
import { HomeTab } from './components/HomeTab'
import { FileExplorer } from './components/FileExplorer'
import { KanbanTab } from './components/KanbanTab'
import { CalendarPanel } from './components/CalendarPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { QuickOpen } from './components/QuickOpen'
import { getWebview } from './webviews'
import './styles.css'

// Icons for each tab type
const TAB_ICONS: Record<string, string> = {
  web: '🌐',
  markdown: '📝',
  excalidraw: '🎨',
  pdf: '📄',
  home: '⌂',
  kanban: '▦'
}

const NAV: Array<{ id: PanelId; icon: string; label: string }> = [
  { id: 'vault',    icon: '⌂',  label: 'Vault'     },
  { id: 'kanban',   icon: '▥',  label: 'Board'     },
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
    panel,
    openTab,
    closeTab,
    setActive,
    setOmnibox,
    setVaultPath,
    setAdsEnabled,
    toggleSidebar,
    setPanel,
    refreshTree
  } = useStore()
  const active = tabs.find((t) => t.id === activeId) ?? null
  const [quickOpen, setQuickOpen] = useState(false)

  // Load persisted vault + live updates.
  useEffect(() => {
    window.vault.dir().then(setVaultPath).catch(() => {})
    window.blocker.isEnabled().then(setAdsEnabled).catch(() => {})
    refreshTree()
    return window.vault.onChanged(refreshTree)
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

  // Global shortcuts.
  useEffect(() => {
    const offQuick = window.shortcuts.onQuickOpen(() => setQuickOpen(true))
    const offSide  = window.shortcuts.onToggleSidebar(() => useStore.getState().toggleSidebar())
    return () => { offQuick(); offSide() }
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

  const navClick = (id: PanelId): void => {
    if (id === 'kanban') { openTab('kanban', 'board'); return }
    const st = useStore.getState()
    // If sidebar is collapsed, open it first
    if (!st.sidebarOpen) st.toggleSidebar()
    else if (st.panel === id) st.toggleSidebar()
    st.setPanel(id)
  }

  const navSel = (id: PanelId): boolean =>
    id === 'kanban' ? active?.type === 'kanban' : sidebarOpen && panel === id

  // Whether to show the panel pane (vault/calendar/settings)
  const showPanel = sidebarOpen && panel !== 'kanban'

  // Whether the active tab is a web tab (show URL bar)
  const isWeb = active?.type === 'web'

  return (
    <div className="shell">
      {/* ── Vertical sidebar ── */}
      <aside className={`sidebar${sidebarOpen ? '' : ' collapsed'}`}>
        {/* Header: logo + app name + collapse */}
        <div className="sidebar-header">
          <div className="sidebar-logo">U</div>
          {sidebarOpen && <span className="sidebar-app-name">UniBrowser</span>}
          {sidebarOpen && (
            <button className="sidebar-collapse" onClick={toggleSidebar} title="Collapse sidebar (Ctrl+B)">
              ‹
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
              <button className="sidebar-new-tab" onClick={() => openTab('home', 'home')} title="New tab">
                +
              </button>
            </div>
          )}
          {!sidebarOpen && (
            <button
              className="nav-btn"
              onClick={() => openTab('home', 'home')}
              title="New tab"
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
              <span className={`dot t-${t.type}`} />
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
              {panel === 'vault' ? 'Vault' : panel === 'calendar' ? 'Calendar' : 'Settings'}
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
          </div>

          {panel === 'vault' && (
            <div className="panel-body">
              <div className="vault-bar">
                <div className="vault-name" title={vaultPath || '…'}>
                  {vaultPath ? baseName(vaultPath) : '…'}
                </div>
              </div>
              <FileExplorer />
            </div>
          )}

          {panel === 'calendar' && (
            <div className="panel-body">
              <div className="panel-scroll">
                <CalendarPanel />
              </div>
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
        <section className="content">
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

          {/* Tab contents */}
          {tabs.length === 0 && (
            <div className="empty">
              Press <strong>+</strong> in the sidebar or <kbd>Ctrl+T</kbd> to open anything.
            </div>
          )}
          {tabs.map((t) => (
            <div
              key={t.id}
              style={{
                display: t.id === activeId ? 'flex' : 'none',
                flex: '1 1 auto',
                minHeight: 0,
                flexDirection: 'column'
              }}
            >
              {t.type === 'web'        && <WebTab tab={t} />}
              {t.type === 'markdown'   && <MarkdownTab tab={t} />}
              {t.type === 'excalidraw' && <ExcalidrawTab tab={t} />}
              {t.type === 'pdf'        && <PdfTab tab={t} />}
              {t.type === 'home'       && <HomeTab />}
              {t.type === 'kanban'     && <KanbanTab />}
            </div>
          ))}
        </section>
      </div>

      {quickOpen && <QuickOpen onClose={() => setQuickOpen(false)} />}
    </div>
  )
}
