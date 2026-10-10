// The wiki: spaces on the left, the page you're reading on the right. The same component runs
// inside the desk window and in the wiki's own full-screen window — only the address bar differs.
import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, FileText, Plus, Search, Target, Trash2, X } from 'lucide-react'
import { api } from '../api.ts'
import { keys, useSpaces } from '../hooks.ts'
import { openDetails } from '../ui-store.ts'
import { Button, Empty, IconButton, toastError } from '../ui.tsx'
import { announce } from './sync.ts'
import { PageTree } from './PageTree.tsx'
import { SearchResults } from './SearchResults.tsx'
import { SpaceTrash } from './SpaceTrash.tsx'
import type { Placed } from './place.ts'
import { buildTree } from '../../../shared/tree.ts'
import type { WikiRoute } from './route.ts'
import type { NoteSummary, SearchHit, Space } from '../../../shared/types.ts'

const NoteEditor = lazy(() => import('../notes/NoteEditor.tsx').then((m) => ({ default: m.NoteEditor })))

/** Spaces worth listing: your own, and the ones a goal has actually filled. */
function visibleSpaces(spaces: Space[], showAll: boolean) {
  const live = spaces.filter((s) => !s.archivedAt)
  return showAll ? live : live.filter((s) => !s.goalId || s.pageCount > 0)
}

function SpaceList({ spaces, onPick, naming, name, setName, onSubmit, onCancel }: {
  spaces: Space[]
  onPick: (s: Space) => void
  naming: boolean
  name: string
  setName: (v: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  const [showAll, setShowAll] = useState(false)
  const shown = visibleSpaces(spaces, showAll)
  const hidden = visibleSpaces(spaces, true).length - shown.length
  const mine = shown.filter((s) => !s.goalId)
  const goals = shown.filter((s) => s.goalId)

  const group = (title: string, list: Space[]) => list.length > 0 && (
    <>
      <h3 className="list-section">{title}</h3>
      <ul className="wiki-spaces">
        {list.map((s) => (
          <li key={s.id}>
            <button type="button" className="wiki-space" onClick={() => onPick(s)}>
              <span className="wiki-space-icon" aria-hidden>{s.icon || (s.goalId ? <Target size={14} /> : <FileText size={14} />)}</span>
              <span className="wiki-space-name">{s.name}</span>
              <span className="wiki-space-count">{s.pageCount || ''}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )

  return (
    <div className="wiki-side-body">
      {naming && (
        <form className="folder-form wiki-new-space" onSubmit={(e) => (e.preventDefault(), onSubmit())}>
          <input autoFocus value={name} maxLength={100} placeholder="Space name" aria-label="New space name"
            onChange={(e) => setName(e.target.value)} onBlur={onSubmit}
            onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onCancel())} />
        </form>
      )}
      {shown.length === 0 && !naming && <Empty>Nothing written yet.</Empty>}
      {group('Your spaces', mine)}
      {group('From goals', goals)}
      {hidden > 0 && (
        <button type="button" className="wiki-more" onClick={() => setShowAll(true)}>
          Show {hidden} empty goal {hidden === 1 ? 'space' : 'spaces'}
        </button>
      )}
    </div>
  )
}

function PageList({ space, pageId, onPick, onBack, onNew, onTrash }: {
  space: Space; pageId: number | null; onPick: (p: NoteSummary) => void
  onBack: () => void; onNew: () => void; onTrash: () => void
}) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: keys.spacePages(space.id), queryFn: () => api.spacePages(space.id) })
  const trash = useQuery({ queryKey: keys.spacePages(space.id, true), queryFn: () => api.spacePages(space.id, true) })
  const pages = data ?? []

  // The new arrangement shows at once; if the server refuses it, the old one comes back.
  const reorder = (placed: Placed[]) => {
    const before = data ?? []
    const byId = new Map(before.map((p) => [p.id, p]))
    qc.setQueryData(keys.spacePages(space.id), placed.map((pl) => ({ ...byId.get(pl.id)!, parentId: pl.parentId })))
    api.reorderPages(space.id, placed).then(
      () => announce({ kind: 'spaces' }),
      (e) => {
        qc.invalidateQueries({ queryKey: keys.spacePages(space.id) })
        toastError(e)
      },
    )
  }

  return (
    <div className="wiki-side-body">
      <div className="wiki-side-head">
        <button type="button" className="wiki-back" onClick={onBack}><ChevronLeft size={15} /> All spaces</button>
        <h2 className="wiki-space-title">{space.icon ? `${space.icon} ` : ''}{space.name}</h2>
        {space.goalId && (
          <button type="button" className="note-item-link space-goal" onClick={() => openDetails({ type: 'goal', id: space.goalId! })}>
            <Target size={12} /> {space.goalTitle === space.name ? 'Open its goal' : space.goalTitle}
          </button>
        )}
      </div>
      {!data ? null : pages.length === 0 ? (
        <Empty action={<Button size="sm" onClick={onNew}><Plus size={14} /> New page</Button>}>
          Nothing filed here yet. The space's home page is above.
        </Empty>
      ) : (
        <PageTree pages={pages} pageId={pageId} homeId={space.homeId} onPick={onPick} onReorder={reorder} />
      )}
      {(trash.data?.length ?? 0) > 0 && (
        <button type="button" className="notes-trash-link" onClick={onTrash}>
          <Trash2 size={14} /> Trash ({trash.data!.length})
        </button>
      )}
    </div>
  )
}

