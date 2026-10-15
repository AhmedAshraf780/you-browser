/** Live webview handles keyed by tab id, so top-bar controls (reload, …)
 *  can reach the active guest page. Entries are added/removed as WebTabs
 *  mount and unmount. */

interface WebviewControls {
  reload: () => void
  goBack: () => void
  goForward: () => void
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
