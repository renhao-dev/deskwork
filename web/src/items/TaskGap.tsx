// The line between two rows in the Tasks window. Pointing at it shows a plus; clicking that asks
// for a title right there, and the new task is made at that spot.
import { useRef, useState } from 'react'
import { Plus } from 'lucide-react'

function Draft({ onDone }: { onDone: (title: string | null) => void }) {
  // Enter, Escape and the blur that follows them must settle this only once.
  const settled = useRef(false)
  const [busy, setBusy] = useState(false)
  const done = (title: string | null) => {
    if (settled.current) return
    settled.current = true
    if (title) setBusy(true)
    onDone(title)
  }
  return (
    <li className="row task-draft">
      <div className="row-main">
        <input
          className="folder-name-input" aria-label="Title of the new task" placeholder="New task" autoFocus disabled={busy}
          onKeyDown={(e) => {
            if (e.key === 'Enter') done(e.currentTarget.value.trim() || null)
            if (e.key === 'Escape') done(null)
          }}
          onBlur={(e) => done(e.target.value.trim() || null)}
        />
      </div>
    </li>
  )
}

export function TaskGap({ open, inFolderEnd, onOpen, onDone }: {
  /** The title is being typed here. */
  open: boolean
  /** The spot after the last task of an open folder, which sits just above the folder's bottom edge. */
  inFolderEnd?: boolean
  onOpen: () => void
  /** The title typed, or null when adding was abandoned. */
  onDone: (title: string | null) => void
}) {
  if (open) return <Draft onDone={onDone} />
  return (
    <li className="task-gap" data-end={inFolderEnd || undefined}>
      <button type="button" tabIndex={-1} aria-label="New task here" title="New task here" onClick={onOpen}>
        <span className="task-gap-plus"><Plus size={12} strokeWidth={3} /></span>
      </button>
    </li>
  )
}
