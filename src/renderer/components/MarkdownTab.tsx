import { useEffect, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { createTheme } from '@uiw/codemirror-themes'
import { markdown } from '@codemirror/lang-markdown'
import { keymap } from '@codemirror/view'
import { searchKeymap } from '@codemirror/search'
import { vim } from '@replit/codemirror-vim'
import { tags as t } from '@lezer/highlight'
import { marked } from 'marked'
import { useStore } from '../store'
import { registerEditor, unregisterEditor } from '../webviews'
import { Tab } from '../tabs'

/**
 * Single CodeMirror theme for every app theme: all chrome colors resolve
 * from our live CSS vars, so palette/mode switches repaint the editor
 * with no theme rebuild. (The old native textarea is gone — its caret
 * desync can't happen in a CodeMirror-rendered document.)
 */
const ubTheme = createTheme({
  theme: 'dark',
  settings: {
    background: 'var(--bg)',
    backgroundImage: '',
    foreground: 'var(--text)',
    caret: 'var(--accent)',
    selection: 'rgba(128, 128, 128, 0.25)',
    selectionMatch: 'rgba(128, 128, 128, 0.15)',
    lineHighlight: 'rgba(128, 128, 128, 0.07)',
    gutterBackground: 'var(--bg)',
    gutterForeground: 'var(--text-dim)'
  },
  styles: [
    { tag: t.heading, color: 'var(--accent)', fontWeight: '700' },
    { tag: [t.strong], fontWeight: '700' },
    { tag: [t.emphasis], fontStyle: 'italic' },
    { tag: [t.link], color: 'var(--accent)' },
    { tag: [t.url], color: 'var(--text-dim)' },
    { tag: [t.quote], color: 'var(--text-dim)', fontStyle: 'italic' },
    { tag: [t.monospace], color: 'var(--text)' },
    { tag: [t.list, t.meta, t.punctuation], color: 'var(--accent)' }
  ]
})

export function MarkdownTab({ tab }: { tab: Tab }): JSX.Element {
  const [text, setText] = useState('# loading…')
  // Preview lags typing by 300ms: the editor stays instant while the
  // expensive full re-parse + DOM swap happens off the keystroke path.
  const [preview, setPreview] = useState('# loading…')
  const [view, setView] = useState<'edit' | 'split' | 'preview'>('split')
  const vimMode = useStore((s) => s.vimMode)
  const setVimMode = useStore((s) => s.setVimMode)

  useEffect(() => {
    let alive = true
    setText('# loading…')
    window.vault
      .read(tab.target)
      .then((r) => {
        if (alive) setText(r.data)
      })
      .catch(() => {
        if (alive) setText(`# ${tab.target}\n\nNew note. Start typing — autosaves to vault.`)
      })
    return () => {
      alive = false
    }
  }, [tab.target])

  useEffect(() => {
    const t = setTimeout(() => setPreview(text), 300)
    return () => clearTimeout(t)
  }, [text])

  useEffect(() => {
    const t = setTimeout(() => {
      window.vault.write(tab.target, text).catch(() => {
        // save failed — next keystroke retries
      })
    }, 600)
    return () => clearTimeout(t)
  }, [text, tab.target])

  useEffect(() => () => unregisterEditor(tab.id), [tab.id])

  return (
    <div style={{ display: 'flex', height: '100%', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          fontSize: 11,
          color: 'var(--text-dim)',
          padding: '6px 10px',
          flex: 'none',
          borderBottom: '1px solid var(--border)'
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tab.target}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 2, flex: 'none' }}>
          {(['edit', 'split', 'preview'] as const).map((v) => (
            <button
              key={v}
              className={`btn${view === v ? ' on' : ''}`}
              style={{ padding: '2px 8px', fontSize: 11 }}
              title={v === 'edit' ? 'Editor only' : v === 'split' ? 'Editor + preview' : 'Preview only'}
              onClick={() => setView(v)}
            >
              {v === 'edit' ? 'Edit' : v === 'split' ? 'Split' : 'View'}
            </button>
          ))}
          <button
            className={`btn${vimMode ? ' on' : ''}`}
            style={{ padding: '2px 8px', fontSize: 11 }}
            title="Vim modal editing for notes"
            onClick={() => setVimMode(!vimMode)}
          >
            Vim
          </button>
        </span>
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {view !== 'preview' && (
          <div
            className="md-cm"
            style={{
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              overflow: 'hidden',
              fontSize: 14,
              borderRight: view === 'split' ? '1px solid var(--border)' : 'none'
            }}
          >
            <CodeMirror
              value={text}
              height="100%"
              theme={ubTheme}
              extensions={[markdown(), keymap.of(searchKeymap), ...(vimMode ? [vim()] : [])]}
              basicSetup={{ lineNumbers: false, foldGutter: false }}
              onChange={(v) => setText(v)}
              onCreateEditor={(v) => registerEditor(tab.id, v)}
            />
          </div>
        )}
        {view !== 'edit' && (
          <div
            className="md-preview"
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'auto',
              padding: 20,
              background: 'var(--bg-soft)',
              color: 'var(--text)',
              // full-width reading column in View mode, constrained in Split
              maxWidth: view === 'preview' ? 980 : undefined,
              margin: view === 'preview' ? '0 auto' : undefined,
              width: '100%'
            }}
            dangerouslySetInnerHTML={{ __html: marked.parse(preview) as string }}
          />
        )}
      </div>
    </div>
  )
}
