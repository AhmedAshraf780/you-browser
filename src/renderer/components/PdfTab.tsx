import { useEffect, useState } from 'react'
import { Tab } from '../tabs'

/**
 * Local vault PDFs render in our Firefox-style viewer (PDF.js, offline);
 * remote http(s) PDFs keep the native Chromium viewer (avoids CORS walls).
 */
export function PdfTab({ tab }: { tab: Tab }): JSX.Element {
  const [url, setUrl] = useState<string>('')
  const [err, setErr] = useState('')

  useEffect(() => {
    let objUrl = ''
    if (tab.target.startsWith('http')) {
      setUrl(tab.target)
      return
    }
    window.vault
      .read(tab.target)
      .then((r) => {
        const bytes = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0))
        const blob = new Blob([bytes], { type: 'application/pdf' })
        objUrl = URL.createObjectURL(blob)
        setUrl(`pdfjs/web/viewer.html?file=${encodeURIComponent(objUrl)}`)
      })
      .catch((e) => setErr(String(e)))
    return () => {
      if (objUrl) URL.revokeObjectURL(objUrl)
    }
  }, [tab.target])

  if (err) return <div style={{ padding: 20, color: '#ff6b6b' }}>{err}</div>
  if (!url) return <div style={{ padding: 20, color: 'var(--text-dim)' }}>loading pdf…</div>
  return <iframe title={tab.target} src={url} style={{ width: '100%', height: '100%', border: 'none' }} />
}
