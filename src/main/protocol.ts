import { protocol } from 'electron'
import { promises as fs } from 'fs'
import { extname, resolve } from 'path'
import { sniffMime } from './wallpaper'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
  },
  {
    // The desktop wallpaper, so the renderer can decode it (any format Chromium
    // supports) and derive a theme from its pixels.
    scheme: 'you-wall',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
  },
  {
    // Files inside the vault (card images, voice recordings). Streamed so
    // <audio>/<video> can seek, and range-capable like a real HTTP server.
    scheme: 'vault',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
  }
])

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ftl': 'text/plain',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  // vault assets (card images + voice recordings)
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.flac': 'audio/flac',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska'
}

/**
 * Serve the bundled renderer over app:// with real HTTP semantics
 * (MIME types, CORS, byte ranges). file:// breaks ES modules, fetch(),
 * workers and blob validation in subtle per-resource ways — most visibly
 * the PDF viewer loads its chrome but never its document. app:// behaves
 * exactly like the dev server, so dev-tested code works packaged.
 */
export function serveAppProtocol(rendererDir: string): void {
  const base = resolve(rendererDir)
  protocol.handle('app', async (req) => {
    try {
      const url = new URL(req.url)
      let rel = decodeURIComponent(url.pathname)
      if (rel.endsWith('/')) rel += 'index.html'
      const full = resolve(base, `.${rel}`)
      if (full !== base && !full.startsWith(`${base}/`)) {
        return new Response('forbidden', { status: 403 })
      }
      const stat = await fs.stat(full)
      if (stat.isDirectory()) {
        return new Response('not found', { status: 404 })
      }
      const data = await fs.readFile(full)
      const mime = MIME[extname(full).toLowerCase()] ?? 'application/octet-stream'
      const range = req.headers.get('range')
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range)
        const start = m && m[1] ? parseInt(m[1], 10) : 0
        const end = m && m[2] ? parseInt(m[2], 10) : data.length - 1
        const s = Math.max(0, Math.min(start, data.length - 1))
        const e = Math.max(s, Math.min(end, data.length - 1))
        return new Response(data.subarray(s, e + 1), {
          status: 206,
          headers: {
            'Content-Type': mime,
            'Content-Length': String(e - s + 1),
            'Content-Range': `bytes ${s}-${e}/${data.length}`,
            'Accept-Ranges': 'bytes'
          }
        })
      }
      return new Response(data, {
        status: 200,
        headers: { 'Content-Type': mime, 'Content-Length': String(data.length), 'Accept-Ranges': 'bytes' }
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

/**
 * Serve files from the vault over `vault://` so cards can show local images
 * and play voice notes. The renderer addresses them as `vault://v/<relpath>`
 * (relative to the vault root); anything that resolves outside the vault is
 * refused. Hidden folders are reachable on purpose — Blinko keeps its assets
 * in `.blinko-assets/` so they stay out of the file tree and search.
 */
export function serveVaultProtocol(vaultDir: () => string): void {
  protocol.handle('vault', async (req) => {
    try {
      const base = resolve(vaultDir())
      const url = new URL(req.url)
      let rel = decodeURIComponent(url.pathname)
      if (rel.startsWith('/')) rel = rel.slice(1)
      if (!rel) return new Response('not found', { status: 404 })
      const full = resolve(base, rel)
      if (full !== base && !full.startsWith(`${base}/`)) {
        return new Response('forbidden', { status: 403 })
      }
      const data = await fs.readFile(full)
      const mime = MIME[extname(full).toLowerCase()] ?? 'application/octet-stream'
      const range = req.headers.get('range')
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range)
        const start = m && m[1] ? parseInt(m[1], 10) : 0
        const end = m && m[2] ? parseInt(m[2], 10) : data.length - 1
        const s = Math.max(0, Math.min(start, data.length - 1))
        const e = Math.max(s, Math.min(end, data.length - 1))
        return new Response(data.subarray(s, e + 1), {
          status: 206,
          headers: {
            'Content-Type': mime,
            'Content-Length': String(e - s + 1),
            'Content-Range': `bytes ${s}-${e}/${data.length}`,
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*'
          }
        })
      }
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(data.length),
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*'
        }
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

/**
 * Serve the current desktop wallpaper over you-wall://.
 *
 * The URL is deliberately ignored — the *only* file reachable is the one the
 * main process is tracking (auto-detected or picked by the user). Nothing the
 * renderer sends can address another path, so there is no traversal surface.
 * The image is served with `Access-Control-Allow-Origin: *` so <img> +
 * canvas.getImageData() can read its pixels without tainting the canvas.
 */
export function serveWallpaperProtocol(current: () => string | null): void {
  protocol.handle('you-wall', async () => {
    const file = current()
    if (!file) return new Response('no wallpaper', { status: 404 })
    try {
      const data = await fs.readFile(file)
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': sniffMime(data),
          'Content-Length': String(data.length),
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*'
        }
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}