/** Where in the space this page sits: Space › Parent › Page. Each step is clickable. */
function Breadcrumbs({ space, pageId, pages, onPick, onSpace }: {
  space: Space; pageId: number; pages: NoteSummary[]; onPick: (p: NoteSummary) => void; onSpace: () => void
}) {
  const tree = useMemo(() => buildTree(pages), [pages])
  // The first step is the space itself, which is what its home page is — so it isn't listed twice.
  const trail = tree.lineage(pageId).filter((id) => id !== space.homeId).map((id) => tree.byId.get(id)!).filter(Boolean)
  const label = `${space.icon ? `${space.icon} ` : ''}${space.name}`
  // On the home page the space is where you are, so it is the last step rather than a link back.
  if (!trail.length) {
    return <nav className="wiki-crumbs" aria-label="Where this page sits"><span aria-current="page">{label}</span></nav>
  }
  return (
    <nav className="wiki-crumbs" aria-label="Where this page sits">
      <button type="button" onClick={onSpace}>{label}</button>
      {trail.map((p, i) => (
        <span key={p.id} className="wiki-crumb">
          <ChevronRight size={13} aria-hidden />
          {i === trail.length - 1
            ? <span aria-current="page">{p.title || 'Untitled page'}</span>
            : <button type="button" onClick={() => onPick(p)}>{p.title || 'Untitled page'}</button>}
        </span>
      ))}
    </nav>
  )
}

