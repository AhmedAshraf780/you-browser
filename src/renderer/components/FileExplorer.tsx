import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { typeForPath } from '../tabs'
import { TreeNode, baseName, joinPath, parentDir } from '../vault'

type CreateKind = 'md' | 'excalidraw' | 'folder'

const KIND_LABEL: Record<CreateKind, string> = {
  md: 'note.md',
  excalidraw: 'drawing.excalidraw',
  folder: 'folder'
}

function filterTree(nodes: TreeNode[], q: string): TreeNode[] {
  const out: TreeNode[] = []
  for (const n of nodes) {
    if (n.isDir) {
      const kids = filterTree(n.children ?? [], q)
      if (n.name.toLowerCase().includes(q)) out.push(n)
      else if (kids.length > 0) out.push({ ...n, children: kids })
    } else if (n.name.toLowerCase().includes(q)) {
      out.push(n)
    }
  }
  return out
}

/** Names starting with a dot are hidden from the tree (dotfile rule). */
function assertVisible(name: string): void {
  if (name.startsWith('.')) {
    throw new Error(`"${name}" starts with a dot, so it would be hidden from the explorer. Pick another name.`)
  }
}

export function FileExplorer(): JSX.Element {
  const tree = useStore((s) => s.tree)
  const openTab = useStore((s) => s.openTab)
  const refreshTree = useStore((s) => s.refreshTree)
  const activeTarget = useStore((s) => s.tabs.find((t) => t.id === s.activeId)?.target ?? null)

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<{ x: number; y: number; node: TreeNode | null } | null>(null)
  const [creating, setCreating] = useState<{ parent: string; kind: CreateKind } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const filtering = query.trim().length > 0
  const view = useMemo(
    () => (filtering ? filterTree(tree, query.trim().toLowerCase()) : tree),
    [tree, query, filtering]
  )

  const toggle = (path: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  /** Expand a folder and every ancestor so a new/renamed node is always visible. */
  const expandChain = (dir: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev)
      let cur: string | null = dir
      while (cur) {
        next.add(cur)
        cur = parentDir(cur) || null
      }
      return next
    })

  const flashPath = (path: string): void => {
    setFlash(path)
    setTimeout(() => setFlash((f) => (f === path ? null : f)), 2500)
  }

  const startCreate = (parent: string, kind: CreateKind): void => {
    setMenu(null)
    setRenaming(null)
    setQuery('')
    if (parent) expandChain(parent)
    setCreating({ parent, kind })
  }

  const commitCreate = async (raw: string): Promise<void> => {
    const c = creating
    setCreating(null)
    if (!c) return
    const name = raw.trim().replace(/[/\\]/g, '')
    if (!name) return
    try {
      assertVisible(name)
      if (c.kind === 'folder') {
        const target = joinPath(c.parent, name)
        await window.vault.mkdir(target)
        expandChain(target)
        flashPath(target)
      } else {
        let target = joinPath(c.parent, name)
        if (c.kind === 'md') {
          if (!/\.(md|mf)$/i.test(target)) target += '.md'
          await window.vault.write(target, `# ${baseName(target)}\n\n`)
        } else {
          if (!/\.excalidraw$/i.test(target)) target += '.excalidraw'
          await window.vault.write(target, JSON.stringify({ elements: [] }))
        }
        expandChain(c.parent)
        flashPath(target)
        openTab(typeForPath(target), target)
      }
    } catch (e) {
      alert(`Could not create: ${e instanceof Error ? e.message : e}`)
    }
    refreshTree()
  }

  const commitRename = async (node: TreeNode, raw: string): Promise<void> => {
    setRenaming(null)
    const name = raw.trim().replace(/[/\\]/g, '')
    if (!name || name === node.name) return
    const dest = joinPath(parentDir(node.path), name)
    try {
      assertVisible(name)
      await window.vault.rename(node.path, dest)
      // keep open tabs pointing at the renamed file/folder
      const st = useStore.getState()
      for (const t of st.tabs) {
        if (t.target === node.path || t.target.startsWith(node.path + '/')) {
          const rest = t.target.slice(node.path.length)
          st.updateTab(t.id, { target: dest + rest, title: baseName(dest + rest) })
        }
      }
      expandChain(parentDir(dest))
      flashPath(dest)
    } catch (e) {
      alert(`Could not rename: ${e instanceof Error ? e.message : e}`)
    }
    refreshTree()
  }

  const removeNode = async (node: TreeNode): Promise<void> => {
    setMenu(null)
    if (!confirm(`Delete ${node.path}?${node.isDir ? '\n\nThe folder and everything inside it will be removed.' : ''}`)) return
    try {
      await window.vault.remove(node.path)
      // close tabs that pointed at the deleted file/folder
      const st = useStore.getState()
      for (const t of st.tabs) {
        if (t.target === node.path || t.target.startsWith(node.path + '/')) st.closeTab(t.id)
      }
    } catch (e) {
      alert(`Could not delete: ${e instanceof Error ? e.message : e}`)
    }
    refreshTree()
  }

  const rowProps = {
    activeTarget,
    flash,
    filtering,
    expanded,
    renaming,
    creating,
    onToggleDir: (node: TreeNode) => toggle(node.path),
    onOpenFile: (node: TreeNode) => openTab(typeForPath(node.path), node.path),
    onMenu: (e: React.MouseEvent, node: TreeNode) => {
      e.preventDefault()
      e.stopPropagation()
      setMenu({ x: e.clientX, y: e.clientY, node })
    },
    onCommitCreate: (v: string) => void commitCreate(v),
    onCancelCreate: () => setCreating(null),
    onCommitRename: (node: TreeNode, v: string) => void commitRename(node, v),
    onCancelRename: () => setRenaming(null)
  }

  return (
    <div className="ubx-wrap">
      <input
        className="ubx-filter"
        value={query}
        placeholder="Filter files…"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
      />
      <div style={{ display: 'flex', gap: 4, marginBottom: 6, padding: '0 2px' }}>
        <button className="btn" style={{ flex: 1, background: 'var(--bg-raise)' }} onClick={() => startCreate('', 'md')} title="New note in vault root">
          + Note
        </button>
        <button className="btn" style={{ flex: 1, background: 'var(--bg-raise)' }} onClick={() => startCreate('', 'excalidraw')} title="New drawing in vault root">
          + Draw
        </button>
        <button className="btn" style={{ flex: 1, background: 'var(--bg-raise)' }} onClick={() => startCreate('', 'folder')} title="New folder in vault root">
          + Folder
        </button>
      </div>
      <div
        className="ubx-tree"
        style={{ flex: 1, minHeight: 0 }}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, node: null })
        }}
      >
        {creating?.parent === '' && (
          <div style={{ paddingLeft: 8, paddingBottom: 4 }}>
            <NameInput
              placeholder={KIND_LABEL[creating.kind]}
              onCommit={rowProps.onCommitCreate}
              onCancel={rowProps.onCancelCreate}
            />
          </div>
        )}
        {view.length === 0 && !creating && (
          <div className="side-empty">
            {filtering ? 'no matches' : 'empty folder — use the buttons above'}
          </div>
        )}
        {view.map((n) => (
          <NodeRow key={n.path} {...rowProps} node={n} depth={0} />
        ))}

        {menu && (
          <>
            <div className="ubx-menu-overlay" onClick={() => setMenu(null)} onContextMenu={(e) => e.preventDefault()} />
            <ContextMenu
              x={menu.x}
              y={menu.y}
              node={menu.node}
              onCreate={startCreate}
              onRename={(node) => {
                setMenu(null)
                setCreating(null)
                setRenaming(node.path)
              }}
              onDelete={removeNode}
              onClose={() => setMenu(null)}
            />
          </>
        )}
      </div>
    </div>
  )
}

