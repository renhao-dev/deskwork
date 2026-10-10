// The wiki in its own window, at /wiki. Back and forward work, every page has an address you can
// bookmark, and it's the same view the desk window shows.
import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import * as RTooltip from '@radix-ui/react-tooltip'
import { BookOpen, LayoutDashboard } from 'lucide-react'
import { Button, Toasts } from '../ui.tsx'
import { useUi } from '../ui-store.ts'
import { WikiView } from './WikiView.tsx'
import { listenForChanges } from './sync.ts'
import { parseWikiPath, wikiPath, type WikiRoute } from './route.ts'
import type { Space } from '../../../shared/types.ts'

export function WikiApp() {
  const qc = useQueryClient()
  const [route, setRoute] = useState<WikiRoute>(() => parseWikiPath(window.location.pathname))

  useEffect(() => {
    const onPop = () => setRoute(parseWikiPath(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  useEffect(() => listenForChanges(qc), [qc])

  // A backlink or a note's "In the wiki" asks for a page through the store. On the desk the Wiki
  // window reads it directly; here it has to become an address.
  const asked = useUi((s) => s.wiki)
  useEffect(() => {
    if (!asked.pageId || asked.pageId === route.pageId) return
    const path = wikiPath(asked.spaceSlug ? { slug: asked.spaceSlug } : null, { slug: '', id: asked.pageId })
    window.history.pushState(null, '', path)
    setRoute({ spaceSlug: asked.spaceSlug, pageId: asked.pageId })
  }, [asked, route.pageId])

  const go = useCallback((space: Space | null, page: { id: number; slug: string } | null) => {
    const path = wikiPath(space, page)
    if (path !== window.location.pathname) window.history.pushState(null, '', path)
    setRoute(parseWikiPath(path))
  }, [])

  // The page's title is what the window and a bookmark are called.
  useEffect(() => {
    document.title = route.spaceSlug ? `Wiki — ${decodeURIComponent(route.spaceSlug)}` : 'Deskwork wiki'
  }, [route.spaceSlug])

  return (
    <RTooltip.Provider delayDuration={150}>
      <div className="app wiki-app">
        <header className="topbar wiki-topbar">
          <span className="brand"><BookOpen size={18} /> Wiki</span>
          <Button variant="ghost" className="nav-btn" onClick={() => window.open('/', 'deskwork-main')}>
            <LayoutDashboard size={16} /> Open the desk
          </Button>
        </header>
        <main className="wiki-full">
          <WikiView route={route} go={go} />
        </main>
      </div>
      <Toasts />
    </RTooltip.Provider>
  )
}
