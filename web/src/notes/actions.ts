import type { QueryClient } from '@tanstack/react-query'
import { api } from '../api.ts'
import { keys } from '../hooks.ts'
import { closeNoteTab, openNote, type ItemRef } from '../ui-store.ts'
import { toast, toastError } from '../ui.tsx'
import type { ItemType } from '../../../shared/types.ts'

const refreshLists = (qc: QueryClient, type: ItemType, itemId: number) => qc.invalidateQueries({ queryKey: ['notes', type, itemId] })

export async function createAndOpenNote(qc: QueryClient, ref: ItemRef) {
  try {
    const note = await api.createNote(ref.type, ref.id, {})
    qc.setQueryData(keys.note(note.id), note)
    refreshLists(qc, ref.type, ref.id)
    openNote(note.id)
  } catch (e) {
    toastError(e)
  }
}

/** Moves a note to the Trash, with an Undo button in the confirmation. */
export async function trashNoteWithUndo(qc: QueryClient, n: { id: number; title: string; itemType: ItemType; itemId: number }) {
  try {
    await api.trashNote(n.id)
  } catch (e) {
    return toastError(e)
  }
  closeNoteTab(n.id)
  qc.removeQueries({ queryKey: keys.note(n.id) })
  refreshLists(qc, n.itemType, n.itemId)
  toast(`Moved “${n.title || 'Untitled note'}” to the Trash`, 'info', {
    label: 'Undo',
    run: () => {
      api.restoreNote(n.id).then((note) => {
        qc.setQueryData(keys.note(note.id), note)
        refreshLists(qc, n.itemType, n.itemId)
        openNote(note.id)
      }, toastError)
    },
  })
}
