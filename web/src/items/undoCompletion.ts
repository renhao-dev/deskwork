// Taking back a completion, from the Completed today window or a goal's Sessions tab.
import type { QueryClient } from '@tanstack/react-query'
import { api } from '../api.ts'
import { keys } from '../hooks.ts'
import { toast, toastError } from '../ui.tsx'

/** Take back the completion of this goal (today's) or task. */
export const uncompleteItem = (qc: QueryClient, type: 'goal' | 'task', id: number) => runUndo(qc, () => api.uncomplete(type, id))

export const undoCompletion = (qc: QueryClient, completionId: number) => runUndo(qc, () => api.undoCompletion(completionId))

async function runUndo(qc: QueryClient, call: () => Promise<{ itemType: 'goal' | 'task'; itemTitle: string; stillArchived: boolean }>) {
  try {
    const r = await call()
    for (const k of [keys.dashboard, keys.goals, keys.tasks, keys.history, ['detail']]) qc.invalidateQueries({ queryKey: k })
    toast(r.itemType === 'goal'
      ? r.stillArchived
        ? `“${r.itemTitle}” is back, but still archived. Restore it from the goal's ⋯ menu.`
        : `“${r.itemTitle}” is back on today's list`
      : `Reopened “${r.itemTitle}”`)
  } catch (e) {
    toastError(e)
  }
}
