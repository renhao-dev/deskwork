import type { QueryClient } from '@tanstack/react-query'
import { api } from '../api.ts'
import { keys } from '../hooks.ts'
import { closeNoteTab, openNote, type ItemRef } from '../ui-store.ts'
import { toast, toastError } from '../ui.tsx'
import { announce } from '../wiki/sync.ts'
import type { ItemType } from '../../../shared/types.ts'

/**
 * Everything that lists this note: the goal's Notes tab, and the space it lives in — the wiki's
 * tree and that space's Trash. A page written in the wiki has no goal, so the space is all there is.
 */
function refreshLists(qc: QueryClient, note: { itemType?: ItemType | null; itemId?: number | null; spaceId?: number | null }) {
  if (note.itemType && note.itemId) qc.invalidateQueries({ queryKey: ['notes', note.itemType, note.itemId] })
  if (note.spaceId) qc.invalidateQueries({ queryKey: ['space-pages', note.spaceId] })
  qc.invalidateQueries({ queryKey: keys.spaces })
  announce({ kind: 'spaces' })
}

export async function createAndOpenNote(qc: QueryClient, ref: ItemRef) {
  try {
    const note = await api.createNote(ref.type, ref.id, {})
    qc.setQueryData(keys.note(note.id), note)
    refreshLists(qc, note)
    openNote(note.id)
  } catch (e) {
    toastError(e)
  }
}

/** Moves a note to the Trash, with an Undo button in the confirmation. */
export async function trashNoteWithUndo(
  qc: QueryClient,
  n: { id: number; title: string; itemType: ItemType | null; itemId: number | null; spaceId?: number | null },
) {
  try {
    await api.trashNote(n.id)
  } catch (e) {
    return toastError(e)
  }
  closeNoteTab(n.id)
  qc.removeQueries({ queryKey: keys.note(n.id) })
  refreshLists(qc, n)
  toast(`Moved “${n.title || 'Untitled note'}” to the Trash`, 'info', {
    label: 'Undo',
    run: () => {
      api.restoreNote(n.id).then((note) => {
        qc.setQueryData(keys.note(note.id), note)
        refreshLists(qc, note)
        openNote(note.id)
      }, toastError)
    },
  })
}
