import { useStore, type ColorMode } from '../store'
import type { ThemeId } from '../store'
import { swatches } from '../walltheme'

interface ThemeDef {
  id: ThemeId
  label: string
  dark: [string, string, string]
  light: [string, string, string]
}

export const THEMES: ThemeDef[] = [
  { id: 'abyss', label: 'Abyss', dark: ['#000010', '#d7d7ec', '#8ab4ff'], light: ['#eef0fa', '#151530', '#2f5fd0'] },
  { id: 'immortal', label: 'Black Metal · Immortal', dark: ['#000000', '#cccccc', '#eeeeee'], light: ['#f4f4f4', '#111111', '#000000'] },
  { id: 'rose-pine', label: 'Rosé Pine', dark: ['#191724', '#e0def4', '#c4a7e7'], light: ['#faf4ed', '#575279', '#907aa9'] },
  { id: 'catppuccin', label: 'Catppuccin', dark: ['#1e1e2e', '#cdd6f4', '#cba6f7'], light: ['#eff1f5', '#4c4f69', '#8839ef'] },
  { id: 'gruvbox', label: 'Gruvbox', dark: ['#282828', '#ebdbb2', '#fabd2f'], light: ['#fbf1c7', '#3c3836', '#b57614'] },
  { id: 'tokyo-night', label: 'Tokyo Night', dark: ['#1a1b26', '#c0caf5', '#7aa2f7'], light: ['#d5d6db', '#343b59', '#34548a'] },
  { id: 'dracula', label: 'Dracula', dark: ['#282a36', '#f8f8f2', '#bd93f9'], light: ['#f8f8f2', '#282a36', '#7c3aed'] },
  { id: 'nord', label: 'Nord', dark: ['#2e3440', '#eceff4', '#88c0d0'], light: ['#eceff4', '#2e3440', '#5e81ac'] },
  { id: 'everforest', label: 'Everforest', dark: ['#2b3339', '#d3c6aa', '#a7c080'], light: ['#fdf6e3', '#5c6a72', '#8da101'] },
  { id: 'solarized', label: 'Solarized', dark: ['#002b36', '#839496', '#268bd2'], light: ['#fdf6e3', '#657b83', '#268bd2'] },
  { id: 'ayu', label: 'Ayu', dark: ['#0b0e14', '#b3b1ad', '#e6b450'], light: ['#fafafa', '#575f66', '#fa8d3e'] }
]

/** Inline theme controls for the settings panel (mode switch + theme list). */
export function ThemeControls(): JSX.Element {
  const theme = useStore((s) => s.theme)
  const mode = useStore((s) => s.mode)
  const setTheme = useStore((s) => s.setTheme)
  const setMode = useStore((s) => s.setMode)
  const wallpaper = useStore((s) => s.wallpaper)

  const pickMode = (m: ColorMode): void => setMode(m)

  // The wallpaper row previews whatever the desktop is showing right now, so it
  // doubles as a live indicator that the derivation worked.
  const derived = wallpaper?.theme
  const wallVars = derived ? (mode === 'dark' ? derived.dark : derived.light) : null
  const wallSw = wallVars ? swatches(wallVars) : ['#000010', '#d7d7ec', '#8ab4ff']

  return (
    <div>
      <div className="theme-modes" style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <button className={`btn${mode === 'dark' ? ' on' : ''}`} style={{ flex: 1 }} onClick={() => pickMode('dark')}>
          Dark
        </button>
        <button className={`btn${mode === 'light' ? ' on' : ''}`} style={{ flex: 1 }} onClick={() => pickMode('light')}>
          Light
        </button>
      </div>
      <div
        className={`theme-row${theme === 'wallpaper' ? ' sel' : ''}`}
        onClick={() => setTheme('wallpaper')}
        title="Colours taken from your desktop wallpaper — follows it as it changes"
      >
        <span className="theme-sw">
          {wallSw.map((c, i) => (
            <i key={i} style={{ background: c }} />
          ))}
        </span>
        Wallpaper
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)' }}>
          {wallpaper ? (wallpaper.manual ? 'chosen image' : wallpaper.name) : 'not found'}
        </span>
      </div>
      {THEMES.map((t) => {
        const sw = mode === 'dark' ? t.dark : t.light
        return (
          <div
            key={t.id}
            className={`theme-row${theme === t.id ? ' sel' : ''}`}
            onClick={() => setTheme(t.id)}
          >
            <span className="theme-sw">
              {sw.map((c) => (
                <i key={c} style={{ background: c }} />
              ))}
            </span>
            {t.label}
          </div>
        )
      })}
    </div>
  )
}
