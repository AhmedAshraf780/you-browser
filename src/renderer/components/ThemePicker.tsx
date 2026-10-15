import { useStore, type ColorMode } from '../store'
import type { ThemeId } from '../store'

interface ThemeDef {
  id: ThemeId
  label: string
  dark: [string, string, string]
  light: [string, string, string]
}

export const THEMES: ThemeDef[] = [
  { id: 'immortal', label: 'Black Metal · Immortal', dark: ['#000000', '#cccccc', '#eeeeee'], light: ['#f4f4f4', '#111111', '#000000'] },
  { id: 'rose-pine', label: 'Rosé Pine', dark: ['#191724', '#e0def4', '#c4a7e7'], light: ['#faf4ed', '#575279', '#907aa9'] },
  { id: 'catppuccin', label: 'Catppuccin', dark: ['#1e1e2e', '#cdd6f4', '#cba6f7'], light: ['#eff1f5', '#4c4f69', '#8839ef'] },
  { id: 'gruvbox', label: 'Gruvbox', dark: ['#282828', '#ebdbb2', '#fabd2f'], light: ['#fbf1c7', '#3c3836', '#b57614'] },
  { id: 'tokyo-night', label: 'Tokyo Night', dark: ['#1a1b26', '#c0caf5', '#7aa2f7'], light: ['#d5d6db', '#343b59', '#34548a'] }
]

/** Inline theme controls for the settings panel (mode switch + theme list). */
export function ThemeControls(): JSX.Element {
  const theme = useStore((s) => s.theme)
  const mode = useStore((s) => s.mode)
  const setTheme = useStore((s) => s.setTheme)
  const setMode = useStore((s) => s.setMode)

  const pickMode = (m: ColorMode): void => setMode(m)

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
