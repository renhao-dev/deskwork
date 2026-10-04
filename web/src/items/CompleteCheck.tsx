// Completion as a checkbox: tick it to complete, untick to put the item back.
import { useQueryClient } from '@tanstack/react-query'
import { setUi, type ItemRef } from '../ui-store.ts'
import { Explained } from '../ui.tsx'
import { uncompleteItem } from './undoCompletion.ts'

export function CompleteCheck({
  refItem, done, label, aria, blocked, big,
}: {
  refItem: ItemRef
  done: boolean
  /** Text beside the box. Rows leave it out: the item's title is right there. */
  label?: string
  /** What a screen reader announces when there's no visible label. */
  aria?: string
  blocked?: string | null
  big?: boolean
}) {
  const qc = useQueryClient()
  const what = refItem.type === 'goal' ? 'Completed for today' : 'Completed'
  return (
    <Explained reason={blocked ?? null}>
      <label className={`done-check${big ? ' btn btn-secondary' : ''}`} onClick={(e) => e.stopPropagation()}
        title={done ? `Untick to put it back${refItem.type === 'goal' ? ' on today’s list' : ''}` : undefined}>
        <input
          type="checkbox"
          checked={done}
          disabled={!!blocked}
          aria-label={aria ?? label ?? what}
          onChange={() => (done ? uncompleteItem(qc, refItem.type, refItem.id) : setUi({ completing: { ...refItem, via: 'manual' } }))}
        />
        {label && <span>{label}</span>}
      </label>
    </Explained>
  )
}
