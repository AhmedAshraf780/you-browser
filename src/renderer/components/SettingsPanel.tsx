import { useStore } from '../store'
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

export function SettingsPanel(): JSX.Element {
  const vaultPath = useStore((s) => s.vaultPath)
  const adsEnabled = useStore((s) => s.adsEnabled)
  const setAdsEnabled = useStore((s) => s.setAdsEnabled)
  const clearVisits = useStore((s) => s.clearVisits)
  const refreshTree = useStore((s) => s.refreshTree)

  const pickVault = async (): Promise<void> => {
    const picked = await window.vault.pick()
    if (picked) {
      useStore.getState().setVaultPath(picked)
      refreshTree()
    }
  }

  return (
    <div>
      <Section title="APPEARANCE">
        <ThemeControls />
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
      </Section>

      <Section title="ABOUT">
        <p className="set-note">UniBrowser 0.1.0 — web + notes in one place. History, todos, board and theme prefs live on this machine only.</p>
      </Section>
    </div>
  )
}
