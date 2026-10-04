import { Play, Trash2, CalendarDays, GripVertical } from 'lucide-react'
import type { LiHTMLAttributes, ReactNode } from 'react'
import { useDashboard } from '../hooks.ts'
import { openDetails, setUi } from '../ui-store.ts'
import { Button, Explained, IconButton, ProgressBar } from '../ui.tsx'
import { CompleteCheck } from './CompleteCheck.tsx'
import { formatDuration, scheduleLabel } from '../../../shared/day.ts'
import type { Goal, ItemType, Task } from '../../../shared/types.ts'

/** Why Start is unavailable for this item, or null when it can start. */
export function useStartBlock(type: ItemType, id: number, extra?: string | null): { reason: string | null; active: boolean } {
  const { data } = useDashboard()
  const t = data?.timer
  const active = !!t && t.itemType === type && t.itemId === id
  if (t) return { reason: active ? "You're working on this right now" : `You're working on “${t.itemTitle}” right now`, active }
  return { reason: extra ?? null, active }
}

function Row({
  type, id, title, active, done, children, actions, onDelete, liProps,
}: {
  type: ItemType; id: number; title: string; active: boolean; done?: boolean
  children?: ReactNode; actions: ReactNode; onDelete?: () => void
  /** Extra props for the row, e.g. to make it draggable. */
  liProps?: LiHTMLAttributes<HTMLLIElement> & Record<`data-${string}`, string | undefined>
}) {
  const open = () => openDetails({ type, id })
  return (
    <li className={`row${active ? ' is-active' : ''}${done ? ' is-done' : ''}`} {...liProps}>
      {liProps?.draggable && <span className="row-grip" aria-hidden><GripVertical size={14} /></span>}
      <div
        className="row-main"
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open())}
      >
        <span className="row-title">{title}</span>
        {children}
      </div>
      <div className="row-actions">
        {actions}
        {onDelete && (
          <IconButton label={`Delete ${title}`} className="danger-hover" onClick={onDelete}><Trash2 size={16} /></IconButton>
        )}
      </div>
    </li>
  )
}

export function GoalRow({ goal, onDelete, showState, liProps }: {
  goal: Goal; onDelete?: () => void; showState?: boolean; liProps?: Parameters<typeof Row>[0]['liProps']
}) {
  const unavailable = goal.archivedAt
    ? 'This goal is archived'
    : goal.completedToday
      ? 'Done for today. It comes back tomorrow.'
      : null
  const { reason, active } = useStartBlock('goal', goal.id, unavailable)
  const completeBlocked = goal.archivedAt && !goal.completedToday ? 'This goal is archived' : null
  return (
    <Row
      type="goal" id={goal.id} title={goal.title} active={active} done={showState && (goal.completedToday || !!goal.archivedAt)}
      onDelete={onDelete} liProps={liProps}
      actions={<>
        <Explained reason={reason}>
          <Button variant="brass" size="sm" disabled={!!reason} onClick={(e) => { e.stopPropagation(); setUi({ starting: { type: 'goal', id: goal.id } }) }}>
            <Play size={14} /> Start
          </Button>
        </Explained>
        <CompleteCheck refItem={{ type: 'goal', id: goal.id }} done={goal.completedToday} blocked={completeBlocked}
          aria={goal.completedToday ? `“${goal.title}” is done for today` : `Complete “${goal.title}” for today`} />
      </>}
    >
      {goal.pointsTarget != null && <ProgressBar done={goal.pointsDone} target={goal.pointsTarget} compact />}
      <span className="row-meta">
        {active ? <span className="live-dot">In progress</span> : null}
        {formatDuration(goal.todaySeconds)} of {formatDuration(goal.budgetMinutes * 60)} today
        {showState && goal.archivedAt ? <span className="tag">Archived</span> : null}
        {showState && goal.completedToday && !goal.archivedAt ? <span className="tag tag-ok">Done today</span> : null}
      </span>
    </Row>
  )
}

export function TaskRow({ task, onDelete, showState, liProps }: {
  task: Task; onDelete?: () => void; showState?: boolean; liProps?: Parameters<typeof Row>[0]['liProps']
}) {
  const { reason, active } = useStartBlock('task', task.id, task.completedAt ? 'This task is completed' : null)
  const { data: dash } = useDashboard()
  // "Today", "3 days late", or the date: a plain date doesn't say whether it's due.
  const due = dash ? scheduleLabel(task.scheduledDay, dash.today) : null
  return (
    <Row
      type="task" id={task.id} title={task.title} active={active} done={!!task.completedAt} onDelete={onDelete} liProps={liProps}
      actions={task.completedAt ? (
        <CompleteCheck refItem={{ type: 'task', id: task.id }} done aria={`“${task.title}” is completed`} />
      ) : <>
        <Explained reason={reason}>
          <Button variant="brass" size="sm" disabled={!!reason} onClick={(e) => { e.stopPropagation(); setUi({ starting: { type: 'task', id: task.id } }) }}>
            <Play size={14} /> Start
          </Button>
        </Explained>
        <CompleteCheck refItem={{ type: 'task', id: task.id }} done={false} aria={`Complete “${task.title}”`} />
      </>}
    >
      {(active || task.totalSeconds > 0 || due || (showState && task.completedAt)) && (
        <span className="row-meta">
          {due ? <span className={`tag tag-${due.tone}`}><CalendarDays size={12} /> {due.text}</span> : null}
          {active ? <span className="live-dot">In progress</span> : null}
          {task.totalSeconds > 0 ? `${formatDuration(task.totalSeconds)} spent` : null}
          {showState && task.completedAt ? <span className="tag tag-ok">Completed</span> : null}
        </span>
      )}
    </Row>
  )
}
