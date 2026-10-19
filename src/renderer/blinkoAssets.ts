/**
 * Vault-backed assets for Blinko cards.
 *
 * Images and voice notes are written next to the workspace as real files
 * (hidden `.blinko-assets/` folder) and referenced from the card markdown as
 * `vault:///…` URLs, which the main process streams back to the renderer.
 * That is the local analogue of Blinko uploading a file and inserting its URL.
 */

/** Hidden folder that holds every card asset in the vault. */
export const ASSET_ROOT = '.blinko-assets'

/** Largest single asset we will push through IPC as base64 (~30 MB). */
const MAX_ASSET_BYTES = 30 * 1024 * 1024

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg'])
const AUDIO_EXT = new Set(['mp3', 'm4a', 'wav', 'ogg', 'oga', 'opus', 'webm', 'flac', 'aac', 'mp4'])
const VIDEO_EXT = new Set(['mov', 'mkv', 'm4v'])

export type AssetKind = 'image' | 'audio' | 'video' | 'file'

export function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(name)
  return m ? m[1].toLowerCase() : ''
}

export function assetKind(name: string, mime = ''): AssetKind {
  const ext = extOf(name)
  if (mime.startsWith('image/') || IMAGE_EXT.has(ext)) return 'image'
  if (mime.startsWith('audio/') || AUDIO_EXT.has(ext)) return 'audio'
  if (mime.startsWith('video/') || VIDEO_EXT.has(ext)) return 'video'
  return 'file'
}

/**
 * Per-workspace asset folder, derived from the `.blinko` path so two boards
 * never mix their files: `notes/ideas.blinko` → `.blinko-assets/notes__ideas`.
 */
export function assetsDirFor(target: string): string {
  const clean = target.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const slash = clean.lastIndexOf('/')
  const dir = slash >= 0 ? clean.slice(0, slash) : ''
  const base = (slash >= 0 ? clean.slice(slash + 1) : clean).replace(/\.[^.]+$/, '')
  const stem = `${dir ? `${dir}__` : ''}${base || 'workspace'}`.replace(/[^\w.-]+/g, '_')
  return `${ASSET_ROOT}/${stem || 'workspace'}`
}

/** Collision-proof file name that keeps the original extension. */
export function uniqueAssetName(name: string, now = Date.now()): string {
  const ext = extOf(name)
  const stem = (ext ? name.slice(0, -(ext.length + 1)) : name)
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'asset'
  const stamp = new Date(now).toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  const salt = Math.random().toString(36).slice(2, 6)
  return `${stamp}-${salt}-${stem}${ext ? `.${ext}` : ''}`
}

/** `vault://v/a b/c.png` — segment-encoded so spaces/unicode survive. */
export function vaultUrl(relPath: string): string {
  const segs = relPath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
  return `vault://v/${segs.join('/')}`
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('could not read file'))
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(file)
  })
}

export interface SavedAsset {
  /** vault-relative path of the stored file */
  rel: string
  /** `vault:///…` URL to reference it by */
  url: string
  name: string
  kind: AssetKind
  size: number
}

/** Persist one file into the workspace's asset folder. */
export async function saveVaultAsset(
  blinkoTarget: string,
  file: File | Blob,
  name = (file as File).name || 'asset'
): Promise<SavedAsset> {
  if (file.size > MAX_ASSET_BYTES) {
    throw new Error(`“${name}” is larger than 30 MB`)
  }
  const rel = `${assetsDirFor(blinkoTarget)}/${uniqueAssetName(name)}`
  const b64 = await fileToBase64(file as File)
  await window.vault.writeBinary(rel, b64)
  return {
    rel,
    url: vaultUrl(rel),
    name,
    kind: assetKind(name, file.type),
    size: file.size
  }
}

/**
 * Markdown to drop at the cursor for a saved asset — a picture tag for
 * images, an inline <audio> player for voice notes, a link otherwise.
 */
export function assetMarkdown(asset: SavedAsset, label?: string): string {
  const text = label || asset.name
  if (asset.kind === 'image') return `![${text}](${asset.url})`
  if (asset.kind === 'audio') {
    return `<audio controls preload="metadata" src="${asset.url}"></audio>`
  }
  return `[${text}](${asset.url})`
}

/** Format whole seconds as mm:ss for voice-note labels. */
export function clockTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
