// A "day" starts at `startHour` local time, so late-night work counts toward the previous day.

const HOUR = 3_600_000
const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timezone: string) {
  let f = formatters.get(timezone)
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    } catch {
      f = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' })
    }
    formatters.set(timezone, f)
  }
  return f
}

/** YYYY-MM-DD of the working day that `ts` belongs to. */
export function dayKey(ts: number, timezone: string, startHour: number): string {
  return formatter(timezone).format(new Date(ts - startHour * HOUR))
}

export function formatDuration(totalSeconds: number, withSeconds = false): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (withSeconds) {
    const sec = s % 60
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
  }
  if (h === 0) return s > 0 && m === 0 ? 'under 1 min' : `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

export function pad(n: number) {
  return String(n).padStart(2, '0')
}

export function formatClock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`
}

/** Whole days from day `a` to day `b`, both as YYYY-MM-DD. */
export function daysBetween(a: string, b: string) {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

export interface ScheduleLabel {
  text: string
  tone: 'today' | 'late' | 'future'
}

/** How a task's scheduled day reads next to today: "Today", "3 days late", or its date. */
export function scheduleLabel(scheduledDay: string | null, today: string): ScheduleLabel | null {
  if (!scheduledDay) return null
  const days = daysBetween(scheduledDay, today)
  if (days === 0) return { text: 'Today', tone: 'today' }
  if (days > 0) return { text: days === 1 ? 'Yesterday' : `${days} days late`, tone: 'late' }
  if (days === -1) return { text: 'Tomorrow', tone: 'future' }
  return {
    text: new Date(`${scheduledDay}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
    tone: 'future',
  }
}
