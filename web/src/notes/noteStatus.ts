// Save state of each open note, shared by the editor and the Notes window's tabs.
import { useSyncExternalStore } from 'react'

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'offline' | 'error'
export const statuses = new Map<number, SaveStatus>()
const statusListeners = new Set<() => void>()
export function setStatus(id: number, s: SaveStatus) {
  if (statuses.get(id) === s) return
  statuses.set(id, s)
  statusListeners.forEach((l) => l())
}
export function useNoteStatus(id: number): SaveStatus {
  return useSyncExternalStore((l) => (statusListeners.add(l), () => statusListeners.delete(l)), () => statuses.get(id) ?? 'saved')
}

