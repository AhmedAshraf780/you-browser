import { useEffect, useRef } from 'react'
import { Tab } from '../tabs'
import { useStore } from '../store'
import { youtubeSkipper } from '../adskip'
import { registerWebview, unregisterWebview } from '../webviews'

type WebviewEl = HTMLElement & {
  reload(): void
  goBack(): void
  goForward(): void
  src: string
  getURL(): string
  executeJavaScript(code: string): Promise<unknown>
  insertCSS(css: string): Promise<string>
  removeInsertedCSS(key: string): Promise<void>
  addEventListener(e: string, cb: (ev: unknown) => void): void
  removeEventListener(e: string, cb: (ev: unknown) => void): void
}

function isYouTube(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host === 'youtu.be' || /(^|\.)youtube\.com$/.test(host) || /(^|\.)youtube-nocookie\.com$/.test(host)
  } catch {
    return false
  }
}

/** Scrollbar CSS for the guest page, resolved from our live theme vars. */
function pageScrollbarCSS(): string {
  let border = '#333333'
  let dim = '#888888'
  try {
    const cs = getComputedStyle(document.documentElement)
    border = cs.getPropertyValue('--border').trim() || border
    dim = cs.getPropertyValue('--text-dim').trim() || dim
  } catch {
    // host document unavailable — fallbacks above apply
  }
  return (
    '::-webkit-scrollbar{width:10px;height:10px}' +
    '::-webkit-scrollbar-track{background:transparent}' +
    '::-webkit-scrollbar-corner{background:transparent}' +
    `::-webkit-scrollbar-thumb{background:${border};border-radius:8px;border:3px solid transparent;background-clip:padding-box}` +
    `::-webkit-scrollbar-thumb:hover{background:${dim};border:3px solid transparent;background-clip:padding-box}`
  )
}

export function WebTab({ tab }: { tab: Tab }): JSX.Element {
  const ref = useRef<HTMLElement & { reload(): void; goBack(): void; goForward(): void; src: string } | null>(null)
  const updateTab = useStore((s) => s.updateTab)
  const recordVisit = useStore((s) => s.recordVisit)

  useEffect(() => {
    const el = ref.current as unknown as WebviewEl | null
    if (!el) return
    registerWebview(tab.id, el)
    const onTitle = (e: unknown): void => {
      const t = (e as { title?: string }).title
      if (!t) return
      updateTab(tab.id, { title: t.slice(0, 40) })
      // keep the recent-sites entry showing the real page title
      const cur = useStore.getState().tabs.find((x) => x.id === tab.id)
      if (cur) useStore.getState().retitleVisit(cur.target, t.slice(0, 60))
    }
    const onNav = (e: unknown): void => {
      const url = (e as { url?: string }).url
      if (!url || !url.startsWith('http')) return
      updateTab(tab.id, { target: url })
      let host = url
      try {
        host = new URL(url).hostname.replace(/^www\./, '')
      } catch {
        // keep raw url
      }
      recordVisit(url, host)
    }
    el.addEventListener('page-title-updated', onTitle)
    el.addEventListener('did-navigate', onNav)
    return () => {
      el.removeEventListener('page-title-updated', onTitle)
      el.removeEventListener('did-navigate', onNav)
      unregisterWebview(tab.id)
    }
  }, [tab.id, updateTab, recordVisit])

  // Themed scrollbars inside the guest page (insertCSS bypasses page CSP).
  // Re-applied on theme/mode change with the previous key removed.
  const loadedRef = useRef(false)
  const cssKeyRef = useRef<string | null>(null)
  const theme = useStore((s) => s.theme)
  const mode = useStore((s) => s.mode)
  useEffect(() => {
    const el = ref.current as unknown as WebviewEl | null
    if (!el) return
    const apply = (): void => {
      if (!loadedRef.current) return
      const css = pageScrollbarCSS()
      const old = cssKeyRef.current
      cssKeyRef.current = null
      const insert = (): void => {
        el.insertCSS(css).then((k) => {
          cssKeyRef.current = k
        }).catch(() => {
          // page gone mid-inject — next dom-ready covers it
        })
      }
      if (old) el.removeInsertedCSS(old).then(insert, insert)
      else insert()
    }
    const onReady = (): void => {
      loadedRef.current = true
      apply()
    }
    el.addEventListener('dom-ready', onReady)
    apply()
    return () => {
      el.removeEventListener('dom-ready', onReady)
    }
    // theme/mode in deps so switching palette repaints guest scrollbars
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, theme, mode])
  // YouTube ad-skipper: network lists can't catch video ads, so an in-page
  // script seeks past them + clicks skip + hides ad chrome. Persists across
  // YouTube's SPA navigations (same document), re-injected on full loads.
  useEffect(() => {
    const el = ref.current as unknown as WebviewEl | null
    if (!el) return
    const maybeInject = (): void => {
      let url = ''
      try {
        url = el.getURL() || tab.target
      } catch {
        url = tab.target
      }
      if (!isYouTube(url)) return
      el.executeJavaScript(`(${youtubeSkipper.toString()})()`).catch(() => {
        // page not ready / navigation raced — next dom-ready covers it
      })
    }
    el.addEventListener('dom-ready', maybeInject)
    return () => {
      el.removeEventListener('dom-ready', maybeInject)
    }
  }, [tab.id, tab.target])

  return (
    <webview
      ref={ref}
      src={tab.target}
      partition="persist:unibrowser"
      style={{ width: '100%', height: '100%', border: 'none' }}
    />
  )
}
