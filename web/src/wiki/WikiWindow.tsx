// The wiki on the desk. Its own window (the button in the title bar) opens the same thing
// full-screen at /wiki, so it can sit on another screen while you work.
import { useState } from 'react'
import { BookOpen, SquareArrowOutUpRight } from 'lucide-react'
import { Button } from '../ui.tsx'
import { FloatingWindow } from '../desk/FloatingWindow.tsx'
import { openReadingWindow } from '../resources/resources.tsx'
import { setUi, useUi } from '../ui-store.ts'
import { WikiView } from './WikiView.tsx'
import { wikiPath } from './route.ts'
import type { Space } from '../../../shared/types.ts'

export function WikiWindow({ deskRef }: { deskRef: React.RefObject<HTMLDivElement | null> }) {
  // The address lives in the store, so opening a page from a note sends this window there.
  const route = useUi((s) => s.wiki)
  const [space, setSpace] = useState<Space | null>(null)
  const [page, setPage] = useState<{ id: number; slug: string } | null>(null)

  const go = (s: Space | null, p: { id: number; slug: string } | null) => {
    setSpace(s)
    setPage(p)
    setUi({ wiki: { spaceSlug: s?.slug ?? null, pageId: p?.id ?? null } })
  }

  return (
    <FloatingWindow id="wiki" title="Wiki" icon={<BookOpen size={17} />} closable deskRef={deskRef} className="window-wiki"
      defaultRect={(d) => ({
        x: Math.max(16, (d.width - Math.min(940, d.width - 40)) / 2),
        y: 60,
        w: Math.min(940, d.width - 40),
        h: Math.max(420, d.height - 110),
      })}
      actions={
        <Button size="sm" variant="ghost" title="Open the wiki in its own window"
          onClick={() => openReadingWindow(wikiPath(space ?? (route.spaceSlug ? { slug: route.spaceSlug } : null), page), 'deskwork-wiki')}>
          <SquareArrowOutUpRight size={14} /> Own window
        </Button>
      }>
      <WikiView route={route} go={go} />
    </FloatingWindow>
  )
}
