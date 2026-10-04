// Work sessions as shown in a goal's Sessions tab and in History: grouped by day, one line per
// session that expands to what was used during it.
import { useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { CircleCheck, ChevronRight, ListChecks, MoreHorizontal, Pencil, Plus, Target, Trash2, Undo2 } from 'lucide-react'
import { api, type WorkDay } from '../api.ts'
import { keys, useRefreshAll, useTimerView } from '../hooks.ts'
import { openDetails, type ItemRef } from '../ui-store.ts'
import { Button, Confirm, Dialog, DurationInput, Empty, Field, IconButton, toast, toastError } from '../ui.tsx'
import { KindIcon } from '../resources/resources.tsx'
import { undoCompletion } from './undoCompletion.ts'
import { formatClock, formatDuration } from '../../../shared/day.ts'
import type { Completion, ResourceUse, WorkSession } from '../../../shared/types.ts'

/** Where you started and stopped in a resource during one session, e.g. "12:05 → 34:10" or "p. 137 → 152". */
export function useRange(u: ResourceUse): string {
  if (u.kind === 'video' && (u.toSeconds != null || u.toIndex != null)) {
    const at = (idx: number | null, sec: number | null) => `${idx != null ? `video ${idx + 1}, ` : ''}${formatClock(sec ?? 0)}`
    const from = at(u.fromIndex, u.fromSeconds)
    const to = at(u.toIndex ?? u.fromIndex, u.toSeconds)
    return from === to ? `at ${to}` : `${from} → ${to}`
  }
  if ((u.kind === 'pdf' || u.kind === 'physical') && u.toPage != null) {
    if (u.fromPage == null || u.fromPage === u.toPage) return `p. ${u.toPage}`
    return `p. ${u.fromPage} → ${u.toPage}`
  }
  return 'opened'
}

const time = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { timeStyle: 'short' })
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export const dayTitle = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

