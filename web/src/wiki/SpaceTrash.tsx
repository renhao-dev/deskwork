// A space's Trash. Pages wait here for 30 days, so a page deleted by mistake can come back —
// including ones written in a space of your own, which no goal's Notes tab can reach.
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArchiveRestore, ChevronLeft, Trash2 } from 'lucide-react'
import { api } from '../api.ts'
import { keys } from '../hooks.ts'
import { useNow } from '../hooks.ts'
import { Button, Confirm, Empty, IconButton, toast, toastError } from '../ui.tsx'
import { when } from '../notes/NotesTab.tsx'
import { announce } from './sync.ts'
import type { NoteSummary, Space } from '../../../shared/types.ts'

export function SpaceTrash({ space, onBack, onOpen }: {
  space: Space; onBack: () => void; onOpen: (p: NoteSummary) => void
}) {
  const qc = useQueryClient()
  const now = useNow(60_000)
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const { data } = useQuery({ queryKey: keys.spacePages(space.id, true), queryFn: () => api.spacePages(space.id, true) })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['space-pages', space.id] })
    qc.invalidateQueries({ queryKey: keys.spaces })
    announce({ kind: 'spaces' })
  }
  const items = data ?? []

  return (
    <div className="wiki-side-body">
      <div className="wiki-side-head">
        <button type="button" className="wiki-back" onClick={onBack}><ChevronLeft size={15} /> {space.name}</button>
        <h2 className="wiki-space-title">Trash</h2>
      </div>
      <p className="muted notes-hint">Pages here are deleted for good after 30 days, with their images.</p>
      {!data ? null : items.length === 0 ? <Empty>The Trash is empty.</Empty> : (
        <>
          <ul className="wiki-pages">
            {items.map((p) => (
              <li key={p.id} className="wiki-trash-row">
                <button type="button" className="wiki-page" onClick={() => onOpen(p)}>
                  <span className="wiki-page-text">
                    <span className="wiki-page-title">{p.title || 'Untitled page'}</span>
                  </span>
                  <span className="wiki-page-when">Deleted {when(p.deletedAt ?? p.updatedAt, now)}</span>
                </button>
                <span className="wiki-trash-actions">
                  <IconButton label={`Restore ${p.title || 'this page'}`}
                    onClick={() => api.restoreNote(p.id).then((n) => {
                      refresh()
                      toast(`Restored “${n.title || 'Untitled page'}”`)
                    }, toastError)}><ArchiveRestore size={15} /></IconButton>
                  <IconButton label={`Delete ${p.title || 'this page'} for good`} className="danger-hover"
                    onClick={() => api.deleteNoteForever(p.id).then(refresh, toastError)}><Trash2 size={15} /></IconButton>
                </span>
              </li>
            ))}
          </ul>
          <div className="wiki-trash-foot">
            <Button size="sm" variant="danger" onClick={() => setConfirmEmpty(true)}><Trash2 size={14} /> Empty Trash</Button>
          </div>
        </>
      )}
      <Confirm open={confirmEmpty} onClose={() => setConfirmEmpty(false)} confirmLabel="Delete for good"
        title={`Empty the Trash in ${space.name}?`}
        onConfirm={() => api.emptySpaceTrash(space.id).then(() => {
          refresh()
          setConfirmEmpty(false)
          toast('Trash emptied')
        }, toastError)}>
        <p>{items.length === 1 ? 'That page' : `All ${items.length} pages`} will be gone for good, with any images in them.</p>
      </Confirm>
    </div>
  )
}
