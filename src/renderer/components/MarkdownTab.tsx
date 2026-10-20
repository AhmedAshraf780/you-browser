import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { createTheme } from '@uiw/codemirror-themes'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting } from '@codemirror/language'
import { EditorView, keymap } from '@codemirror/view'
import { searchKeymap } from '@codemirror/search'
import { vim } from '@replit/codemirror-vim'
import { tags as t } from '@lezer/highlight'
import { useStore } from '../store'
import { registerEditor, unregisterEditor } from '../webviews'
import { Tab } from '../tabs'
import { renderMarkdown } from '../markdown/pipeline'
import { escapeHtml } from '../markdown/escape'
import { inkdropHighlightStyle } from '../markdown/highlight-style'
import 'katex/dist/katex.min.css'
import '../markdown/inkdrop.css'

/**
 * CodeMirror chrome (caret, background, gutters) resolves from our live CSS
 * vars so palette/mode switches repaint with no theme rebuild. Code token
 * colouring is delegated to `inkdropHighlightStyle` (the same `tok-*` classes
 * the preview uses, painted by `markdown/inkdrop.css`), so the editor and the
 * preview share Inkdrop's exact syntax palette.
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
  // Markdown-structural tokens only — code tokens come from the Inkdrop style.
  styles: [
    { tag: t.heading, color: 'var(--accent)', fontWeight: '700' },
    { tag: [t.strong], fontWeight: '700' },
    { tag: [t.emphasis], fontStyle: 'italic' },
    { tag: [t.link], color: 'var(--accent)' },
    { tag: [t.url], color: 'var(--text-dim)' },
    { tag: [t.quote], color: 'var(--text-dim)', fontStyle: 'italic' },
    { tag: [t.meta, t.punctuation], color: 'var(--text-dim)' }
  ]
})

export function MarkdownTab({ tab }: { tab: Tab }): JSX.Element {
  const [text, setText] = useState('# loading…')
  // Preview lags typing: the editor stays instant while the full unified
  // re-parse + hast rewrite + highlight happens off the keystroke path.
  const [preview, setPreview] = useState('# loading…')
  const [html, setHtml] = useState('')
  const [view, setView] = useState<'edit' | 'split' | 'preview'>('split')
  const vimMode = useStore((s) => s.vimMode)
  const setVimMode = useStore((s) => s.setVimMode)
  const mode = useStore((s) => s.mode)
  const openTab = useStore((s) => s.openTab)
  const previewRef = useRef<HTMLDivElement>(null)

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

  // Render through the full Inkdrop pipeline (unified/remark/rehype).
  useEffect(() => {
    let alive = true
    renderMarkdown(preview)
      .then(({ html }) => {
        if (alive) setHtml(html)
      })
      .catch((err) => {
        if (alive) setHtml(`<p class="mde-error-message">${String(err)}</p>`)
      })
    return () => {
      alive = false
    }
  }, [preview])

  useEffect(() => {
    const t = setTimeout(() => {
      window.vault.write(tab.target, text).catch(() => {
        // save failed — next keystroke retries
      })
    }, 600)
    return () => clearTimeout(t)
  }, [text, tab.target])

  useEffect(() => () => unregisterEditor(tab.id), [tab.id])

  // Mermaid diagrams are rendered client-side after the HTML is swapped in,
  // replicating `@inkdropapp/mermaid` (render into `.mermaid-dot-grid`, plus a
  // themed floating toolbar for zoom / reset / full-screen).
  useEffect(() => {
    const root = previewRef.current
    if (!root) return
    const nodes = Array.from(
      root.querySelectorAll<HTMLElement>(".mermaid-dot-grid[data-mermaid-src]")
    )
    if (nodes.length === 0) return
    let cancelled = false
    const cleanups: Array<() => void> = []

    void (async () => {
      const mermaid = (await import("mermaid")).default
      const styles = getComputedStyle(document.documentElement)
      const cssVar = (name: string, fallback: string) =>
        styles.getPropertyValue(name).trim() || fallback
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "loose",
        theme: "base",
        themeVariables: {
          darkMode: mode === "dark",
          background: cssVar("--bg", "#000000"),
          primaryColor: cssVar("--bg-raise", "#111111"),
          primaryTextColor: cssVar("--text", "#dddddd"),
          primaryBorderColor: cssVar("--border", "#333333"),
          lineColor: cssVar("--text-dim", "#888888"),
          secondaryColor: cssVar("--bg-raise", "#111111"),
          tertiaryColor: cssVar("--bg", "#000000"),
          fontSize: "16px",
        },
      })

      for (const node of nodes) {
        const diagram = node.closest(".mermaid-diagram") as HTMLElement | null
        const content = node.closest(".mermaid-diagram-content") as HTMLElement | null
        const source = decodeURIComponent(node.dataset.mermaidSrc || "")
        const id = `mermaid-${Math.random().toString(36).replace(/[^a-z]+/g, "").slice(0, 5)}`
        try {
          const { svg } = await mermaid.render(id, source)
          if (cancelled) return
          node.innerHTML = svg
        } catch (err) {
          if (cancelled) return
          node.innerHTML = ""
          const box = document.createElement("div")
          box.className = "ui error message"
          box.innerHTML =
            `<div class="header">Failed to render Mermaid</div>` +
            `<div><pre>${escapeHtml(err instanceof Error ? err.message : String(err))}</pre></div>`
          diagram?.appendChild(box)
          continue
        }

        if (!diagram || !content) continue
        let scale = 1
        const setScale = (next: number): void => {
          scale = Math.min(8, Math.max(0.2, next))
          content.style.transform = `scale(${scale})`
        }
        const onToolbarClick = (event: Event): void => {
          const button = (event.target as HTMLElement).closest("button[data-mermaid-action]")
          if (!button) return
          switch (button.getAttribute("data-mermaid-action")) {
            case "zoom-in":
              setScale(scale * 1.4)
              break
            case "zoom-out":
              setScale(scale / 1.4)
              break
            case "reset":
              setScale(1)
              break
            case "expand":
              if (document.fullscreenElement) void document.exitFullscreen()
              else void diagram.requestFullscreen()
              break
          }
        }
        const toolbar = diagram.querySelector(".mermaid-toolbar")
        toolbar?.addEventListener("click", onToolbarClick)
        cleanups.push(() => toolbar?.removeEventListener("click", onToolbarClick))
      }
    })()

    return () => {
      cancelled = true
      for (const fn of cleanups) fn()
    }
  }, [html, mode])

  const onPreviewClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement

      // Copy-to-clipboard button on fenced code blocks.
      const copy = target.closest('.copy-to-clipboard') as HTMLButtonElement | null
      if (copy) {
        event.preventDefault()
        const code = copy.dataset.code ?? ''
        void navigator.clipboard.writeText(code).then(() => {
          copy.classList.add('copied')
          window.setTimeout(() => copy.classList.remove('copied'), 1500)
        })
        return
      }

      // Links: fragments scroll in place, everything else opens a web tab.
      const anchor = target.closest('a') as HTMLAnchorElement | null
      if (anchor) {
        const href = anchor.getAttribute('href') || ''
        if (href.startsWith('#')) return
        event.preventDefault()
        if (/^https?:\/\//i.test(href)) openTab('web', href)
      }
    },
    [openTab]
  )

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
              extensions={[
                markdown({ codeLanguages: languages }),
                syntaxHighlighting(inkdropHighlightStyle),
                keymap.of(searchKeymap),
                EditorView.lineWrapping,
                ...(vimMode ? [vim()] : [])
              ]}
              basicSetup={{ lineNumbers: false, foldGutter: false }}
              onChange={(v) => setText(v)}
              onCreateEditor={(v) => registerEditor(tab.id, v)}
            />
          </div>
        )}
        {view !== 'edit' && (
          <div
            className="mde-preview-container"
            style={{
              flex: 1,
              minWidth: 0,
              background: 'var(--bg)'
            }}
          >
            <div
              ref={previewRef}
              className="mde-preview"
              onClick={onPreviewClick}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
