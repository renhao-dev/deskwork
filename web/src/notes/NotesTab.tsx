import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArchiveRestore, Plus, Search, Trash2, X } from 'lucide-react'
import { api } from '../api.ts'
import { keys, useNow } from '../hooks.ts'
import { openNote, type ItemRef } from '../ui-store.ts'
import { Button, Confirm, Empty, IconButton, toast, toastError } from '../ui.tsx'
import { createAndOpenNote, trashNoteWithUndo } from './actions.ts'
import type { NoteSummary } from '../../../shared/types.ts'

const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

export function when(ts: number, now: number) {
  const mins = Math.round((now - ts) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const d = new Date(ts)
  const sameDay = new Date(now).toDateString() === d.toDateString()
  return sameDay ? `today ${d.toLocaleTimeString(undefined, { timeStyle: 'short' })}` : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export const useNotes = (ref: ItemRef, trash = false, enabled = true) =>
  useQuery({ queryKey: keys.notes(ref.type, ref.id, trash), queryFn: () => api.notes(ref.type, ref.id, trash), enabled })

/** A goal's or task's notes, with search and the Trash. */
export function NotesTab({ refItem }: { refItem: ItemRef }) {
  const qc = useQueryClient()
  const now = useNow(60_000)
  const [query, setQuery] = useState('')
  const [showTrash, setShowTrash] = useState(false)
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const notes = useNotes(refItem)
  const trash = useNotes(refItem, true)
  const refresh = () => qc.invalidateQueries({ queryKey: ['notes', refItem.type, refItem.id] })

  const words = fold(query).split(/\s+/).filter(Boolean)
  const shown = (notes.data ?? []).filter((n) => {
    const hay = fold(`${n.title} ${n.excerpt}`)
    return words.every((w) => hay.includes(w))
  })

  if (showTrash) {
    const items = trash.data ?? []
    return (
      <div className="notes-tab">
        <div className="notes-tools">
          <Button size="sm" variant="ghost" onClick={() => setShowTrash(false)}>← Back to notes</Button>
          {items.length > 0 && <Button size="sm" variant="danger" onClick={() => setConfirmEmpty(true)}><Trash2 size={14} /> Empty Trash</Button>}
        </div>
        <p className="muted notes-hint">Notes in the Trash are deleted for good after 30 days, with their images.</p>
        {items.length === 0 ? <Empty>The Trash is empty.</Empty> : (
          <ul className="rows">
            {items.map((n) => (
              <li key={n.id} className="row">
                <div className="row-main">
                  <span className="row-title">{n.title || 'Untitled note'}</span>
                  <span className="row-meta">Deleted {when(n.deletedAt!, now)}</span>
                </div>
                <div className="row-actions">
                  <Button size="sm" onClick={() => api.restoreNote(n.id).then(() => { refresh(); toast(`Restored “${n.title || 'Untitled note'}”`) }, toastError)}>
                    <ArchiveRestore size={14} /> Restore
                  </Button>
                  <IconButton label="Delete for good" className="danger-hover"
                    onClick={() => api.deleteNoteForever(n.id).then(refresh, toastError)}><Trash2 size={15} /></IconButton>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Confirm open={confirmEmpty} onClose={() => setConfirmEmpty(false)} title="Empty the Trash?" confirmLabel="Delete for good"
          onConfirm={() => api.emptyTrash(refItem.type, refItem.id).then(() => { setConfirmEmpty(false); refresh() }, toastError)}>
          <p>{items.length} note{items.length === 1 ? '' : 's'} and their images are deleted for good. This can’t be undone.</p>
        </Confirm>
      </div>
    )
  }

  return (
    <div className="notes-tab">
      <div className="notes-tools">
        {(notes.data?.length ?? 0) > 3 && (
          <div className="res-search notes-search">
            <Search size={16} aria-hidden />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notes" aria-label="Search notes" />
            {query && <IconButton label="Clear search" onClick={() => setQuery('')}><X size={15} /></IconButton>}
          </div>
        )}
        <Button variant="primary" size="sm" onClick={() => createAndOpenNote(qc, refItem)}><Plus size={14} /> New note</Button>
      </div>
      {notes.isPending ? <p className="muted pad">Loading…</p> : shown.length === 0 ? (
        query ? <Empty>No notes match “{query}”.</Empty> : (
          <Empty action={<Button size="sm" onClick={() => createAndOpenNote(qc, refItem)}><Plus size={14} /> New note</Button>}>
            No notes yet. Notes are pages of your own: summaries, screenshots, questions.
          </Empty>
        )
      ) : (
        <ul className="note-list">
          {shown.map((n: NoteSummary) => (
            <li key={n.id} className="note-card">
              <button type="button" className="note-card-main" onClick={() => openNote(n.id)}>
                <span className="note-card-text">
                  <span className="note-card-title">{n.title || 'Untitled note'}</span>
                  {n.excerpt && <span className="note-card-excerpt">{n.excerpt}</span>}
                  <span className="note-card-meta">Edited {when(n.updatedAt, now)}</span>
                </span>
                {n.firstImage && <img className="note-card-thumb" src={n.firstImage} alt="" loading="lazy" />}
              </button>
              <IconButton label={`Move “${n.title || 'Untitled note'}” to Trash`} className="danger-hover note-card-trash"
                onClick={() => trashNoteWithUndo(qc, n)}><Trash2 size={15} /></IconButton>
            </li>
          ))}
        </ul>
      )}
      {(trash.data?.length ?? 0) > 0 && (
        <button type="button" className="notes-trash-link" onClick={() => setShowTrash(true)}>
          <Trash2 size={14} /> Trash ({trash.data!.length})
        </button>
      )}
    </div>
  )
}
