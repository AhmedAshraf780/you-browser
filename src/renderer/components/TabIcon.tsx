import { useEffect, useState } from 'react'
import {
  CalendarDays,
  DraftingCompass,
  FileText,
  FileType,
  Globe,
  House,
  Languages,
  SquareKanban,
  SquareTerminal,
  StickyNote,
  type LucideIcon
} from 'lucide-react'
import type { TabType } from '../tabs'

const MAP: Record<TabType, LucideIcon> = {
  web: Globe,
  markdown: FileText,
  excalidraw: DraftingCompass,
  pdf: FileType,
  home: House,
  kanban: SquareKanban,
  blinko: StickyNote,
  calendar: CalendarDays,
  terminal: SquareTerminal,
  vocab: Languages
}

function hostOf(target: string): string | null {
  try {
    const url = new URL(target)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/** Monochrome type pictograms for the tab strip (theme-colored).
 *  Web tabs show the site's real favicon, falling back to the globe. */
export function TabIcon({ type, target, size = 13 }: { type: TabType; target?: string; size?: number }): JSX.Element {
  const host = type === 'web' && target ? hostOf(target) : null
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
  }, [host])

  if (host && !failed) {
    return (
      <img
        src={`https://${host}/favicon.ico`}
        alt=""
        width={size}
        height={size}
        draggable={false}
        style={{ flex: 'none', borderRadius: 3 }}
        onError={() => setFailed(true)}
      />
    )
  }
  const Icon = MAP[type]
  return <Icon size={size} strokeWidth={1.8} style={{ flex: 'none' }} />
}
