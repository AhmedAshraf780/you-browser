/** Shared vault path helpers (renderer-side, no node deps). */

export interface TreeNode {
  name: string
  /** vault-relative, posix-style: `notes/roadmap/cache.md` */
  path: string
  isDir: boolean
  children?: TreeNode[]
  /** file mtime for recency sorting; 0 when unknown */
  mtimeMs?: number
}

export function baseName(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

/** Parent vault path of a node, '' for root-level. */
export function parentDir(p: string): string {
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i)
}

export function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

/** Newest-first vault files matching extensions. */
export function recentVaultFiles(nodes: TreeNode[], exts: string[], limit: number): Array<{ path: string; mtimeMs: number }> {
  const out: Array<{ path: string; mtimeMs: number }> = []
  const walk = (ns: TreeNode[]): void => {
    for (const n of ns) {
      if (n.isDir) walk(n.children ?? [])
      else if (exts.some((e) => n.path.toLowerCase().endsWith(e))) {
        out.push({ path: n.path, mtimeMs: n.mtimeMs ?? 0 })
      }
    }
  }
  walk(nodes)
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit)
}

/** Flat vault file list for pickers. */
export function flattenTree(nodes: TreeNode[]): string[] {
  const out: string[] = []
  const walk = (ns: TreeNode[]): void => {
    for (const n of ns) {
      if (n.isDir) walk(n.children ?? [])
      else out.push(n.path)
    }
  }
  walk(nodes)
  return out
}