export function WikiView({ route, go, actions }: {
  route: WikiRoute
  go: (space: Space | null, page: { id: number; slug: string } | null) => void
  actions?: React.ReactNode
}) {
  const qc = useQueryClient()
  const { data: spaces } = useSpaces()
  const space = useMemo(() => (spaces ?? []).find((s) => s.slug === route.spaceSlug) ?? null, [spaces, route.spaceSlug])

  // A page addressed on its own (a link from elsewhere) brings its space along.
  const page = useQuery({ queryKey: keys.note(route.pageId ?? 0), queryFn: () => api.note(route.pageId!), enabled: !!route.pageId })
  useEffect(() => {
    if (!route.pageId || !page.data || space || !spaces) return
    const owner = spaces.find((s) => s.id === page.data.spaceId)
    if (owner) go(owner, { id: page.data.id, slug: page.data.slug })
  }, [route.pageId, page.data, space, spaces, go])

  const pages = useQuery({ queryKey: keys.spacePages(space?.id ?? 0), queryFn: () => api.spacePages(space!.id), enabled: !!space })

  const [query, setQuery] = useState('')
  const [typed, setTyped] = useState('')
  const [everywhere, setEverywhere] = useState(false)
  // Wait for a pause in typing before asking the server.
  useEffect(() => {
    const t = setTimeout(() => setQuery(typed.trim()), 180)
    return () => clearTimeout(t)
  }, [typed])
  // Narrowing to a space again is the sensible default whenever you open one.
  useEffect(() => setEverywhere(false), [space?.id])
  const scopeId = space && !everywhere ? space.id : undefined
  const hits = useQuery({
    queryKey: ['search', query, scopeId ?? 'all'],
    queryFn: () => api.search(query, scopeId),
    enabled: query.length > 1,
    placeholderData: (prev) => prev,
  })
  const searching = query.length > 1

  // Picking a space opens its home page: the page everything else in the space sits under.
  useEffect(() => {
    if (!space || route.pageId || !pages.data) return
    const home = pages.data.find((p) => p.id === space.homeId)
    if (home) go(space, home)
  }, [space, route.pageId, pages.data, go])

  const [naming, setNaming] = useState(false)
  const [spaceName, setSpaceName] = useState('')
  const [inTrash, setInTrash] = useState(false)
  useEffect(() => setInTrash(false), [space?.id])

  /** A space made here opens straight away, on its home page. */
  const newSpace = async () => {
    const trimmed = spaceName.trim()
    setNaming(false)
    if (!trimmed) return
    try {
      const created = await api.createSpace({ name: trimmed })
      await qc.invalidateQueries({ queryKey: keys.spaces })
      announce({ kind: 'spaces' })
      go(created, null)
    } catch (e) {
      toastError(e)
    }
  }

  const newPage = async (parentId?: number | null) => {
    if (!space) return
    try {
      const created = await api.createPage(space.id, { parentId })
      qc.setQueryData(keys.note(created.id), created)
      qc.invalidateQueries({ queryKey: keys.spacePages(space.id) })
      qc.invalidateQueries({ queryKey: keys.spaces })
      announce({ kind: 'spaces' })
      go(space, created)
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <div className="wiki">
      <aside className="wiki-side">
        <div className="wiki-search">
          <Search size={14} aria-hidden />
          <input value={typed} onChange={(e) => setTyped(e.target.value)}
            placeholder={space && !everywhere ? `Search ${space.name}` : 'Search the wiki'}
            aria-label={space && !everywhere ? `Search ${space.name}` : 'Search the wiki'} />
          {typed && <IconButton label="Clear the search" onClick={() => setTyped('')}><X size={13} /></IconButton>}
        </div>
        {searching ? (
          <SearchResults hits={hits.data ?? []} scope={space ? { spaceName: space.name, everywhere } : null}
            onWiden={() => setEverywhere(true)}
            onPick={(h: SearchHit) => {
              const owner = (spaces ?? []).find((s) => s.id === h.spaceId)
              if (owner) go(owner, { id: h.id, slug: h.slug })
            }} />
        ) : space && inTrash ? (
          <SpaceTrash space={space} onBack={() => setInTrash(false)} onOpen={(p) => (setInTrash(false), go(space, p))} />
        ) : space
          ? <PageList space={space} pageId={route.pageId} onNew={() => newPage()} onTrash={() => setInTrash(true)}
              onPick={(p) => go(space, p)} onBack={() => go(null, null)} />
          : <SpaceList spaces={spaces ?? []} onPick={(s) => go(s, null)}
              naming={naming} name={spaceName} setName={setSpaceName}
              onSubmit={newSpace} onCancel={() => setNaming(false)} />}
        {!searching && !inTrash && (
          <div className="wiki-side-foot">
            {space
              ? <Button size="sm" variant="primary" onClick={() => newPage()}><Plus size={14} /> New page</Button>
              : <Button size="sm" variant="primary" onClick={() => { setNaming(true); setSpaceName('') }}>
                  <Plus size={14} /> New space
                </Button>}
          </div>
        )}
      </aside>
      <section className="wiki-main">
        {actions && <div className="wiki-bar">{actions}</div>}
        {route.pageId ? (
          <>
            {space && pages.data && (
              <div className="wiki-crumb-bar">
                <Breadcrumbs space={space} pageId={route.pageId} pages={pages.data}
                  onPick={(p) => go(space, p)} onSpace={() => go(space, null)} />
                <Button size="sm" variant="ghost" onClick={() => newPage(route.pageId)}
                  title="Add a page filed under this one"><Plus size={14} /> Subpage</Button>
              </div>
            )}
            <Suspense fallback={<p className="muted pad">Loading editor…</p>}>
              <NoteEditor key={route.pageId} id={route.pageId} noun="page" />
            </Suspense>
          </>
        ) : (
          <Empty action={space ? <Button size="sm" onClick={() => newPage()}><Plus size={14} /> New page</Button> : undefined}>
            {space ? 'Pick a page, or start a new one.' : 'Pick a space to read what’s in it.'}
          </Empty>
        )}
      </section>
    </div>
  )
}
