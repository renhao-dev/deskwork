// Drag rows up and down a list to reorder it (native drag and drop), plus Alt+↑/↓ on a focused row.
import { useState, type DragEvent, type KeyboardEvent } from 'react'
import { moveItem } from '../../../shared/order.ts'

export function useReorder<T extends { id: number }>(items: T[], commit: (ordered: T[]) => void) {
  const [dragId, setDragId] = useState<number | null>(null)
  const [drop, setDrop] = useState<{ id: number; pos: 'before' | 'after' } | null>(null)

  const finish = () => {
    setDragId(null)
    setDrop(null)
  }

  const apply = (fromId: number, targetId: number, pos: 'before' | 'after') => {
    const from = items.findIndex((x) => x.id === fromId)
    let to = items.findIndex((x) => x.id === targetId)
    if (from < 0 || to < 0) return
    if (pos === 'after') to += 1
    if (from < to) to -= 1 // removing the dragged row shifts everything after it up by one
    if (to !== from) commit(moveItem(items, from, to))
  }

  const rowProps = (item: T) => ({
    draggable: true,
    'data-dragging': dragId === item.id ? 'true' : undefined,
    'data-drop-pos': drop?.id === item.id ? drop.pos : undefined,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', String(item.id))
      setDragId(item.id)
    },
    onDragOver: (e: DragEvent) => {
      if (dragId == null) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const pos = e.clientY < r.top + r.height / 2 ? 'before' : 'after'
      if (drop?.id !== item.id || drop.pos !== pos) setDrop({ id: item.id, pos })
    },
    onDragLeave: (e: DragEvent) => {
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setDrop((d) => (d?.id === item.id ? null : d))
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      if (dragId != null && drop) apply(dragId, drop.id, drop.pos)
      finish()
    },
    onDragEnd: finish,
    onKeyDown: (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
      e.preventDefault()
      const i = items.findIndex((x) => x.id === item.id)
      const j = e.key === 'ArrowUp' ? i - 1 : i + 1
      if (j < 0 || j >= items.length) return
      commit(moveItem(items, i, j))
      // Keep focus on the moved row after it re-renders.
      const el = (e.target as HTMLElement).closest('li')
      requestAnimationFrame(() => el?.querySelector<HTMLElement>('.row-main')?.focus())
    },
  })

  return { rowProps, dragging: dragId != null }
}
