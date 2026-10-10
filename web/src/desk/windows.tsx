import { useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import * as Tabs from '@radix-ui/react-tabs'
import { Plus, Target, ListChecks, CircleCheckBig, History, Library, ArrowDownUp, Undo2 } from 'lucide-react'
import { api } from '../api.ts'
import { keys, useAction, useDashboard, useGoals, useResources, useTasks, useTimerView } from '../hooks.ts'
import { openDetails, setUi, type WindowId } from '../ui-store.ts'
import { Button, Confirm, Empty, IconButton, toast, toastError } from '../ui.tsx'
import { GoalRow, TaskRow } from '../items/ItemRows.tsx'
import { useReorder } from '../items/useReorder.ts'
import { undoCompletion } from '../items/undoCompletion.ts'
import { openResource } from '../resources/resources.tsx'
import { DayGroup } from '../items/Sessions.tsx'
import { ResourceBrowser, ResourceRowTitle, resourceMeta, type FolderFilter } from '../resources/ResourceBrowser.tsx'
import { FloatingWindow } from './FloatingWindow.tsx'
import { SpacesWindow } from '../wiki/SpacesWindow.tsx'
import { formatDuration } from '../../../shared/day.ts'
import type { Completion, Dashboard, ItemType, Task } from '../../../shared/types.ts'

type DeskRef = React.RefObject<HTMLDivElement | null>

const GAP = 16
const col = (i: number) => (d: DOMRect) => {
  const w = Math.max(280, (d.width - GAP * 4) / 3)
  return { x: GAP + i * (w + GAP), y: GAP, w, h: Math.max(320, d.height - GAP * 2) }
}
const centered = (w: number, h: number, offset = 0) => (d: DOMRect) => ({
  x: Math.max(GAP, (d.width - w) / 2 + offset), y: Math.max(GAP, (d.height - h) / 2 + offset / 2), w, h: Math.min(h, d.height - GAP * 2),
})

function Loading() {
  return <p className="muted pad">Loading…</p>
}

// ---------- dashboard ----------

export function GoalsWindow({ deskRef }: { deskRef: DeskRef }) {
  const { data } = useDashboard()
  const qc = useQueryClient()
  // Drag to reorder: show the new order at once, then save it (and put it back if saving fails).
  const { rowProps } = useReorder(data?.goals ?? [], (ordered) => {
    const before = qc.getQueryData<Dashboard>(keys.dashboard)
    qc.setQueryData<Dashboard>(keys.dashboard, (d) => d && { ...d, goals: ordered })
    api.reorderGoals(ordered.map((g) => g.id)).then(
      () => qc.invalidateQueries({ queryKey: keys.goals }),
      (e) => {
        if (before) qc.setQueryData(keys.dashboard, before)
        toastError(e)
      },
    )
  })
  return (
    <FloatingWindow id="goals" title="Goals" icon={<Target size={17} />} meta={data ? data.goals.length : undefined}
      defaultRect={col(0)} deskRef={deskRef}
      actions={<IconButton label="New goal" onClick={() => setUi({ creating: 'goal' })}><Plus size={17} /></IconButton>}>
      {!data ? <Loading /> : data.goals.length === 0 ? (
        <Empty action={<Button size="sm" onClick={() => setUi({ creating: 'goal' })}><Plus size={14} /> New goal</Button>}>
          Nothing left for today. Add a long-running goal, like a book or a course.
        </Empty>
      ) : (
        <ul className="rows reorderable" aria-label="Today's goals. Drag to reorder, or Alt+arrow keys.">
          {data.goals.map((g) => <GoalRow key={g.id} goal={g} liProps={rowProps(g)} />)}
        </ul>
      )}
    </FloatingWindow>
  )
}

export function TasksWindow({ deskRef }: { deskRef: DeskRef }) {
  const { data } = useDashboard()
  const qc = useQueryClient()
  const tasks = data?.tasks ?? []
  // Tasks whose day has passed come first, then today's; the rest keep the order you put them in.
  const day = data?.today ?? ''
  const due = tasks.filter((t) => t.scheduledDay !== null && t.scheduledDay < day)
  const today = tasks.filter((t) => t.scheduledDay === day)
  const rest = tasks.filter((t) => t.scheduledDay === null || t.scheduledDay > day)

  const save = (ordered: Task[]) => {
    const before = qc.getQueryData<Dashboard>(keys.dashboard)
    const ids = ordered.map((t) => t.id)
    qc.setQueryData<Dashboard>(keys.dashboard, (d) => d && {
      ...d,
      tasks: [...d.tasks].sort((a, b) => (ids.indexOf(a.id) + 1 || 99) - (ids.indexOf(b.id) + 1 || 99)),
    })
    api.reorderTasks(ids).then(
      () => qc.invalidateQueries({ queryKey: keys.tasks }),
      (e) => {
        if (before) qc.setQueryData(keys.dashboard, before)
        toastError(e)
      },
    )
  }
  const dueRows = useReorder(due, save)
  const todayRows = useReorder(today, save)
  const restRows = useReorder(rest, save)

  return (
    <FloatingWindow id="tasks" title="Tasks" icon={<ListChecks size={17} />} meta={data ? tasks.length : undefined}
      defaultRect={col(1)} deskRef={deskRef}
      actions={<IconButton label="New task" onClick={() => setUi({ creating: 'task' })}><Plus size={17} /></IconButton>}>
      {!data ? <Loading /> : tasks.length === 0 ? (
        <Empty action={<Button size="sm" onClick={() => setUi({ creating: 'task' })}><Plus size={14} /> New task</Button>}>
          No tasks waiting. Add a one-off, like a call or an errand.
        </Empty>
      ) : (
        <>
          {due.length > 0 && (
            <>
              <h3 className="list-section">Due</h3>
              <ul className="rows reorderable" aria-label="Tasks past their day. Drag to reorder, or Alt+arrow keys.">
                {due.map((t) => <TaskRow key={t.id} task={t} liProps={dueRows.rowProps(t)} />)}
              </ul>
            </>
          )}
          {today.length > 0 && (
            <>
              <h3 className="list-section">Today</h3>
              <ul className="rows reorderable" aria-label="Tasks for today. Drag to reorder, or Alt+arrow keys.">
                {today.map((t) => <TaskRow key={t.id} task={t} liProps={todayRows.rowProps(t)} />)}
              </ul>
            </>
          )}
          {rest.length > 0 && (
            <>
              {due.length + today.length > 0 && <h3 className="list-section">Other tasks</h3>}
              <ul className="rows reorderable" aria-label="Other tasks. Drag to reorder, or Alt+arrow keys.">
                {rest.map((t) => <TaskRow key={t.id} task={t} liProps={restRows.rowProps(t)} />)}
              </ul>
            </>
          )}
        </>
      )}
    </FloatingWindow>
  )
}

function CompletionRow({ c, showDate }: { c: Completion; showDate?: boolean }) {
  const when = new Date(c.completedAt)
  const qc = useQueryClient()
  return (
    <li className="done-row">
      <button type="button" className="done-main" onClick={() => openDetails({ type: c.itemType, id: c.itemId })}>
        <span className={`type-mark type-${c.itemType}`} aria-label={c.itemType === 'goal' ? 'Goal' : 'Task'}>
          {c.itemType === 'goal' ? <Target size={14} /> : <ListChecks size={14} />}
        </span>
        <span className="done-text">
          <span className="done-title">{c.itemTitle}</span>
          {c.comment && <span className="done-comment">{c.comment}</span>}
        </span>
        <span className="done-figures">
          <span>{formatDuration(c.seconds)}</span>
          {c.points != null && <span className="points">+{c.points} pts</span>}
          <time dateTime={when.toISOString()}>
            {showDate ? when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : when.toLocaleTimeString(undefined, { timeStyle: 'short' })}
          </time>
        </span>
      </button>
      <IconButton className="done-undo"
        label={c.itemType === 'goal' ? `Put “${c.itemTitle}” back on today's list` : `Reopen “${c.itemTitle}”`}
        onClick={() => undoCompletion(qc, c.id)}><Undo2 size={15} /></IconButton>
    </li>
  )
}

export function CompletedWindow({ deskRef }: { deskRef: DeskRef }) {
  const { data } = useDashboard()
  const view = useTimerView()
  const total = (data?.todaySeconds ?? 0) + (view?.workSeconds ?? 0)
  return (
    <FloatingWindow id="completed" title="Completed today" icon={<CircleCheckBig size={17} />}
      defaultRect={col(2)} deskRef={deskRef}>
      <div className="today-total">
        <span className="today-figure">{formatDuration(total)}</span>
        <span className="today-caption">worked today{view ? ', including the running timer' : ''}</span>
      </div>
      {!data ? <Loading /> : data.completions.length === 0 ? (
        <Empty>Finished goals and tasks show up here with their time and points.</Empty>
      ) : (
        <ul className="rows">{data.completions.map((c) => <CompletionRow key={c.id} c={c} />)}</ul>
      )}
    </FloatingWindow>
  )
}

// ---------- manage ----------

function useDeleteItem() {
  const [target, setTarget] = useState<{ type: ItemType; id: number; title: string } | null>(null)
  const del = useAction(
    () => api.deleteItem(target!.type, target!.id),
    () => {
      toast(`Deleted “${target!.title}”`)
      setTarget(null)
    },
  )
  const dialog = (
    <Confirm open={!!target} onClose={() => setTarget(null)} onConfirm={() => del.mutate(undefined, { onError: toastError })}
      title={`Delete “${target?.title}”?`} confirmLabel={`Delete ${target?.type ?? ''}`} pending={del.isPending}>
      <p>Its comments and bookmarks are deleted. Work already logged stays in your history.</p>
    </Confirm>
  )
  return { ask: setTarget, dialog }
}

export function ManageGoalsWindow({ deskRef }: { deskRef: DeskRef }) {
  const { data } = useGoals()
  const [showArchived, setShowArchived] = useState(false)
  const { ask, dialog } = useDeleteItem()
  const list = (data ?? []).filter((g) => showArchived || !g.archivedAt)
  const archivedCount = (data ?? []).filter((g) => g.archivedAt).length
  return (
    <FloatingWindow id="manage-goals" title="All goals" icon={<Target size={17} />} closable meta={data?.length}
      defaultRect={centered(560, 600, -40)} deskRef={deskRef} className="window-manage"
      actions={<Button size="sm" variant="primary" onClick={() => setUi({ creating: 'goal' })}><Plus size={14} /> New goal</Button>}>
      {archivedCount > 0 && (
        <label className="toggle-line">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show {archivedCount} archived
        </label>
      )}
      {!data ? <Loading /> : list.length === 0 ? (
        <Empty action={<Button size="sm" onClick={() => setUi({ creating: 'goal' })}><Plus size={14} /> New goal</Button>}>You have no goals yet.</Empty>
      ) : (
        <ul className="rows">
          {list.map((g) => <GoalRow key={g.id} goal={g} showState onDelete={() => ask({ type: 'goal', id: g.id, title: g.title })} />)}
        </ul>
      )}
      {dialog}
    </FloatingWindow>
  )
}

export function ManageTasksWindow({ deskRef }: { deskRef: DeskRef }) {
  const { data } = useTasks()
  const [showDone, setShowDone] = useState(false)
  const { ask, dialog } = useDeleteItem()
  const doneCount = (data ?? []).filter((t) => t.completedAt).length
  const list = (data ?? []).filter((t) => showDone || !t.completedAt)
  return (
    <FloatingWindow id="manage-tasks" title="All tasks" icon={<ListChecks size={17} />} closable meta={data?.length}
      defaultRect={centered(560, 600, 0)} deskRef={deskRef} className="window-manage"
      actions={<Button size="sm" variant="primary" onClick={() => setUi({ creating: 'task' })}><Plus size={14} /> New task</Button>}>
      {doneCount > 0 && (
        <label className="toggle-line">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          Show {doneCount} completed
        </label>
      )}
      {!data ? <Loading /> : list.length === 0 ? (
        <Empty action={<Button size="sm" onClick={() => setUi({ creating: 'task' })}><Plus size={14} /> New task</Button>}>No open tasks.</Empty>
      ) : (
        <ul className="rows">
          {list.map((t) => <TaskRow key={t.id} task={t} showState onDelete={() => ask({ type: 'task', id: t.id, title: t.title })} />)}
        </ul>
      )}
      {dialog}
    </FloatingWindow>
  )
}

export function ManageResourcesWindow({ deskRef }: { deskRef: DeskRef }) {
  const { data } = useResources()
  const [folder, setFolder] = useState<FolderFilter>('all')
  // New resources go into the folder you're looking at.
  const create = () => setUi({ resourceEditing: { id: null, folderId: typeof folder === 'number' ? folder : null } })
  return (
    <FloatingWindow id="manage-resources" title="Resources" icon={<Library size={17} />} closable meta={data?.length}
      defaultRect={centered(720, 600, 40)} deskRef={deskRef} className="window-manage"
      actions={<Button size="sm" variant="primary" onClick={create}><Plus size={14} /> New resource</Button>}>
      <ResourceBrowser
        folder={folder}
        onFolderChange={setFolder}
        empty={<Empty action={<Button size="sm" onClick={create}><Plus size={14} /> New resource</Button>}>
          {folder === 'all' ? 'Keep books, videos and links here, then attach them to goals.' : 'Nothing here yet.'}
        </Empty>}
        row={(r, folderName) => (
          <li key={r.id} className="row">
            <div className="row-main" role="button" tabIndex={0} onClick={() => setUi({ resourceEditing: { id: r.id } })}
              onKeyDown={(e) => e.key === 'Enter' && setUi({ resourceEditing: { id: r.id } })}>
              <ResourceRowTitle r={r} />
              <span className="row-meta">{resourceMeta(r, folderName)}</span>
            </div>
            {(r.kind === 'pdf' || r.kind === 'link' || r.kind === 'video') && (
              <div className="row-actions">
                <Button size="sm" onClick={() => openResource(r)}>Open</Button>
              </div>
            )}
          </li>
        )}
      />
    </FloatingWindow>
  )
}

// ---------- history ----------

type Filter = 'all' | ItemType

function FilterBar({ value, onChange }: { value: Filter; onChange: (f: Filter) => void }) {
  return (
    <div className="segmented segmented-sm" role="radiogroup" aria-label="Show">
      {(['all', 'goal', 'task'] as const).map((f) => (
        <button key={f} type="button" role="radio" aria-checked={value === f} onClick={() => onChange(f)}>
          {f === 'all' ? 'All' : f === 'goal' ? 'Goals' : 'Tasks'}
        </button>
      ))}
    </div>
  )
}

function WorkLog() {
  const [filter, setFilter] = useState<Filter>('all')
  const q = useInfiniteQuery({
    queryKey: [...keys.history, 'work', filter],
    queryFn: ({ pageParam }) => api.workHistory(pageParam || undefined, filter === 'all' ? undefined : filter),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  })
  const days = q.data?.pages.flatMap((p) => p.days) ?? []
  return (
    <>
      <div className="history-tools"><FilterBar value={filter} onChange={setFilter} /></div>
      {q.isPending ? <Loading /> : days.length === 0 ? <Empty>No work logged yet. Start a timer on a goal or task.</Empty> : (
        <div className="log">
          {days.map((d) => <DayGroup key={d.day} d={d} showItem />)}
          {q.hasNextPage && <Button onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>Show earlier days</Button>}
        </div>
      )}
    </>
  )
}

function CompletionLog() {
  const [filter, setFilter] = useState<Filter>('all')
  const [order, setOrder] = useState<'desc' | 'asc'>('desc')
  const q = useInfiniteQuery({
    queryKey: [...keys.history, 'completions', filter, order],
    queryFn: ({ pageParam }) => api.completionHistory({ type: filter === 'all' ? undefined : filter, order, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
  })
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <>
      <div className="history-tools">
        <FilterBar value={filter} onChange={setFilter} />
        <Button size="sm" variant="ghost" onClick={() => setOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}>
          <ArrowDownUp size={14} /> {order === 'desc' ? 'Newest first' : 'Oldest first'}
        </Button>
      </div>
      {q.isPending ? <Loading /> : items.length === 0 ? <Empty>Nothing completed yet.</Empty> : (
        <>
          <ul className="rows">{items.map((c) => <CompletionRow key={c.id} c={c} showDate />)}</ul>
          {q.hasNextPage && <Button onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>Show more</Button>}
        </>
      )}
    </>
  )
}

export function HistoryWindow({ deskRef }: { deskRef: DeskRef }) {
  return (
    <FloatingWindow id="history" title="History" icon={<History size={17} />} closable
      defaultRect={centered(640, 640, 20)} deskRef={deskRef} className="window-manage">
      <Tabs.Root defaultValue="work" className="tabs">
        <Tabs.List className="tab-list" aria-label="History views">
          <Tabs.Trigger value="work" className="tab">Work log</Tabs.Trigger>
          <Tabs.Trigger value="completions" className="tab">Completions</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="work" className="tab-panel"><WorkLog /></Tabs.Content>
        <Tabs.Content value="completions" className="tab-panel"><CompletionLog /></Tabs.Content>
      </Tabs.Root>
    </FloatingWindow>
  )
}

export const OPTIONAL_WINDOWS: Partial<Record<WindowId, (p: { deskRef: DeskRef }) => React.ReactNode>> = {
  'manage-goals': ManageGoalsWindow,
  'manage-tasks': ManageTasksWindow,
  'manage-resources': ManageResourcesWindow,
  'manage-spaces': SpacesWindow,
  history: HistoryWindow,
}
