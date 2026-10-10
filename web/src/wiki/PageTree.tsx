// A space's pages, nested. Drag one onto another to file it inside; drag between two to put it
// there. Alt+↑/↓ moves a page among its siblings, Alt+←/→ changes how deep it sits.
import { useMemo, useState, type DragEvent, type KeyboardEvent } from 'react'
import { ChevronRight, FileText, House } from 'lucide-react'
import { buildTree } from '../../../shared/tree.ts'
import { place, type DropPos, type Placed } from './place.ts'
import type { NoteSummary } from '../../../shared/types.ts'

type Drop = { id: number; pos: DropPos }

export function PageTree({ pages, pageId, homeId, onPick, onReorder }: {
  pages: NoteSummary[]
  pageId: number | null
  /** The space's home page: it stays at the top and can't be dragged. */
  homeId: number | null
  onPick: (p: NoteSummary) => void
  onReorder: (placed: Placed[]) => void
}) {
  const [dragId, setDragId] = useState<number | null>(null)
  const [drop, setDrop] = useState<Drop | null>(null)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())

  const tree = useMemo(() => buildTree(pages), [pages])
  const byId = useMemo(() => new Map(pages.map((p) => [p.id, p])), [pages])

  // A page being dragged onto a closed parent opens it, so you can see where it's going.
  const open = (id: number) => setCollapsed((c) => {
    if (!c.has(id)) return c
    const next = new Set(c)
    next.delete(id)
    return next
  })
  const toggle = (id: number) => setCollapsed((c) => {
    const next = new Set(c)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const finish = () => {
    setDragId(null)
    setDrop(null)
  }

  const apply = (from: number, at: Drop) => {
    const placed = place(pages, from, at.id, at.pos)
    if (placed) onReorder(placed)
  }

  const move = (page: NoteSummary, key: string) => {
    const siblings = tree.children(page.parentId ?? null)
    const i = siblings.findIndex((s) => s.id === page.id)
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      const other = siblings[key === 'ArrowUp' ? i - 1 : i + 1]
      if (other) apply(page.id, { id: other.id, pos: key === 'ArrowUp' ? 'before' : 'after' })
    } else if (key === 'ArrowRight') {
      // Nest under the page just above it, the way a list indents.
      const above = siblings[i - 1]
      if (above) (open(above.id), apply(page.id, { id: above.id, pos: 'inside' }))
    } else if (key === 'ArrowLeft' && page.parentId != null) {
      apply(page.id, { id: page.parentId, pos: 'after' })
    }
  }

  const rows = (parent: number | null, depth: number): React.ReactNode[] =>
    tree.children(parent).flatMap((p) => {
      const kids = tree.children(p.id)
      const shut = collapsed.has(p.id)
      const home = p.id === homeId
      return [
        <li key={p.id} className={`wiki-page-row${home ? ' is-home' : ''}`} style={{ '--depth': depth } as React.CSSProperties}
          data-dragging={dragId === p.id ? 'true' : undefined}
          data-drop-pos={drop?.id === p.id ? drop.pos : undefined}
          draggable={!home}
          onDragStart={(e: DragEvent) => {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', String(p.id))
            setDragId(p.id)
          }}
          onDragOver={(e: DragEvent) => {
            if (dragId == null) return
            e.preventDefault()
            e.stopPropagation()
            e.dataTransfer.dropEffect = 'move'
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            const share = (e.clientY - r.top) / r.height
            const pos = share < 0.26 ? 'before' : share > 0.74 ? 'after' : 'inside'
            if (pos === 'inside' && kids.length) open(p.id)
            if (drop?.id !== p.id || drop.pos !== pos) setDrop({ id: p.id, pos })
          }}
          onDragLeave={(e: DragEvent) => {
            if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) {
              setDrop((d) => (d?.id === p.id ? null : d))
            }
          }}
          onDrop={(e: DragEvent) => {
            e.preventDefault()
            e.stopPropagation()
            if (dragId != null && drop) apply(dragId, drop)
            finish()
          }}
          onDragEnd={finish}>
          <button type="button" className={`wiki-page${p.id === pageId ? ' is-active' : ''}`}
            onClick={() => onPick(p)}
            onKeyDown={(e: KeyboardEvent) => {
              if (home || !e.altKey || !e.key.startsWith('Arrow')) return
              e.preventDefault()
              move(p, e.key)
            }}>
            <span className="wiki-twist" onClick={(e) => (e.stopPropagation(), toggle(p.id))}
              role={kids.length ? 'button' : undefined}
              aria-label={kids.length ? `${shut ? 'Show' : 'Hide'} pages inside ${p.title || 'Untitled page'}` : undefined}
              aria-expanded={kids.length ? !shut : undefined}>
              {kids.length
                ? <ChevronRight size={14} className={shut ? '' : 'is-open'} />
                : home ? <House size={13} /> : <FileText size={13} className="wiki-twist-leaf" />}
            </span>
            <span className="wiki-page-text">
              <span className="wiki-page-title">{p.title || 'Untitled page'}</span>
              {shut && kids.length > 0 && <span className="wiki-page-kids">{kids.length}</span>}
            </span>
          </button>
        </li>,
        ...(shut ? [] : rows(p.id, depth + 1)),
      ]
    })

  if (!byId.size) return null
  return <ul className="wiki-pages wiki-tree">{rows(null, 0)}</ul>
}