function UsedList({ uses }: { uses: ResourceUse[] }) {
  return (
    <div className="session-used">
      <span className="session-part-label">Used</span>
      <ul>
        {uses.map((u) => (
          <li key={u.resourceId}>
            <KindIcon kind={u.kind} size={14} />
            <span className="session-use-title">{u.title}</span>
            <span className="session-use-range">{useRange(u)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** One session: a summary line that expands when there's something inside. */
export function SessionRow({ s, showItem }: { s: WorkSession; showItem?: boolean }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [minutes, setMinutes] = useState(Math.round(s.seconds / 60))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const refresh = useRefreshAll()
  const hasContent = s.resources.length > 0
  const summary = [
    formatDuration(s.seconds),
    s.mode === 'pomodoro' ? 'pomodoro' : s.mode === 'manual' ? 'added by hand' : '',
    hasContent ? plural(s.resources.length, 'resource') : '',
  ].filter(Boolean).join(' · ')

  const saveTime = (mins: number) => {
    api.updateWorkSession(s.id, Math.max(1, mins) * 60).then(() => {
      setEditing(false)
      refresh()
      toast('Time updated')
    }, toastError)
  }

  return (
    <li className={`session${open ? ' is-open' : ''}`}>
      <div className="session-line">
        {hasContent ? (
          <button type="button" className="session-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}
            aria-label={`${open ? 'Hide' : 'Show'} what was used ${time(s.startedAt)}–${time(s.endedAt)}`}>
            <ChevronRight size={14} />
          </button>
        ) : <span className="session-toggle" aria-hidden />}
        <span className="session-time">{time(s.startedAt)}–{time(s.endedAt)}</span>
        {showItem && (
          <button type="button" className="session-item" onClick={() => openDetails({ type: s.itemType, id: s.itemId })}>
            <span className={`type-mark type-${s.itemType}`}>{s.itemType === 'goal' ? <Target size={13} /> : <ListChecks size={13} />}</span>
            {s.itemTitle}
          </button>
        )}
        <span className="session-summary" onClick={() => hasContent && setOpen((o) => !o)}>{summary}</span>
        <Menu.Root>
          <Menu.Trigger asChild>
            <IconButton label="Session actions" className="session-more"><MoreHorizontal size={15} /></IconButton>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content className="menu" align="end" sideOffset={4}>
              <Menu.Item className="menu-item" onSelect={() => {
                setMinutes(Math.max(1, Math.round(s.seconds / 60)))
                setEditing(true)
              }}><Pencil size={15} /> Edit time</Menu.Item>
              <Menu.Item className="menu-item" onSelect={() => setConfirmDelete(true)}><Trash2 size={15} /> Delete session</Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      </div>
      {editing && (
        <form className="session-edit" onSubmit={(e) => (e.preventDefault(), saveTime(minutes))}>
          <DurationInput minutes={minutes} onChange={setMinutes} />
          <Button size="sm" variant="primary" type="submit">Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
        </form>
      )}
      <Confirm open={confirmDelete} onClose={() => setConfirmDelete(false)} confirmLabel="Delete session"
        title={`Delete this ${formatDuration(s.seconds)} session?`}
        onConfirm={() => api.deleteWorkSession(s.id).then(() => {
          setConfirmDelete(false)
          refresh()
          toast('Session deleted')
        }, toastError)}>
        <p>The time is taken off this day's total{s.resources.length ? ', along with what it lists as used' : ''}.</p>
      </Confirm>
      {open && <div className="session-body"><UsedList uses={s.resources} /></div>}
    </li>
  )
}

function CompletionLine({ c }: { c: Completion }) {
  const qc = useQueryClient()
  return (
    <li className="session-done">
      <CircleCheck size={15} aria-hidden />
      <span>{c.itemType === 'goal' ? 'Completed for today' : 'Completed'}</span>
      {c.points != null && <span className="points">+{c.points} pts</span>}
      {c.comment && <span className="session-done-comment">“{c.comment}”</span>}
      <Button size="sm" variant="ghost" className="session-undo" onClick={() => undoCompletion(qc, c.id)}>
        <Undo2 size={14} /> {c.itemType === 'goal' ? 'Put back on the list' : 'Reopen'}
      </Button>
    </li>
  )
}

export function DayGroup({ d, showItem }: { d: WorkDay; showItem?: boolean }) {
  return (
    <section className="log-day">
      <header>
        <h3>{dayTitle(d.day)}</h3>
        <span className="log-total">{formatDuration(d.seconds)}</span>
      </header>
      <ul className="sessions">
        {/* Newest first: the day's completion closes it, so it comes before its sessions. */}
        {d.completions.map((c) => <CompletionLine key={`c${c.id}`} c={c} />)}
        {d.sessions.map((s) => <SessionRow key={s.id} s={s} showItem={showItem} />)}
      </ul>
    </section>
  )
}

/** The running timer on this item, with what's been used so far. */
function LiveSession({ refItem }: { refItem: ItemRef }) {
  const view = useTimerView()
  const t = view?.state
  if (!t || t.itemType !== refItem.type || t.itemId !== refItem.id) return null
  const uses = Object.values(t.used ?? {})
  return (
    <div className="session-live">
      <div className="session-line">
        <span className="live-dot">In progress</span>
        <span className="session-summary">started {time(t.startedAt)} · {formatDuration(view.workSeconds)}{t.status === 'paused' ? ' · paused' : ''}</span>
      </div>
      {uses.length > 0 && <div className="session-body"><UsedList uses={uses} /></div>}
    </div>
  )
}

/** Add time worked away from Deskwork. */
function AddTimeDialog({ refItem, open, onClose }: { refItem: ItemRef; open: boolean; onClose: () => void }) {
  const [minutes, setMinutes] = useState(30)
  const refresh = useRefreshAll()
  const add = () => {
    api.addWorkSession(refItem.type, refItem.id, Math.max(1, minutes) * 60).then(() => {
      onClose()
      refresh()
      toast(`Added ${formatDuration(minutes * 60)} to today`)
    }, toastError)
  }
  return (
    <Dialog open={open} onClose={onClose} title="Add time to today"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={add}>Add time</Button>
      </>}>
      <Field label="How long" hint="For work done away from Deskwork. It counts toward today's budget.">
        <DurationInput minutes={minutes} onChange={setMinutes} />
      </Field>
    </Dialog>
  )
}

/** A goal's or task's Sessions tab. */
export function ItemSessions({ refItem }: { refItem: ItemRef }) {
  const [adding, setAdding] = useState(false)
  const q = useInfiniteQuery({
    queryKey: [...keys.history, 'item', refItem.type, refItem.id],
    queryFn: ({ pageParam }) => api.itemSessions(refItem.type, refItem.id, pageParam || undefined),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  })
  const totals = q.data?.pages[0]?.totals
  const days = q.data?.pages.flatMap((p) => p.days) ?? []
  return (
    <div className="item-sessions">
      <div className="session-head">
        {totals && totals.count > 0 ? (
          <p className="session-totals">
            <strong>{formatDuration(totals.seconds)}</strong> in total · {plural(totals.count, 'session')} ·{' '}
            <strong>{formatDuration(totals.last7Seconds)}</strong> in the last 7 days
          </p>
        ) : <span />}
        <Button size="sm" onClick={() => setAdding(true)}><Plus size={14} /> Add time</Button>
      </div>
      <AddTimeDialog refItem={refItem} open={adding} onClose={() => setAdding(false)} />
      <LiveSession refItem={refItem} />
      {q.isPending ? <p className="muted pad">Loading…</p> : days.length === 0 ? (
        <Empty>No sessions yet. Press Start to begin one; each run of the timer shows up here.</Empty>
      ) : (
        <div className="log">
          {days.map((d) => <DayGroup key={d.day} d={d} />)}
          {q.hasNextPage && <Button onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>Show earlier days</Button>}
        </div>
      )}
    </div>
  )
}
