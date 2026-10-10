// What a search turned up. The server marks the matching words with « », which become highlights.
import { Fragment } from 'react'
import { Empty } from '../ui.tsx'
import type { SearchHit } from '../../../shared/types.ts'

function Marked({ text }: { text: string }) {
  return (
    <>
      {text.split(/«([^»]*)»/g).map((part, i) =>
        i % 2 ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>)}
    </>
  )
}

export function SearchResults({ hits, scope, onPick, onWiden }: {
  hits: SearchHit[]
  scope: { spaceName: string; everywhere: boolean } | null
  onPick: (hit: SearchHit) => void
  onWiden: () => void
}) {
  const wider = scope && !scope.everywhere && (
    <button type="button" className="wiki-more" onClick={onWiden}>Search every space instead</button>
  )
  if (!hits.length) {
    return (
      <div className="wiki-side-body">
        <Empty>{scope && !scope.everywhere ? `Nothing in ${scope.spaceName}.` : 'Nothing found.'}</Empty>
        {wider}
      </div>
    )
  }
  return (
    <div className="wiki-side-body">
      <ul className="wiki-hits">
        {hits.map((h) => (
          <li key={h.id}>
            <button type="button" className="wiki-hit" onClick={() => onPick(h)}>
              <span className="wiki-hit-title">{h.title || 'Untitled page'}</span>
              <span className="wiki-hit-where">{h.spaceName}{h.path && ` › ${h.path}`}</span>
              {h.snippet && <span className="wiki-hit-snippet"><Marked text={h.snippet} /></span>}
            </button>
          </li>
        ))}
      </ul>
      {wider}
    </div>
  )
}
