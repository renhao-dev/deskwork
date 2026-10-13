// Dragging in the Tasks window: move rows, drop a task on another to make a folder of the two, drop
// it on a folder to put it in. One drag state serves every section, so a task can be dropped on a
// row in another section. Alt+↑/↓ on a focused row moves it a step. The rules are in taskLayout.ts.
import { useState, type DragEvent, type KeyboardEvent } from 'react'
import { applyDrop, dropPos, nudge, sameRef, type DropPos, type Entry, type LaidTask, type Ref } from './taskLayout.ts'

export function useTaskBoard<T extends LaidTask>(entries: Entry<T>[], day: string, on: {
  /** The rows were rearranged: show and save them. */
  arrange: (next: Entry<T>[]) => void
  /** One lone task was dropped on another: make a folder of the two. */
  group: (targetId: number, draggedId: number) => void
}) {
  const [drag, setDrag] = useState<Ref | null>(null)
  const [drop, setDrop] = useState<{ target: Ref; pos: DropPos } | null>(null)

  const finish = () => {
    setDrag(null)
    setDrop(null)
  }

  /** Props for a task's row, or for a folder's heading (`open`: its tasks are showing). */
  const rowProps = (self: Ref, { open = false, draggable = true }: { open?: boolean; draggable?: boolean } = {}) => ({
    draggable,
    'data-dragging': drag && sameRef(drag, self) ? 'true' : undefined,
    'data-drop-pos': drop && sameRef(drop.target, self) ? drop.pos : undefined,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', `${self.kind} ${self.id}`)
      setDrag(self)
    },
    onDragOver: (e: DragEvent) => {
      if (!drag) return
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const pos = dropPos(entries, day, drag, self, (e.clientY - r.top) / r.height, open)
      if (!pos) {
        if (drop && sameRef(drop.target, self)) setDrop(null)
        return
      }
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (!drop || !sameRef(drop.target, self) || drop.pos !== pos) setDrop({ target: self, pos })
    },
    onDragLeave: (e: DragEvent) => {
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setDrop((d) => (d && sameRef(d.target, self) ? null : d))
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      if (drag && drop) {
        const out = applyDrop(entries, drag, drop.target, drop.pos)
        if (Array.isArray(out)) on.arrange(out)
        else if (out) on.group(...out.group)
      }
      finish()
    },
    onDragEnd: finish,
    onKeyDown: (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
      if ((e.target as HTMLElement).tagName === 'INPUT') return // Alt+arrows belong to the text while renaming
      e.preventDefault()
      const out = nudge(entries, day, self, e.key === 'ArrowUp' ? -1 : 1)
      if (!out) return
      on.arrange(out)
      // Keep focus on the moved row after it re-renders.
      const el = (e.target as HTMLElement).closest('li')
      requestAnimationFrame(() => el?.querySelector<HTMLElement>('.row-main')?.focus())
    },
  })

  return { rowProps, dragging: drag !== null }
}
