import { useStore } from '../store'
import { STUDY_LEVELS } from '../store'
import { baseName } from '../vault'
import { ThemeControls } from './ThemePicker'

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section style={{ marginBottom: 18 }}>
      <div className="side-head">{title}</div>
      {children}
    </section>
  )
}

const LEVEL_HINT: Record<string, string> = {
  A2: 'very common words',
  B1: 'intermediate words',
  B2: 'less common words',
  C1: 'advanced words'
}

/** Where the detected wallpaper came from, in plain words. */
const VIA_LABEL: Record<string, string> = {
  'kde-slideshow': 'KDE slideshow',
  kde: 'KDE wallpaper',
  gnome: 'GNOME wallpaper',
  manual: 'chosen image'
}

export function SettingsPanel(): JSX.Element {
  const vaultPath = useStore((s) => s.vaultPath)
  const adsEnabled = useStore((s) => s.adsEnabled)
  const setAdsEnabled = useStore((s) => s.setAdsEnabled)
  const sidebarSide = useStore((s) => s.sidebarSide)
  const setSidebarSide = useStore((s) => s.setSidebarSide)
  const study = useStore((s) => s.study)
  const setStudy = useStore((s) => s.setStudy)
  const clearVisits = useStore((s) => s.clearVisits)
  const refreshTree = useStore((s) => s.refreshTree)
  const wallpaper = useStore((s) => s.wallpaper)
  const setWallpaper = useStore((s) => s.setWallpaper)

  const pickVault = async (): Promise<void> => {
    const picked = await window.vault.pick()
    if (picked) {
      useStore.getState().setVaultPath(picked)
      refreshTree()
    }
  }

  const refreshWallpaper = (): void => {
    void window.wallpaper.refresh().then(setWallpaper).catch(() => undefined)
  }
  const pickWallpaper = (): void => {
    void window.wallpaper
      .pick()
      .then((info) => {
        if (info) setWallpaper(info)
      })
      .catch(() => undefined)
  }
  const followDesktop = (): void => {
    void window.wallpaper.clear().then(setWallpaper).catch(() => undefined)
  }

  return (
    <div>
      <Section title="APPEARANCE">
        <ThemeControls />
      </Section>

      <Section title="WALLPAPER">
        <p className="set-note" style={{ marginTop: 0, marginBottom: 8 }}>
          The <strong>Wallpaper</strong> theme (top of the list above) is painted from your desktop
          background, and re-derived whenever the wallpaper changes.
        </p>
        <div className="set-row">
          <span>Current</span>
          <span style={{ color: 'var(--text-dim)' }}>{wallpaper ? wallpaper.name : 'none found'}</span>
        </div>
        <div className="set-row">
          <span>Source</span>
          <span style={{ color: 'var(--text-dim)' }}>
            {wallpaper ? (VIA_LABEL[wallpaper.via] ?? wallpaper.via) : '—'}
            {wallpaper && !wallpaper.manual && (
              <>
                {' · live'}
                {wallpaper.changes
                  ? ` (${wallpaper.changes} change${wallpaper.changes === 1 ? '' : 's'})`
                  : ''}
              </>
            )}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
          <button className="btn" style={{ flex: 1 }} onClick={refreshWallpaper}>
            Re-read
          </button>
          <button className="btn" style={{ flex: 1 }} onClick={pickWallpaper}>
            Choose image…
          </button>
        </div>
        {wallpaper?.manual && (
          <button className="btn" style={{ width: '100%', marginTop: 4 }} onClick={followDesktop}>
            Follow the desktop wallpaper again
          </button>
        )}
        {wallpaper?.error && <p className="set-note">{wallpaper.error}</p>}
        {!wallpaper && (
          <p className="set-note">
            No desktop wallpaper found — pick an image to derive the theme from instead.
          </p>
        )}
      </Section>

      <Section title="LAYOUT">
        <div className="set-row" style={{ marginBottom: 6 }}>
          <span>Sidebar position</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            className={`btn${sidebarSide === 'left' ? ' on' : ''}`}
            style={{ flex: 1 }}
            onClick={() => setSidebarSide('left')}
          >
            ◧ Left
          </button>
          <button
            className={`btn${sidebarSide === 'right' ? ' on' : ''}`}
            style={{ flex: 1 }}
            onClick={() => setSidebarSide('right')}
          >
            ◨ Right
          </button>
        </div>
        <p className="set-note">
          Docks the tab rail and panel to either edge. Takes effect instantly and is remembered.
        </p>
      </Section>

      <Section title="ENGLISH WORDS">
        <button
          className={`btn${study.enabled ? ' on' : ''}`}
          style={{ width: '100%', marginBottom: 8 }}
          onClick={() => setStudy({ enabled: !study.enabled })}
        >
          {study.enabled ? `Reminders: On (every ${study.intervalMin}m)` : 'Reminders: Off'}
        </button>

        <div className="set-row" style={{ marginBottom: 4 }}>
          <span>Every</span>
        </div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          {[5, 10, 15, 20, 30].map((m) => (
            <button
              key={m}
              className={`btn${study.intervalMin === m ? ' on' : ''}`}
              style={{ flex: 1, padding: '5px 0' }}
              onClick={() => setStudy({ intervalMin: m })}
            >
              {m}m
            </button>
          ))}
        </div>

        <div className="set-row" style={{ marginBottom: 4 }}>
          <span>Level</span>
        </div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          {STUDY_LEVELS.map((lv) => (
            <button
              key={lv}
              className={`btn${study.level === lv ? ' on' : ''}`}
              style={{ flex: 1, padding: '5px 0' }}
              onClick={() => setStudy({ level: lv })}
              title={LEVEL_HINT[lv]}
            >
              {lv}
            </button>
          ))}
        </div>

        <div className="set-row" style={{ marginBottom: 4 }}>
          <span>Interests</span>
        </div>
        <input
          className="set-input"
          defaultValue={study.interests.join(', ')}
          placeholder="programming, lifestyle, conversation"
          onBlur={(e) => {
            const next = e.target.value
              .split(',')
              .map((s) => s.trim().toLowerCase())
              .filter(Boolean)
            setStudy({ interests: next.length ? next.slice(0, 12) : study.interests })
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
        <p className="set-note" style={{ marginTop: 6 }}>
          Live search seeds — not a word list. The app asks online sources for words, verbs and phrasal verbs
          around these topics.
        </p>

        <button
          className={`btn${study.autoAdd ? ' on' : ''}`}
          style={{ width: '100%', marginBottom: 8, marginTop: 4 }}
          onClick={() => setStudy({ autoAdd: !study.autoAdd })}
        >
          {study.autoAdd ? 'Auto-save to deck: On' : 'Auto-save to deck: Off'}
        </button>

        <button className="btn" style={{ width: '100%' }} onClick={() => void window.study.next()}>
          Show a word now
        </button>
        <p className="set-note">
          Words, verbs and phrasal verbs are fetched live (Simple English Wiktionary / Free Dictionary API)
          and cached offline. When the window isn't focused you get a notification instead — click it to open
          the card.
        </p>
      </Section>

      <Section title="AD BLOCKER">
        <button
          className={`btn${adsEnabled ? ' on' : ''}`}
          style={{ width: '100%' }}
          onClick={() => void window.blocker.setEnabled(!adsEnabled).then(setAdsEnabled)}
        >
          {adsEnabled ? 'Blocking: On' : 'Blocking: Off'}
        </button>
        <p className="set-note">
          uBlock-style filter lists for every web tab. YouTube is exempt from network blocking and handled by the
          in-page skipper instead.
        </p>
      </Section>

      <Section title="VAULT">
        <div className="vault-current" title={vaultPath}>
          {vaultPath ? baseName(vaultPath) : '…'}
        </div>
        <div className="vault-actions">
          <button className="btn" onClick={() => void pickVault()}>
            Change
          </button>
          <button className="btn" onClick={() => void refreshTree()}>
            Refresh
          </button>
        </div>
      </Section>

      <Section title="DATA">
        <button
          className="btn"
          style={{ width: '100%' }}
          onClick={() => {
            if (confirm('Clear recent-sites history?')) clearVisits()
          }}
        >
          Clear recent sites
        </button>
      </Section>

      <Section title="SHORTCUTS">
        <div className="set-row">
          <span>Quick open</span>
          <kbd>Ctrl+T</kbd>
        </div>
        <div className="set-row">
          <span>Toggle sidebar</span>
          <kbd>Ctrl+B</kbd>
        </div>
        <div className="set-row">
          <span>Next / previous tab</span>
          <kbd>Ctrl+Tab / Shift</kbd>
        </div>
        <div className="set-row">
          <span>Jump to tab 1–8, last</span>
          <kbd>Ctrl+1…9</kbd>
        </div>
        <div className="set-row">
          <span>Find in page / notes</span>
          <kbd>Ctrl+F</kbd>
        </div>
        <div className="set-row">
          <span>Root terminal</span>
          <kbd>Ctrl+Enter</kbd>
        </div>
        <div className="set-row">
          <span>Add word to vocabulary</span>
          <kbd>Ctrl+Shift+E</kbd>
        </div>
        <div className="set-row">
          <span>Vault / Board / Cal / Settings</span>
          <kbd>Alt+1…4</kbd>
        </div>
      </Section>

      <Section title="ABOUT">
        <p className="set-note">You 0.1.0 — web + notes in one place. History, todos, board and theme prefs live on this machine only.</p>
      </Section>
    </div>
  )
}
