// What points here. Nobody writes this list: it's every page that happens to link to this thing,
// read back out of the link table.
import { useQuery } from '@tanstack/react-query'
import { CornerUpLeft } from 'lucide-react'
import { api } from '../api.ts'
import { openWikiPage } from '../ui-store.ts'
import type { Backlink } from '../../../shared/types.ts'

export function Backlinks({ kind, id, title = 'Mentioned on' }: {
  kind: 'pages' | 'goals' | 'tasks' | 'books'; id: number; title?: string
}) {
  const { data } = useQuery({
    queryKey: ['backlinks', kind, id],
    queryFn: () => api.backlinks(kind, id),
    staleTime: 10_000,
  })
  if (!data?.length) return null
  return (
    <section className="backlinks" aria-label={title}>
      <h3 className="backlinks-head"><CornerUpLeft size={13} aria-hidden /> {title}</h3>
      <ul>
        {data.map((b: Backlink) => (
          <li key={b.id}>
            <button type="button" className="backlink" onClick={() => openWikiPage(b.spaceSlug, b.id)}>
              <span className="backlink-title">{b.title}</span>
              <span className="backlink-where">{b.spaceName}{b.path && ` › ${b.path}`}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
