// Drag and drop for resources and folders: drag a resource or folder onto a folder to move it there.
// Uses the browser's native drag and drop. What's being dragged is kept in React state, because
// browsers hide dataTransfer contents until the drop.
import { useRef, useState, type DragEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../api.ts'
import { keys } from '../hooks.ts'
import { toast, toastError } from '../ui.tsx'
import type { FolderTree } from '../../../shared/folders.ts'

export type DragItem =
  | { kind: 'resource'; id: number; folderId: number | null; title: string }
  | { kind: 'folder'; id: number; parentId: number | null; title: string }

/** Where something is dropped: a folder id, or null for the top level (resources: no folder). */
export type DropTarget = number | null

export function useResourceDnd(tree: FolderTree) {
  const qc = useQueryClient()
  const [dragging, setDragging] = useState<DragItem | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const openTimer = useRef<{ key: string; t: ReturnType<typeof setTimeout> } | null>(null)

  const canDrop = (item: DragItem | null, target: DropTarget, accepts: 'any' | 'resource' = 'any') => {
    if (!item) return false
    if (item.kind === 'resource') return target !== item.folderId
    if (accepts === 'resource') return false
    if (target === null) return item.parentId !== null
    return target !== item.parentId && !tree.subtree(item.id).has(target)
  }

  const clearTimer = () => {
    if (openTimer.current) clearTimeout(openTimer.current.t)
    openTimer.current = null
  }

  const end = () => {
    setDragging(null)
    setOver(null)
    clearTimer()
  }

  const move = async (item: DragItem, target: DropTarget) => {
    const where = target === null ? (item.kind === 'folder' ? 'the top level' : 'No folder') : `“${tree.byId.get(target)?.name}”`
    try {
      if (item.kind === 'resource') {
        await api.updateResource(item.id, { folderId: target })
        qc.invalidateQueries({ queryKey: keys.resources })
      } else {
        await api.updateFolder(item.id, { parentId: target })
        qc.invalidateQueries({ queryKey: keys.folders })
      }
      toast(`Moved “${item.title}” to ${where}`)
    } catch (e) {
      toastError(e)
    }
  }

  /** Props for something you can pick up. */
  const dragProps = (item: DragItem) => ({
    draggable: true,
    'data-dragging': dragging?.kind === item.kind && dragging.id === item.id ? 'true' : undefined,
    onDragStart: (e: DragEvent) => {
      e.stopPropagation()
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', item.title)
      setDragging(item)
    },
    onDragEnd: end,
  })

  /**
   * Props for a place you can drop onto. `key` identifies it for highlighting; `onLinger` runs after
   * hovering a moment (used to open collapsed folders).
   */
  const dropProps = (key: string, target: DropTarget, opts: { accepts?: 'any' | 'resource'; onLinger?: () => void } = {}) => ({
    'data-drop': over === key ? 'on' : undefined,
    onDragOver: (e: DragEvent) => {
      if (!canDrop(dragging, target, opts.accepts)) return
      e.preventDefault() // allows the drop
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      if (over !== key) setOver(key)
      if (opts.onLinger && openTimer.current?.key !== key) {
        clearTimer()
        openTimer.current = { key, t: setTimeout(() => opts.onLinger?.(), 650) }
      }
    },
    onDragLeave: (e: DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
      setOver((o) => (o === key ? null : o))
      if (openTimer.current?.key === key) clearTimer()
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const item = dragging
      end()
      if (item && canDrop(item, target, opts.accepts)) move(item, target)
    },
  })

  return { dragging, dragProps, dropProps }
}

export type ResourceDnd = ReturnType<typeof useResourceDnd>
