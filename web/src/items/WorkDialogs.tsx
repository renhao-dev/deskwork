import { useEffect, useState } from 'react'
import { Timer, Hourglass } from 'lucide-react'
import { api } from '../api.ts'
import { useQueryClient } from '@tanstack/react-query'
import { keys, useAction, useDashboard, useDetail, useMe, useRefreshAll } from '../hooks.ts'
import { KindIcon, openResource, playsInApp } from '../resources/resources.tsx'
import { openPlayer, setUi, useUi } from '../ui-store.ts'
import { Button, Dialog, DurationInput, ErrorText, Field, ProgressBar, toast, toastError } from '../ui.tsx'
import { formatClock, formatDuration } from '../../../shared/day.ts'
import { settle } from '../../../shared/timer.ts'
import { ensureNotificationPermission } from '../notify.ts'
import type { AttachedResource, BookmarkInput, Goal, Task, TimerMode } from '../../../shared/types.ts'

/** What choosing a resource in the Start dialog will do. */
function workFromText(r: AttachedResource): string {
  const b = r.bookmark
  if (r.kind === 'video') {
    if (playsInApp(r)) return b.seconds ? `Plays here from ${b.videoIndex != null ? `video ${b.videoIndex + 1}, ` : ''}${formatClock(b.seconds)}` : 'Plays here from the start'
    return 'Opens in a new tab'
  }
  if (r.kind === 'pdf') return r.hasFile ? (b.page ? `Opens at page ${b.page}` : 'Opens the book') : 'No file uploaded yet'
  if (r.kind === 'link') return 'Opens the link'
  if (r.kind === 'physical') return b.page ? `You're on page ${b.page}` : 'Nothing to open; counted as used'
  return ''
}

