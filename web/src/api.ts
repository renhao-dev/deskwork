import { useSyncExternalStore } from 'react'
import type {
  AttachedResource, Backlink, BookmarkInput, Comment, CompleteInput, CompleteResult, Completion, Dashboard, Goal, ItemDetail, LinkTarget,
  ItemType, Note, NoteSummary, Resource, ResourceFolder, SearchHit, Space, SpaceInput, Task, TimerMode, User, UserSettings, WorkSession,
} from '../../shared/types.ts'
import type { TimerState } from '../../shared/timer.ts'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// ---------- server reachability ----------

let online = true
const listeners = new Set<() => void>()
let probe: ReturnType<typeof setInterval> | null = null
const onlineListeners = new Set<() => void>()

function setOnline(value: boolean) {
  if (online === value) return
  online = value
  listeners.forEach((l) => l())
  if (!value && !probe) {
    probe = setInterval(async () => {
      try {
        const r = await fetch('/api/health', { cache: 'no-store' })
        if (r.ok) {
          clearInterval(probe!)
          probe = null
          setOnline(true)
          onlineListeners.forEach((l) => l())
        }
      } catch {}
    }, 3000)
  }
}

export function useServerOnline() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => online,
  )
}

export function onReconnect(fn: () => void) {
  onlineListeners.add(fn)
  return () => {
    onlineListeners.delete(fn)
  }
}

// ---------- fetch ----------

