/** Live webview handles keyed by tab id, so top-bar controls (reload, …)
 *  can reach the active guest page. Entries are added/removed as WebTabs
 *  mount and unmount. */

interface WebviewControls {
  reload: () => void
  goBack: () => void
  goForward: () => void
  findInPage: (text: string, options?: { forward?: boolean; matchCase?: boolean }) => number
  stopFindInPage: (action: 'clearSelection' | 'keepSelection' | 'activateSelection') => void
  addEventListener: (e: string, cb: (ev: unknown) => void) => void
  removeEventListener: (e: string, cb: (ev: unknown) => void) => void
  executeJavaScript: (code: string) => Promise<unknown>
}

const map = new Map<string, WebviewControls>()

export function registerWebview(id: string, el: WebviewControls): void {
  map.set(id, el)
}

export function unregisterWebview(id: string): void {
  map.delete(id)
}

export function getWebview(id: string): WebviewControls | undefined {
  return map.get(id)
}

/** CodeMirror editor views keyed by tab id, for programmatic find etc.
 *  Stored untyped (real EditorView); call sites cast to the CM type. */

const editors = new Map<string, unknown>()

export function registerEditor(id: string, view: unknown): void {
  editors.set(id, view)
}

export function unregisterEditor(id: string): void {
  editors.delete(id)
}

export function getEditor(id: string): unknown {
  return editors.get(id)
}
