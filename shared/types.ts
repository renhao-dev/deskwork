// Types shared by the server and the web app.

export type ItemType = 'goal' | 'task'
export type TimerMode = 'regular' | 'pomodoro'
export type ResourceKind = 'pdf' | 'physical' | 'link' | 'note' | 'video'
export type VideoSource = 'youtube' | 'file' | 'other'

export interface PomodoroSettings {
  work: number // minutes
  short: number
  long: number
  every: number // long break after this many work rounds
}

export interface WindowRect {
  x: number
  y: number
  w: number
  h: number
  z?: number
  /** Filling the whole desk; x/y/w/h keep the size to go back to. */
  max?: boolean
}

export type Theme = 'system' | 'light' | 'dark'

export interface UserSettings {
  theme: Theme
  dayStartHour: number // day rolls over at this local hour
  timezone: string
  pomodoro: PomodoroSettings
  layout: Record<string, WindowRect> // null in a settings update clears it ("Tidy windows")
  notifications: NotificationSettings
}

export interface NotificationSettings {
  enabled: boolean // system notifications, e.g. when a goal's time budget is used up
  pomodoro: boolean // also when pomodoro breaks start and end
}

export interface User {
  id: number
  username: string
  isAdmin: boolean
  createdAt: number
  settings: UserSettings
}

export interface Goal {
  id: number
  title: string
  description: string
  budgetMinutes: number
  pointsTarget: number | null
  pointsDone: number
  archivedAt: number | null
  createdAt: number
  updatedAt: number
  // derived for "today"
  todaySeconds: number
  completedToday: boolean
}

export interface Task {
  id: number
  title: string
  description: string
  scheduledDay: string | null // YYYY-MM-DD, null = any day
  completedAt: number | null
  createdAt: number
  updatedAt: number
  totalSeconds: number
}

export interface Comment {
  id: number
  body: string
  createdAt: number
}

export interface Resource {
  id: number
  kind: ResourceKind
  title: string
  author: string
  url: string
  note: string
  totalPages: number | null
  videoSource: VideoSource | null
  fileName: string | null
  fileSize: number | null
  hasFile: boolean
  folderId: number | null
  createdAt: number
}

export interface ResourceFolder {
  id: number
  name: string
  parentId: number | null // null = top level
  createdAt: number
}

export interface Bookmark {
  page: number | null
  seconds: number | null
  videoIndex: number | null
  updatedAt: number | null
}

export interface AttachedResource extends Resource {
  bookmark: Bookmark
  /** Video only: pause and play along with the timer. null until you've chosen. */
  syncTimer: boolean | null
}

export interface ItemDetail<T> {
  item: T
  comments: Comment[]
  resources: AttachedResource[]
  /** The resource used most recently in a session, to suggest when starting. */
  lastResourceId: number | null
}

export interface WorkSession {
  id: number
  itemType: ItemType
  itemId: number
  itemTitle: string
  mode: TimerMode | 'manual' // "manual" = time you entered yourself
  startedAt: number
  endedAt: number
  seconds: number
  day: string
  /** Resources used during the session, and how far you got in each. */
  resources: ResourceUse[]
}

/** One resource used during a work session. Positions are where you started and where you stopped. */
export interface ResourceUse {
  resourceId: number
  title: string // as it was then, so history survives renames and deletes
  kind: ResourceKind
  fromSeconds: number | null
  toSeconds: number | null
  fromIndex: number | null // playlist video, 0-based
  toIndex: number | null
  fromPage: number | null
  toPage: number | null
}

export interface Completion {
  id: number
  itemType: ItemType
  itemId: number
  itemTitle: string
  completedAt: number
  day: string
  seconds: number
  points: number | null
  comment: string
  via: 'timer' | 'manual'
}

export interface Dashboard {
  today: string
  goals: Goal[]
  tasks: Task[]
  completions: Completion[]
  todaySeconds: number // logged work today, excluding the live timer
  timer: import('./timer.ts').TimerState | null
}

export interface BookmarkInput {
  resourceId: number
  page?: number | null
  seconds?: number | null
  videoIndex?: number | null
  /** Set by hand (e.g. skipping what you watched before), rather than progress made while working. */
  manual?: boolean
}

export interface CompleteInput {
  points?: number | null
  comment?: string
  /** Time to record for this day (a goal) or in total (a task). Zero clears it. */
  seconds?: number | null
  bookmarks?: BookmarkInput[]
  via?: 'timer' | 'manual'
}

export interface CompleteResult {
  completion: Completion
  targetReached: boolean
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'system',
  dayStartHour: 4,
  timezone: 'UTC',
  pomodoro: { work: 25, short: 5, long: 15, every: 4 },
  layout: {},
  notifications: { enabled: true, pomodoro: true },
}

export interface NoteSummary {
  id: number
  itemType: ItemType
  itemId: number
  title: string
  excerpt: string // the start of the text, without Markdown
  firstImage: string | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null // in the Trash since
}

export interface Note extends NoteSummary {
  body: string // Markdown
  itemTitle: string
}