export async function request<T>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body !== undefined && !(body instanceof Blob) ? { 'Content-Type': 'application/json' } : undefined,
      body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
      credentials: 'same-origin',
      ...init,
    })
  } catch {
    setOnline(false)
    throw new ApiError(0, 'The server is offline. Your data is safe; changes will work again once it is back.')
  }
  // The Vite dev proxy answers 502/504 when the API process is down.
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    setOnline(false)
    throw new ApiError(0, 'The server is offline. Your data is safe; changes will work again once it is back.')
  }
  setOnline(true)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`)
  return data as T
}

const itemPath = (type: ItemType, id: number) => `/${type}s/${id}`

export const api = {
  me: () => request<User>('GET', '/me'),
  login: (username: string, password: string) => request<User>('POST', '/auth/login', { username, password }),
  logout: () => request('POST', '/auth/logout'),
  saveSettings: (patch: Partial<UserSettings>) => request<User>('PUT', '/me/settings', patch),
  /** Forget where the windows were, so they come back to their usual places. */
  tidyWindows: () => request<User>('PUT', '/me/settings', { layout: null }),
  changePassword: (current: string, next: string) => request('PUT', '/me/password', { current, next }),

  users: () => request<User[]>('GET', '/users'),
  createUser: (username: string, password: string, isAdmin: boolean) => request<User>('POST', '/users', { username, password, isAdmin }),
  updateUser: (id: number, patch: { password?: string; isAdmin?: boolean }) => request<User>('PUT', `/users/${id}`, patch),
  deleteUser: (id: number) => request('DELETE', `/users/${id}`),

  dashboard: () => request<Dashboard>('GET', '/dashboard'),
  startTimer: (itemType: ItemType, itemId: number, mode: TimerMode) => request<{ timer: TimerState }>('POST', '/timer/start', { itemType, itemId, mode }),
  pauseTimer: () => request<{ timer: TimerState }>('POST', '/timer/pause'),
  resumeTimer: () => request<{ timer: TimerState }>('POST', '/timer/resume'),
  stopTimer: () => request<{ session: WorkSession | null }>('POST', '/timer/stop'),

  undoCompletion: (id: number) =>
    request<{ itemType: ItemType; itemId: number; itemTitle: string; stillArchived: boolean }>('POST', `/completions/${id}/undo`),
  goals: () => request<Goal[]>('GET', '/goals'),
  tasks: () => request<Task[]>('GET', '/tasks'),
  createGoal: (g: Partial<Goal>) => request<Goal>('POST', '/goals', g),
  reorderGoals: (ids: number[]) => request('PUT', '/goals/order', { ids }),
  reorderTasks: (ids: number[]) => request('PUT', '/tasks/order', { ids }),
  updateGoal: (id: number, g: Partial<Goal> & { archived?: boolean }) => request<Goal>('PUT', `/goals/${id}`, g),
  createTask: (t: Partial<Task>) => request<Task>('POST', '/tasks', t),
  updateTask: (id: number, t: Partial<Task> & { reopen?: boolean }) => request<Task>('PUT', `/tasks/${id}`, t),
  detail: (type: ItemType, id: number) => request<ItemDetail<Goal | Task>>('GET', itemPath(type, id)),
  deleteItem: (type: ItemType, id: number) => request('DELETE', itemPath(type, id)),
  uncomplete: (type: ItemType, id: number) =>
    request<{ itemType: ItemType; itemId: number; itemTitle: string; stillArchived: boolean }>('POST', `${itemPath(type, id)}/uncomplete`),
  complete: (type: ItemType, id: number, input: CompleteInput) => request<CompleteResult>('POST', `${itemPath(type, id)}/complete`, input),
  addComment: (type: ItemType, id: number, body: string) => request<Comment>('POST', `${itemPath(type, id)}/comments`, { body }),
  deleteComment: (id: number) => request('DELETE', `/comments/${id}`),
  attach: (type: ItemType, id: number, resourceId: number) => request<AttachedResource[]>('POST', `${itemPath(type, id)}/resources`, { resourceId }),
  detach: (type: ItemType, id: number, resourceId: number) => request<AttachedResource[]>('DELETE', `${itemPath(type, id)}/resources/${resourceId}`),
  saveBookmark: (type: ItemType, id: number, b: BookmarkInput) =>
    request('PUT', `${itemPath(type, id)}/resources/${b.resourceId}/bookmark`, b),
  setResourcePrefs: (type: ItemType, id: number, resourceId: number, prefs: { syncTimer?: boolean | null }) =>
    request('PUT', `${itemPath(type, id)}/resources/${resourceId}/prefs`, prefs),
  /** Tell the server a resource was opened, so a running timer's session lists it. */
  noteOpened: (type: ItemType, id: number, resourceId: number) =>
    request('POST', `${itemPath(type, id)}/resources/${resourceId}/opened`),

  notes: (type: ItemType, id: number, trash = false) => request<NoteSummary[]>('GET', `${itemPath(type, id)}/notes${trash ? '?trash=1' : ''}`),
  createNote: (type: ItemType, id: number, n: { title?: string; body?: string }) => request<Note>('POST', `${itemPath(type, id)}/notes`, n),
  emptyTrash: (type: ItemType, id: number) => request('DELETE', `${itemPath(type, id)}/notes/trash`),
  note: (id: number) => request<Note>('GET', `/notes/${id}`),
  updateNote: (id: number, n: { title?: string; body?: string }) => request<Note>('PUT', `/notes/${id}`, n),
  trashNote: (id: number) => request('DELETE', `/notes/${id}`),
  restoreNote: (id: number) => request<Note>('POST', `/notes/${id}/restore`),
  deleteNoteForever: (id: number) => request('DELETE', `/notes/${id}/forever`),
  uploadNoteImage: (file: Blob, name: string) =>
    request<{ id: string; url: string }>('POST', '/note-images', file, {
      headers: { 'Content-Type': file.type || 'image/png', 'X-File-Name': encodeURIComponent(name) },
    }),

  resources: () => request<Resource[]>('GET', '/resources'),
  resource: (id: number) => request<Resource>('GET', `/resources/${id}`),
  createResource: (r: Partial<Resource>) => request<Resource>('POST', '/resources', r),
  updateResource: (id: number, r: Partial<Resource>) => request<Resource>('PUT', `/resources/${id}`, r),
  deleteResource: (id: number) => request('DELETE', `/resources/${id}`),
  folders: () => request<ResourceFolder[]>('GET', '/resource-folders'),
  createFolder: (name: string, parentId: number | null) => request<ResourceFolder>('POST', '/resource-folders', { name, parentId }),
  updateFolder: (id: number, patch: { name?: string; parentId?: number | null }) =>
    request<ResourceFolder>('PUT', `/resource-folders/${id}`, patch),
  deleteFolder: (id: number) => request('DELETE', `/resource-folders/${id}`),

  spaces: () => request<Space[]>('GET', '/spaces'),
  createSpace: (input: SpaceInput) => request<Space>('POST', '/spaces', input),
  updateSpace: (id: number, input: SpaceInput) => request<Space>('PUT', `/spaces/${id}`, input),
  deleteSpace: (id: number) => request('DELETE', `/spaces/${id}`),
  setGoalSpace: (goalId: number, spaceId: number) => request<Goal>('PUT', `/goals/${goalId}/space`, { spaceId }),
  linkTargets: (q: string) => request<LinkTarget[]>('GET', `/link-targets?q=${encodeURIComponent(q)}`),
  backlinks: (kind: 'pages' | 'goals' | 'tasks' | 'books', id: number) =>
    request<Backlink[]>('GET', `/backlinks/${kind}/${id}`),
  search: (q: string, spaceId?: number) =>
    request<SearchHit[]>('GET', `/search?q=${encodeURIComponent(q)}${spaceId ? `&spaceId=${spaceId}` : ''}`),
  spacePages: (spaceId: number, trash = false) =>
    request<NoteSummary[]>('GET', `/spaces/${spaceId}/pages${trash ? '?trash=1' : ''}`),
  createPage: (spaceId: number, input: { title?: string; body?: string; parentId?: number | null }) =>
    request<Note>('POST', `/spaces/${spaceId}/pages`, input),
  movePage: (id: number, to: { spaceId?: number; parentId?: number | null }) =>
    request<Note>('PUT', `/notes/${id}/move`, to),
  emptySpaceTrash: (spaceId: number) => request('DELETE', `/spaces/${spaceId}/trash`),
  reorderPages: (spaceId: number, pages: { id: number; parentId: number | null }[]) =>
    request('PUT', `/spaces/${spaceId}/pages/order`, { pages }),
  uploadFile: (id: number, file: File) =>
    request<Resource>('PUT', `/resources/${id}/file`, file, {
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
    }),

  addWorkSession: (type: ItemType, id: number, seconds: number, day?: string) =>
    request<WorkSession>('POST', `${itemPath(type, id)}/sessions`, { seconds, day }),
  updateWorkSession: (id: number, seconds: number) => request('PUT', `/sessions/${id}`, { seconds }),
  deleteWorkSession: (id: number) => request('DELETE', `/sessions/${id}`),
  itemSessions: (type: ItemType, id: number, before?: string) =>
    request<WorkDays & { totals: { seconds: number; count: number; last7Seconds: number } }>(
      'GET', `${itemPath(type, id)}/sessions${before ? `?before=${before}` : ''}`),
  workHistory: (before?: string, type?: ItemType) =>
    request<WorkDays>(
      'GET', `/history/work?${new URLSearchParams({ ...(before ? { before } : {}), ...(type ? { type } : {}) })}`),
  completionHistory: (opts: { type?: ItemType; order: 'asc' | 'desc'; offset: number }) =>
    request<{ items: Completion[]; nextOffset: number | null }>(
      'GET', `/history/completions?${new URLSearchParams({ order: opts.order, offset: String(opts.offset), ...(opts.type ? { type: opts.type } : {}) })}`),
}

export interface WorkDay { day: string; seconds: number; sessions: WorkSession[]; completions: Completion[] }
export interface WorkDays { days: WorkDay[]; nextBefore: string | null }

export const fileUrl = (resourceId: number) => `/api/resources/${resourceId}/file`
