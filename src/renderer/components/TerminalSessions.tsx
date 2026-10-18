import { SquareTerminal } from 'lucide-react'
import { useStore } from '../store'

/** Live terminal sessions docked below the vault explorer: jump to an
 *  open terminal tab or spawn a fresh shell rooted at the vault. */
export function TerminalSessions(): JSX.Element {
  const tabs = useStore((s) => s.tabs)
  const activeId = useStore((s) => s.activeId)
  const openTab = useStore((s) => s.openTab)
  const closeTab = useStore((s) => s.closeTab)
  const setActive = useStore((s) => s.setActive)
  const sessions = tabs.filter((t) => t.type === 'terminal')

  return (
    <div className="term-side">
      <div className="side-head" style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{ flex: 1 }}>TERMINAL</span>
        <button
          className="btn"
          style={{ padding: '1px 8px', fontSize: 12 }}
          title="New terminal (shell at vault root)"
          onClick={() => openTab('terminal', '')}
        >
          +
        </button>
      </div>
      <div className="term-list">
        {sessions.length === 0 && <div className="side-empty">no sessions — press + for a shell</div>}
        {sessions.map((t) => (
          <div
            key={t.id}
            className={`term-row${t.id === activeId ? ' active' : ''}`}
            title={t.target || 'shell @ vault root'}
            onClick={() => setActive(t.id)}
          >
            <SquareTerminal size={13} strokeWidth={1.8} style={{ flex: 'none' }} />
            <span className="term-name">{t.title}</span>
            <button
              className="x"
              title="Kill session"
              onClick={(e) => {
                e.stopPropagation()
                closeTab(t.id)
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