/* ---------- rows ---------- */

interface RowProps {
  node: TreeNode
  depth: number
  activeTarget: string | null
  flash: string | null
  filtering: boolean
  expanded: Set<string>
  renaming: string | null
  creating: { parent: string; kind: CreateKind } | null
  onToggleDir: (node: TreeNode) => void
  onOpenFile: (node: TreeNode) => void
  onMenu: (e: React.MouseEvent, node: TreeNode) => void
  onCommitCreate: (name: string) => void
  onCancelCreate: () => void
  onCommitRename: (node: TreeNode, name: string) => void
  onCancelRename: () => void
}

function NodeRow(props: RowProps): JSX.Element {
  const { node, depth } = props
  const isOpen = props.filtering || props.expanded.has(node.path)
  const type = node.isDir ? 'folder' : typeForPath(node.path)
  const DOT: Record<string, string> = {
    web: '#4da3ff',
    markdown: '#7bd88f',
    excalidraw: '#c792ea',
    pdf: '#ff6b6b',
    folder: '#888'
  }
  const isActive = props.activeTarget === node.path
  const isFlash = props.flash === node.path

  return (
    <div>
      <div
        className="ubx-node"
        data-path={node.path}
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingLeft: 8 + depth * 14,
          paddingRight: 8,
          paddingTop: 5,
          paddingBottom: 5,
          borderRadius: 6,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          background: isFlash || isActive ? 'var(--bg-raise)' : 'transparent'
        }}
        onClick={() => (node.isDir ? props.onToggleDir(node) : props.onOpenFile(node))}
        onContextMenu={(e) => props.onMenu(e, node)}
        title={node.path}
      >
        {node.isDir ? (
          <span style={{ flex: 'none', width: 12, color: 'var(--text-dim)', fontSize: 11 }}>
            {isOpen ? '▾' : '▸'}
          </span>
        ) : (
          <span
            title={type}
            style={{
              flex: 'none',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: DOT[type] ?? '#888'
            }}
          />
        )}
        {props.renaming === node.path ? (
          <NameInput
            initial={node.name}
            selectBase={!node.isDir}
            onCommit={(v) => props.onCommitRename(node, v)}
            onCancel={props.onCancelRename}
          />
        ) : (
          // fallback to full path so a row can never render textless
          <span
            style={{
              flex: '1 1 auto',
              minWidth: 0,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
              color: isFlash ? 'var(--accent)' : isActive ? 'var(--text)' : 'var(--text)',
              fontWeight: isActive && !isFlash ? 600 : 400
            }}
          >
            {node.name || node.path}
          </span>
        )}
      </div>
      {node.isDir && isOpen && (
        <>
          {props.creating?.parent === node.path && (
            <div style={{ paddingLeft: 8 + (depth + 1) * 14 }}>
              <NameInput
                placeholder={KIND_LABEL[props.creating.kind]}
                onCommit={props.onCommitCreate}
                onCancel={props.onCancelCreate}
              />
            </div>
          )}
          {node.children?.map((c) => <NodeRow key={c.path} {...props} node={c} depth={depth + 1} />)}
          {node.children?.length === 0 && props.creating?.parent !== node.path && (
            <div
              style={{
                paddingLeft: 8 + (depth + 1) * 14,
                fontSize: 11,
                color: 'var(--text-dim)',
                paddingTop: 2,
                paddingBottom: 2
              }}
            >
              empty — right-click for new file
            </div>
          )}
        </>
      )}
    </div>
  )
}

