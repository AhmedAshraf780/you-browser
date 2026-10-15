import { useEffect, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { createTheme } from '@uiw/codemirror-themes'
import { markdown } from '@codemirror/lang-markdown'
import { tags as t } from '@lezer/highlight'
import { marked } from 'marked'
import { useStore } from '../store'
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
  const [status, setStatus] = useState('')

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
    const t = setTimeout(() => {
      window.vault.write(tab.target, text).then(() => {
        setStatus(`saved ${new Date().toLocaleTimeString()}`)
      })
    }, 600)
    return () => clearTimeout(t)
  }, [text, tab.target])

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, borderRight: '1px solid var(--border)' }}>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', padding: '6px 10px', flex: 'none' }}>
          {tab.target} · {status}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', fontSize: 14 }}>
          <CodeMirror
            value={text}
            height="100%"
            theme={ubTheme}
            extensions={[markdown()]}
            basicSetup={{ lineNumbers: false, foldGutter: false }}
            onChange={(v) => setText(v)}
          />
        </div>
      </div>
      <div
        className="md-preview"
        style={{ flex: 1, overflow: 'auto', padding: 20, background: 'var(--bg-soft)', color: 'var(--text)' }}
        dangerouslySetInnerHTML={{ __html: marked.parse(text) as string }}
      />
    </div>
  )
}