export function StartDialog() {
  const starting = useUi((s) => s.starting)
  const { data: me } = useMe()
  const qc = useQueryClient()
  const [mode, setMode] = useState<TimerMode>('regular')
  const [workFrom, setWorkFrom] = useState<number | 'none'>('none')
  const [sync, setSync] = useState(true)
  const detail = useDetail(starting?.type ?? 'goal', starting?.id ?? 0, !!starting)
  const resources = (detail.data?.resources ?? []).filter((r) => r.kind !== 'note')
  const chosen = resources.find((r) => r.id === workFrom)
  const chosenPlays = !!chosen && chosen.kind === 'video' && playsInApp(chosen)

  const start = useAction(
    () => api.startTimer(starting!.type, starting!.id, mode),
    () => {
      const ref = starting!
      setUi({ starting: null })
      if (!chosen) return
      if (chosenPlays) {
        api.setResourcePrefs(ref.type, ref.id, chosen.id, { syncTimer: sync })
          .then(() => qc.invalidateQueries({ queryKey: keys.detail(ref.type, ref.id) }), () => {})
        openPlayer(ref, chosen.id, { play: true, sync })
      } else {
        // Books and links were opened on the click (so the browser allows the window); now that the
        // timer exists, count them as used in this session.
        api.noteOpened(ref.type, ref.id, chosen.id).catch(() => {})
      }
    },
  )
  useEffect(() => {
    if (starting) {
      setMode('regular')
      start.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [starting])

  // Suggest what you used last time, or the only resource there is.
  useEffect(() => {
    if (!starting || !detail.data) return
    const ids = resources.map((r) => r.id)
    const last = detail.data.lastResourceId
    setWorkFrom(last != null && ids.includes(last) ? last : ids.length === 1 ? ids[0] : 'none')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [starting, detail.data?.item.id])
  useEffect(() => {
    setSync(chosen?.syncTimer ?? true)
  }, [chosen?.id, chosen?.syncTimer])

  const item = detail.data?.item
  const goal = starting?.type === 'goal' ? (item as Goal | undefined) : undefined
  const left = goal ? goal.budgetMinutes * 60 - goal.todaySeconds : null
  const p = me?.settings.pomodoro

  return (
    <Dialog
      open={!!starting}
      onClose={() => setUi({ starting: null })}
      title={item ? `Start “${item.title}”` : 'Start working'}
      footer={<>
        <Button variant="ghost" onClick={() => setUi({ starting: null })}>Cancel</Button>
        <Button variant="primary" disabled={start.isPending || !item} onClick={() => {
          // Starting is a good moment to ask for notification permission (it needs a click).
          if (me?.settings.notifications.enabled) ensureNotificationPermission().catch(() => {})
          // Open books and links now, while the click still counts: browsers block windows opened later.
          if (chosen && !chosenPlays && chosen.kind !== 'physical') openResource(chosen, starting!)
          start.mutate(undefined)
        }}>Start</Button>
      </>}
    >
      <div className="choice-group" role="radiogroup" aria-label="Kind of timer">
        <button type="button" role="radio" aria-checked={mode === 'regular'} className="choice" onClick={() => setMode('regular')}>
          <Hourglass size={20} />
          <span className="choice-title">Regular</span>
          <span className="choice-desc">
            {left != null ? `Counts down the ${formatDuration(left)} left today.` : starting?.type === 'goal' ? "Counts down today's budget." : 'Counts up until you stop or complete it.'}
          </span>
        </button>
        <button type="button" role="radio" aria-checked={mode === 'pomodoro'} className="choice" onClick={() => setMode('pomodoro')}>
          <Timer size={20} />
          <span className="choice-title">Pomodoro</span>
          <span className="choice-desc">
            {p ? `${p.work} min focus, ${p.short} min break, ${p.long} min break after every ${p.every}.` : 'Focus rounds with breaks.'}
            {left != null ? ' Breaks don’t use your budget.' : ''}
          </span>
        </button>
      </div>
      {resources.length > 0 && (
        <fieldset className="work-from">
          <legend>Work from</legend>
          {[{ id: 'none' as const }, ...resources].map((r) => {
            const res = r.id === 'none' ? null : (r as AttachedResource)
            const disabled = !!res && res.kind === 'pdf' && !res.hasFile
            return (
              <label key={r.id} className={`work-from-option${workFrom === r.id ? ' is-chosen' : ''}${disabled ? ' is-disabled' : ''}`}>
                <input type="radio" name="work-from" checked={workFrom === r.id} disabled={disabled} onChange={() => setWorkFrom(r.id)} />
                <span className="work-from-icon">{res ? <KindIcon kind={res.kind} /> : <Hourglass size={16} />}</span>
                <span className="work-from-text">
                  <span className="work-from-title">{res ? res.title : 'Just the timer'}</span>
                  <span className="work-from-desc">{res ? workFromText(res) : 'Don’t open anything'}</span>
                </span>
              </label>
            )
          })}
          {chosenPlays && (
            <label className="toggle-line work-from-sync">
              <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} />
              Pause the video when the timer pauses or takes a break
            </label>
          )}
        </fieldset>
      )}
      <ErrorText error={start.error ?? detail.error} />
    </Dialog>
  )
}

function parseClock(v: string): number | null {
  const t = v.trim()
  if (!t) return null
  const parts = t.split(':').map(Number)
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return NaN
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

const needsManualBookmark = (r: AttachedResource) =>
  r.kind === 'pdf' || r.kind === 'physical' || (r.kind === 'video' && r.videoSource === 'other')

export function CompleteDialog() {
  const completing = useUi((s) => s.completing)
  const { data: dash } = useDashboard()
  const detail = useDetail(completing?.type ?? 'goal', completing?.id ?? 0, !!completing)
  const [points, setPoints] = useState('')
  const [comment, setComment] = useState('')
  const [minutes, setMinutes] = useState(0)
  const [timeEdited, setTimeEdited] = useState(false)
  const [marks, setMarks] = useState<Record<number, string>>({})
  const [reached, setReached] = useState<Goal | null>(null)
  const refresh = useRefreshAll()

  const item = detail.data?.item
  const isGoal = completing?.type === 'goal'
  const goal = isGoal ? (item as Goal | undefined) : undefined
  const manualResources = (detail.data?.resources ?? []).filter(needsManualBookmark)
  // Cached timer data may predate the budget running out, so settle it to now.
  const timer = dash?.timer ? settle(dash.timer, Date.now()) : null
  const overBudget = !!timer && timer.budgetMs != null && timer.workMs >= timer.budgetMs && completing?.via === 'timer'

  useEffect(() => {
    if (!completing) return
    setPoints('')
    setComment('')
    setMarks({})
    setTimeEdited(false)
    complete.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completing])

  useEffect(() => {
    // Prefill bookmarks with where you stopped last time.
    const init: Record<number, string> = {}
    for (const r of manualResources) {
      if (r.kind === 'video') init[r.id] = r.bookmark.seconds != null ? formatClock(r.bookmark.seconds) : ''
      else init[r.id] = r.bookmark.page != null ? String(r.bookmark.page) : ''
    }
    setMarks(init)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data])

  const complete = useAction(
    () => {
      const bookmarks: BookmarkInput[] = []
      for (const r of manualResources) {
        const raw = marks[r.id] ?? ''
        if (r.kind === 'video') {
          const s = parseClock(raw)
          if (Number.isNaN(s)) throw new Error(`Write the time for “${r.title}” like 42:17 or 1:05:00`)
          if (s != null && s !== r.bookmark.seconds) bookmarks.push({ resourceId: r.id, seconds: s })
        } else if (raw.trim()) {
          const page = Number(raw)
          if (!Number.isInteger(page) || page < 0) throw new Error(`Page for “${r.title}” must be a whole number`)
          if (page !== r.bookmark.page) bookmarks.push({ resourceId: r.id, page })
        }
      }
      if (points.trim() && !(Number(points) >= 0)) throw new Error('Points must be zero or more')
      return api.complete(completing!.type, completing!.id, {
        points: isGoal && goal?.pointsTarget != null && points.trim() ? Number(points) : null,
        comment,
        bookmarks,
        // Only sent when you changed it, so the seconds already logged stay exact.
        seconds: timeEdited ? minutes * 60 : null,
        via: completing!.via,
      })
    },
    (res) => {
      toast(`Completed “${res.completion.itemTitle}”`)
      setUi({ completing: null })
      if (res.targetReached && goal) setReached(goal)
    },
  )

  const close = () => setUi({ completing: null })

  const spent = goal ? goal.todaySeconds : (item as Task | undefined)?.totalSeconds ?? 0
  const liveExtra = timer && completing && timer.itemType === completing.type && timer.itemId === completing.id ? timer.workMs / 1000 : 0
  useEffect(() => {
    if (!timeEdited) setMinutes(Math.round((spent + liveExtra) / 60))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Math.round((spent + liveExtra) / 60), timeEdited, completing])

  return (
    <>
      <Dialog
        open={!!completing}
        onClose={close}
        title={item ? (isGoal ? `Done with “${item.title}” for today` : `Complete “${item.title}”`) : 'Complete'}
        description={
          overBudget ? "You've used today's time budget. Log what you got done, or keep going into overtime." : undefined
        }
        footer={<>
          <Button variant="ghost" onClick={close}>{overBudget ? 'Keep going' : 'Cancel'}</Button>
          <Button variant="primary" onClick={() => complete.mutate(undefined)} disabled={complete.isPending || !item}>
            {isGoal ? 'Complete for today' : 'Complete task'}
          </Button>
        </>}
      >
        <Field label={isGoal ? 'Time spent today' : 'Time spent'}
          hint={goal ? `Of ${formatDuration(goal.budgetMinutes * 60)} budgeted. Change it if the timer didn't match; zero records none.`
            : "Change it if the timer didn't match; zero records none."}>
          <DurationInput minutes={minutes} onChange={(m) => {
            setMinutes(m)
            setTimeEdited(true)
          }} />
        </Field>
        {goal?.pointsTarget != null && (
          <div className="points-field">
            <Field label="Points accomplished" hint="Added to the goal's progress.">
              <input type="number" min={0} inputMode="numeric" value={points} autoFocus
                onChange={(e) => setPoints(e.target.value)} placeholder="0" />
            </Field>
            <ProgressBar done={goal.pointsDone + (Number(points) > 0 ? Number(points) : 0)} target={goal.pointsTarget} />
          </div>
        )}
        {manualResources.map((r) => (
          <Field key={r.id} label={r.kind === 'video' ? `Stopped at in “${r.title}”` : `Stopped at page in “${r.title}”`}
            hint={r.kind === 'video' ? 'Like 42:17 or 1:05:00' : r.totalPages ? `of ${r.totalPages} pages` : undefined}>
            <input value={marks[r.id] ?? ''} inputMode={r.kind === 'video' ? 'text' : 'numeric'}
              onChange={(e) => setMarks((m) => ({ ...m, [r.id]: e.target.value }))} />
          </Field>
        ))}
        <Field label="Comment (optional)">
          <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What did you get through?" />
        </Field>
        <ErrorText error={complete.error} />
      </Dialog>

      <Dialog
        open={!!reached}
        onClose={() => setReached(null)}
        title="Target reached"
        footer={<>
          <Button variant="ghost" onClick={() => setReached(null)}>Keep going</Button>
          <Button variant="primary" onClick={() => {
            api.updateGoal(reached!.id, { archived: true }).then(() => { toast(`Archived “${reached!.title}”`); refresh() }, toastError)
            setReached(null)
          }}>Archive goal</Button>
        </>}
      >
        <p>
          You've reached all {reached?.pointsTarget} points of “{reached?.title}”. Archive it so it stops showing up every day,
          or keep going.
        </p>
      </Dialog>
    </>
  )
}
