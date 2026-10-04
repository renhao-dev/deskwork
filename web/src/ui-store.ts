// App-wide UI state: which windows and dialogs are open. Server data lives in React Query.
import { useSyncExternalStore } from 'react'
import type { ItemType } from '../../shared/types.ts'

export type WindowId =
  | 'goals' | 'tasks' | 'completed' | 'player'
  | 'manage-goals' | 'manage-tasks' | 'manage-resources' | 'history' | 'item' | 'notes' | 'reader'

export interface ItemRef { type: ItemType; id: number }

export interface UiState {
  open: WindowId[] // optional windows currently shown; the three dashboard windows are always on
  focusOrder: WindowId[] // last = front
  details: ItemRef | null // the goal or task shown in the item window
  creating: ItemType | null
  starting: ItemRef | null
  completing: (ItemRef & { via: 'timer' | 'manual' }) | null
  resourceEditing: { id: number | null; attachTo?: ItemRef; folderId?: number | null } | null
  attaching: ItemRef | null
  player: (ItemRef & { resourceId: number }) | null
  /** The book being read in Deskwork, and the page to jump to when it opens. */
  reader: (ItemRef & { resourceId: number; page?: number; n?: number }) | null
  dialog: 'settings' | 'users' | null
  /** A request for the player to start playing (e.g. from Start), once it's ready. */
  playerPlay: (ItemRef & { resourceId: number; n: number; sync?: boolean }) | null
  /** A start position set elsewhere that an open player should jump to. */
  playerSeek: (ItemRef & { resourceId: number; seconds: number; videoIndex: number | null; n: number }) | null
  noteTabs: number[] // notes open in the Notes window
  noteActive: number | null
}

const PLAYER_KEY = 'deskwork.player'
function loadPlayer(): UiState['player'] {
  try {
    return JSON.parse(localStorage.getItem(PLAYER_KEY) ?? 'null')
  } catch {
    return null
  }
}

let state: UiState = {
  open: [],
  focusOrder: ['goals', 'tasks', 'completed'],
  details: null,
  creating: null,
  starting: null,
  completing: null,
  resourceEditing: null,
  attaching: null,
  player: null,
  reader: null,
  dialog: null,
  playerPlay: null,
  playerSeek: null,
  noteTabs: [],
  noteActive: null,
}
const initialPlayer = loadPlayer()
if (initialPlayer) state = { ...state, player: initialPlayer, open: ['player'], focusOrder: [...state.focusOrder, 'player'] }

// Open note tabs survive a reload, like the player.
const NOTES_KEY = 'deskwork.notes'
try {
  const saved = JSON.parse(localStorage.getItem(NOTES_KEY) ?? 'null') as { tabs: number[]; active: number | null } | null
  if (saved?.tabs?.length) {
    state = { ...state, noteTabs: saved.tabs, noteActive: saved.active ?? saved.tabs[0], open: [...state.open, 'notes'], focusOrder: [...state.focusOrder, 'notes'] }
  }
} catch {}

const listeners = new Set<() => void>()

export function setUi(patch: Partial<UiState> | ((s: UiState) => Partial<UiState>)) {
  const p = typeof patch === 'function' ? patch(state) : patch
  state = { ...state, ...p }
  if ('noteTabs' in p || 'noteActive' in p) {
    try {
      localStorage.setItem(NOTES_KEY, JSON.stringify({ tabs: state.noteTabs, active: state.noteActive }))
    } catch {}
  }
  if ('player' in p) {
    try {
      localStorage.setItem(PLAYER_KEY, JSON.stringify(state.player))
    } catch {}
  }
  listeners.forEach((l) => l())
}

export function useUi<T>(select: (s: UiState) => T): T {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => select(state),
  )
}

export const getUi = () => state

export function focusWindow(id: WindowId) {
  setUi((s) => (s.focusOrder.at(-1) === id ? {} : { focusOrder: [...s.focusOrder.filter((w) => w !== id), id] }))
}

export function openWindow(id: WindowId) {
  setUi((s) => ({ open: s.open.includes(id) ? s.open : [...s.open, id] }))
  focusWindow(id)
}

export function closeWindow(id: WindowId) {
  setUi((s) => ({
    open: s.open.filter((w) => w !== id),
    ...(id === 'player' ? { player: null } : {}),
    ...(id === 'reader' ? { reader: null } : {}),
    ...(id === 'notes' ? { noteTabs: [], noteActive: null } : {}),
  }))
}

let playCount = 0
export function openPlayer(ref: ItemRef, resourceId: number, opts: { play?: boolean; sync?: boolean } = {}) {
  setUi({ player: { ...ref, resourceId }, ...(opts.play ? { playerPlay: { ...ref, resourceId, n: ++playCount, sync: opts.sync } } : {}) })
  openWindow('player')
}

let seekCount = 0
/** Ask an open player showing this item's video to jump to a new start. */
export function seekPlayer(ref: ItemRef, resourceId: number, seconds: number, videoIndex: number | null) {
  const p = state.player
  if (p && p.type === ref.type && p.id === ref.id && p.resourceId === resourceId) {
    setUi({ playerSeek: { ...ref, resourceId, seconds, videoIndex, n: ++seekCount } })
  }
}

/** Show a goal or task in the item window, replacing whatever it showed. */
export function openDetails(ref: ItemRef) {
  setUi({ details: ref })
  focusWindow('item')
}

export function closeDetails() {
  setUi({ details: null })
}

/** Open a note in the Notes window: as a new tab, or switch to it if it's already open. */
export function openNote(id: number) {
  setUi((s) => ({ noteTabs: s.noteTabs.includes(id) ? s.noteTabs : [...s.noteTabs, id], noteActive: id }))
  openWindow('notes')
}

export function closeNoteTab(id: number) {
  setUi((s) => {
    const i = s.noteTabs.indexOf(id)
    const tabs = s.noteTabs.filter((t) => t !== id)
    const active = s.noteActive === id ? tabs[Math.min(i, tabs.length - 1)] ?? null : s.noteActive
    return { noteTabs: tabs, noteActive: active }
  })
}

let readerCount = 0
/** Open a book in Deskwork's reader, optionally at a page. */
export function openReader(ref: ItemRef, resourceId: number, page?: number) {
  setUi({ reader: { ...ref, resourceId, page, n: ++readerCount } })
  openWindow('reader')
}