function NameInput({
  initial = '',
  placeholder = 'name',
  selectBase = false,
  onCommit,
  onCancel
}: {
  initial?: string
  placeholder?: string
  selectBase?: boolean
  onCommit: (v: string) => void
  onCancel: () => void
}): JSX.Element {
  const [value, setValue] = useState(initial)
  return (
    <input
      className="ubx-input"
      style={{
        flex: '1 1 auto',
        minWidth: 0,
        background: 'var(--bg-raise)',
        color: 'var(--text)',
        border: '1px solid var(--accent)',
        borderRadius: 6,
        padding: '3px 6px',
        fontSize: 13,
        outline: 'none'
      }}
      autoFocus
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => {
        if (!selectBase || !initial) {
          e.target.select()
          return
        }
        // select name without extension, like VSCode
        const dot = initial.lastIndexOf('.')
        e.target.setSelectionRange(0, dot > 0 ? dot : initial.length)
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') onCommit(value)
        if (e.key === 'Escape') onCancel()
      }}
      onBlur={() => onCommit(value)}
    />
  )
}

/* ---------- context menu ---------- */

function ContextMenu({
  x,
  y,
  node,
  onCreate,
  onRename,
  onDelete,
  onClose
}: {
  x: number
  y: number
  node: TreeNode | null
  onCreate: (parent: string, kind: CreateKind) => void
  onRename: (node: TreeNode) => void
  onDelete: (node: TreeNode) => void
  onClose: () => void
}): JSX.Element {
  // creation target: the folder itself, the file's parent, or vault root
  const parent = node ? (node.isDir ? node.path : parentDir(node.path)) : ''
  const items: Array<{ label: string; run: () => void }> = [
    { label: 'New note', run: () => onCreate(parent, 'md') },
    { label: 'New drawing', run: () => onCreate(parent, 'excalidraw') },
    { label: 'New folder', run: () => onCreate(parent, 'folder') }
  ]
  if (node) {
    items.push(
      { label: 'Rename', run: () => onRename(node) },
      { label: 'Delete', run: () => void onDelete(node) }
    )
  }
  const w = 180
  const h = items.length * 30 + 8
  return (
    <div
      className="ubx-menu"
      style={{ left: Math.min(x, window.innerWidth - w), top: Math.min(y, window.innerHeight - h) }}
      onClick={onClose}
    >
      {items.map((it) => (
        <div key={it.label} className="ubx-item" onClick={it.run}>
          {it.label}
        </div>
      ))}
    </div>
  )
}
