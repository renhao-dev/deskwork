import { useEffect, useMemo, useState } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import * as Tabs from '@radix-ui/react-tabs'
import {
  Archive, ArchiveRestore, Clock, ExternalLink, ListChecks, MoreHorizontal, Paperclip, Pencil, Play, Plus, RotateCcw, Target,
  Trash2, X,
} from 'lucide-react'
import { api } from '../api.ts'
import { useQueryClient } from '@tanstack/react-query'
import { useAction, useDetail, useRefreshAll } from '../hooks.ts'
import { closeDetails, openDetails, seekPlayer, setUi, useUi, type ItemRef } from '../ui-store.ts'
import { Button, Confirm, Dialog, DurationInput, Empty, ErrorText, Explained, Field, IconButton, ProgressBar, toast, toastError } from '../ui.tsx'
import { KIND_LABEL, KindIcon, bookmarkLabel, openResource, parseYouTube, playsInApp } from '../resources/resources.tsx'
import { PositionEditor } from '../resources/PositionEditor.tsx'
import { ResourceBrowser, ResourceRowTitle, resourceMeta, type FolderFilter } from '../resources/ResourceBrowser.tsx'
import { useStartBlock } from './ItemRows.tsx'
import { CompleteCheck } from './CompleteCheck.tsx'
import { ItemSessions } from './Sessions.tsx'
import { NotesTab, useNotes } from '../notes/NotesTab.tsx'
import { FloatingWindow } from '../desk/FloatingWindow.tsx'
import { formatClock, formatDuration } from '../../../shared/day.ts'
import type { AttachedResource, Goal, ItemType, Resource, Task } from '../../../shared/types.ts'

interface Draft {
  title: string
  description: string
  budgetMinutes: number
  pointsTarget: string
  pointsDone: string
  scheduledDay: string
}

const emptyDraft: Draft = { title: '', description: '', budgetMinutes: 60, pointsTarget: '', pointsDone: '0', scheduledDay: '' }

function draftFrom(type: ItemType, item: Goal | Task): Draft {
  if (type === 'goal') {
    const g = item as Goal
    return { ...emptyDraft, title: g.title, description: g.description, budgetMinutes: g.budgetMinutes, pointsTarget: g.pointsTarget?.toString() ?? '', pointsDone: String(g.pointsDone) }
  }
  const t = item as Task
  return { ...emptyDraft, title: t.title, description: t.description, scheduledDay: t.scheduledDay ?? '' }
}

function ItemFields({ type, draft, set, isNew }: { type: ItemType; draft: Draft; set: (p: Partial<Draft>) => void; isNew: boolean }) {
  return (
    <>
      <Field label="Title">
        <input value={draft.title} onChange={(e) => set({ title: e.target.value })} autoFocus={isNew}
          placeholder={type === 'goal' ? 'Learn Rust' : 'Renew passport'} />
      </Field>
      <Field label="Description">
        <textarea rows={3} value={draft.description} onChange={(e) => set({ description: e.target.value })} />
      </Field>
      {type === 'goal' ? (
        <div className="field-row">
          <Field label="Daily time budget">
            <DurationInput minutes={draft.budgetMinutes} onChange={(m) => set({ budgetMinutes: m })} />
          </Field>
          <Field label="Points target" hint="Optional. Chapters, lessons, pages…" className="field-narrow">
            <input type="number" min={1} value={draft.pointsTarget} onChange={(e) => set({ pointsTarget: e.target.value })} placeholder="None" />
          </Field>
          {!isNew && draft.pointsTarget && (
            <Field label="Points done" className="field-narrow">
              <input type="number" min={0} value={draft.pointsDone} onChange={(e) => set({ pointsDone: e.target.value })} />
            </Field>
          )}
        </div>
      ) : (
        <Field label="Scheduled for" hint="Optional. The task shows up on the dashboard from this day on.">
          <input type="date" value={draft.scheduledDay} onChange={(e) => set({ scheduledDay: e.target.value })} />
        </Field>
      )}
    </>
  )
}

function payload(type: ItemType, d: Draft) {
  if (type === 'goal') {
    return {
      title: d.title, description: d.description, budgetMinutes: d.budgetMinutes,
      pointsTarget: d.pointsTarget.trim() ? Number(d.pointsTarget) : null,
      ...(d.pointsTarget.trim() ? { pointsDone: Number(d.pointsDone) || 0 } : {}),
    }
  }
  return { title: d.title, description: d.description, scheduledDay: d.scheduledDay || null }
}

export function CreateDialog() {
  const creating = useUi((s) => s.creating)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  useEffect(() => {
    if (creating) {
      setDraft(emptyDraft)
      create.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creating])
  const create = useAction(
    (): Promise<Goal | Task> => (creating === 'goal' ? api.createGoal(payload('goal', draft)) : api.createTask(payload('task', draft))),
    (item) => {
      toast(`Created “${item.title}”`)
      setUi({ creating: null })
      openDetails({ type: creating!, id: item.id })
    },
  )
  return (
    <Dialog
      open={!!creating}
      onClose={() => setUi({ creating: null })}
      title={creating === 'goal' ? 'New goal' : 'New task'}
      footer={<>
        <Button variant="ghost" onClick={() => setUi({ creating: null })}>Cancel</Button>
        <Button variant="primary" onClick={() => create.mutate(undefined)} disabled={create.isPending}>
          {creating === 'goal' ? 'Create goal' : 'Create task'}
        </Button>
      </>}
    >
      {creating && (
        <form onSubmit={(e) => (e.preventDefault(), create.mutate(undefined))}>
          <ItemFields type={creating} draft={draft} set={(p) => setDraft((d) => ({ ...d, ...p }))} isNew />
          <button type="submit" hidden />
        </form>
      )}
      <ErrorText error={create.error} />
    </Dialog>
  )
}

/**
 * A goal or task in its own desk window, with Overview, Sessions and Comments tabs.
 * One at a time: opening another replaces it.
 */
export function ItemWindow({ deskRef }: { deskRef: React.RefObject<HTMLDivElement | null> }) {
  const ref = useUi((s) => s.details)
  const qc = useQueryClient()
  const detail = useDetail(ref?.type ?? 'goal', ref?.id ?? 0, !!ref)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [tab, setTab] = useState('overview')
  const item = detail.data?.item
  const type = ref?.type ?? 'goal'

  useEffect(() => {
    if (item && ref) setDraft(draftFrom(ref.type, item))
    // Reset the form only when another item opens or the saved item changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref?.type, ref?.id, item?.updatedAt])

  const original = useMemo(() => (item && ref ? draftFrom(ref.type, item) : null), [item, ref])
  const dirty = !!original && JSON.stringify(original) !== JSON.stringify(draft)

  const save = useAction(
    (): Promise<Goal | Task> => (type === 'goal' ? api.updateGoal(ref!.id, payload('goal', draft)) : api.updateTask(ref!.id, payload('task', draft))),
    () => toast('Saved changes'),
  )
  const archive = useAction(
    (archived: boolean) => api.updateGoal(ref!.id, { archived }),
    (g) => toast(g.archivedAt ? `Archived “${g.title}”` : `Restored “${g.title}”`),
  )
  const reopen = useAction(() => api.updateTask(ref!.id, { reopen: true }), (t) => toast(`Reopened “${t.title}”`))
  const del = useAction(
    () => api.deleteItem(type, ref!.id),
    () => {
      toast(`Deleted “${item?.title}”`)
      setConfirmDelete(false)
      closeDetails()
    },
  )

  useEffect(() => {
    save.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref])

  const goal = type === 'goal' ? (item as Goal | undefined) : undefined
  const task = type === 'task' ? (item as Task | undefined) : undefined
  const { reason: startBlocked } = useStartBlock(type, ref?.id ?? 0,
    goal?.archivedAt ? 'This goal is archived' : goal?.completedToday ? 'Done for today. It comes back tomorrow.'
      : task?.completedAt ? 'This task is completed' : null)
  const done = !!goal?.completedToday || !!task?.completedAt
  const completeBlocked = goal?.archivedAt && !done ? 'This goal is archived' : null

  const noteCount = useNotes(ref ?? { type: 'goal', id: 0 }, false, !!ref).data?.length ?? 0
  if (!ref) return null
  const comments = detail.data?.comments ?? []

  return (
    <FloatingWindow
      id="item"
      title={item?.title ?? (detail.isError ? 'Not found' : 'Loading…')}
      icon={type === 'goal' ? <Target size={17} /> : <ListChecks size={17} />}
      meta={type === 'goal' ? 'Goal' : 'Task'}
      closable
      onClose={closeDetails}
      deskRef={deskRef}
      className="window-item"
      defaultRect={(d) => {
        const w = Math.min(860, d.width - 32)
        return { x: Math.max(16, (d.width - w) / 2), y: 16, w, h: Math.max(420, d.height - 32) }
      }}
    >
      {detail.isError && <div className="pad"><ErrorText error={detail.error} /></div>}
      {item && (
        <>
          <div className="item-head">
            <div className="item-stats">
              {goal?.pointsTarget != null && <ProgressBar done={goal.pointsDone} target={goal.pointsTarget} />}
              <p>
                {goal && <>{formatDuration(goal.todaySeconds)} of {formatDuration(goal.budgetMinutes * 60)} today{goal.completedToday ? ', done for today' : ''}{goal.archivedAt ? '. Archived' : ''}</>}
                {task && <>{task.totalSeconds > 0 ? `${formatDuration(task.totalSeconds)} spent` : 'No time logged yet'}{task.completedAt ? `. Completed ${new Date(task.completedAt).toLocaleDateString()}` : ''}</>}
              </p>
            </div>
            <div className="item-actions">
              <Explained reason={startBlocked}>
                <Button variant="brass" disabled={!!startBlocked} onClick={() => setUi({ starting: ref })}><Play size={15} /> Start</Button>
              </Explained>
              <CompleteCheck refItem={ref} done={done} blocked={completeBlocked} big
                label={goal ? 'Complete for today' : 'Complete'} />
              <Menu.Root>
                <Menu.Trigger asChild>
                  <IconButton label="More actions"><MoreHorizontal size={17} /></IconButton>
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Content className="menu" align="end" sideOffset={4}>
                    {goal && (goal.archivedAt
                      ? <Menu.Item className="menu-item" onSelect={() => archive.mutate(false, { onError: toastError })}><ArchiveRestore size={15} /> Restore</Menu.Item>
                      : <Menu.Item className="menu-item" onSelect={() => archive.mutate(true, { onError: toastError })}><Archive size={15} /> Archive</Menu.Item>)}
                    {task?.completedAt && <Menu.Item className="menu-item" onSelect={() => reopen.mutate(undefined, { onError: toastError })}><RotateCcw size={15} /> Reopen</Menu.Item>}
                    <Menu.Separator className="menu-sep" />
                    <Menu.Item className="menu-item" onSelect={() => setConfirmDelete(true)}><Trash2 size={15} /> Delete {type}</Menu.Item>
                  </Menu.Content>
                </Menu.Portal>
              </Menu.Root>
            </div>
          </div>

          <Tabs.Root value={tab} onValueChange={setTab} className="tabs item-tabs">
            <Tabs.List className="tab-list" aria-label={`${item.title} sections`}>
              <Tabs.Trigger value="overview" className="tab">Overview</Tabs.Trigger>
              <Tabs.Trigger value="sessions" className="tab">Sessions</Tabs.Trigger>
              <Tabs.Trigger value="notes" className="tab">Notes{noteCount ? ` (${noteCount})` : ''}</Tabs.Trigger>
              <Tabs.Trigger value="comments" className="tab">Comments{comments.length ? ` (${comments.length})` : ''}</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="overview" className="tab-panel item-panel">
              <form className="item-form" onSubmit={(e) => (e.preventDefault(), dirty && save.mutate(undefined))}>
                <ItemFields type={type} draft={draft} set={(p) => setDraft((d) => ({ ...d, ...p }))} isNew={false} />
                <ErrorText error={save.error} />
                <div className="item-form-actions">
                  <Button variant="primary" type="submit" disabled={!dirty || save.isPending}>Save changes</Button>
                  {dirty && <Button variant="ghost" onClick={() => original && setDraft(original)}>Discard</Button>}
                </div>
              </form>
              <ResourcesSection refItem={ref} resources={detail.data!.resources} />
            </Tabs.Content>
            <Tabs.Content value="sessions" className="tab-panel item-panel">
              <ItemSessions refItem={ref} />
            </Tabs.Content>
            <Tabs.Content value="notes" className="tab-panel item-panel">
              <NotesTab refItem={ref} />
            </Tabs.Content>
            <Tabs.Content value="comments" className="tab-panel item-panel">
              <CommentsSection refItem={ref} comments={comments} />
            </Tabs.Content>
          </Tabs.Root>
        </>
      )}
      <Confirm open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={() => del.mutate(undefined, { onError: toastError })}
        title={`Delete “${item?.title}”?`} confirmLabel={`Delete ${type}`} pending={del.isPending}>
        <p>Its notes, comments and resource bookmarks are deleted. Work already logged stays in your history.</p>
      </Confirm>
    </FloatingWindow>
  )
}

function ResourcesSection({ refItem, resources }: { refItem: ItemRef; resources: AttachedResource[] }) {
  const detach = useAction((rid: number) => api.detach(refItem.type, refItem.id, rid))

  return (
    <section className="details-section">
      <header className="section-head">
        <h3>Resources</h3>
        <Button size="sm" variant="ghost" onClick={() => setUi({ attaching: refItem })}><Paperclip size={14} /> Attach</Button>
      </header>
      {resources.length === 0 ? (
        <p className="muted">Attach a book, video or link to keep your place in it.</p>
      ) : (
        <ul className="resource-list">
          {resources.map((r) => (
            <ResourceItem key={r.id} r={r} refItem={refItem} onDetach={() => detach.mutate(r.id, { onError: toastError })} />
          ))}
        </ul>
      )}
    </section>
  )
}

function ResourceItem({ r, refItem, onDetach }: { r: AttachedResource; refItem: ItemRef; onDetach: () => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const isVideo = r.kind === 'video'
  const hasPosition = r.kind === 'pdf' || r.kind === 'physical' || isVideo
  const refresh = useRefreshAll()
  const saveStart = async (p: { seconds: number; videoIndex: number | null }) => {
    await api.saveBookmark(refItem.type, refItem.id, { resourceId: r.id, seconds: p.seconds, videoIndex: p.videoIndex, manual: true })
    seekPlayer(refItem, r.id, p.seconds, p.videoIndex) // an open player jumps right away
    refresh()
    setEditing(false)
    toast(`“${r.title}” will start at ${formatClock(p.seconds)}`)
  }
  const saveMark = useAction((v: string) => {
    const page = Number(v)
    if (!Number.isInteger(page) || page < 0) throw new Error('Page must be a whole number')
    return api.saveBookmark(refItem.type, refItem.id, { resourceId: r.id, page, manual: true })
  }, () => setEditing(false))
  const label = bookmarkLabel(r)
  const openLabel = r.kind === 'pdf' ? (r.bookmark.page ? `Open at page ${r.bookmark.page}` : 'Open book')
    : isVideo ? (playsInApp(r) ? 'Play' : 'Open video')
    : r.kind === 'link' ? 'Open link' : 'View'

  return (
    <li className="resource-item">
      <span className="resource-kind" title={KIND_LABEL[r.kind]}><KindIcon kind={r.kind} size={18} /></span>
      <div className="resource-text">
        <span className="resource-title">{r.title}</span>
        <span className="resource-sub">
          {[KIND_LABEL[r.kind], r.author].filter(Boolean).join(', ')}
          {label ? <span className="bookmark">{label}</span> : null}
        </span>
        {editing && isVideo && (
          <PositionEditor seconds={r.bookmark.seconds} videoIndex={r.bookmark.videoIndex} onSave={saveStart}
            playlist={r.videoSource === 'youtube' && !!parseYouTube(r.url)?.listId} onCancel={() => setEditing(false)} />
        )}
        {editing && !isVideo && (
          <form className="inline-form" onSubmit={(e) => (e.preventDefault(), saveMark.mutate(value))}>
            <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="Page"
              aria-label="Page you're on" inputMode="numeric" />
            <Button size="sm" variant="primary" type="submit">Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            <ErrorText error={saveMark.error} />
          </form>
        )}
      </div>
      <div className="resource-actions">
        <Button size="sm" variant="secondary" onClick={() => {
          openResource(r, refItem)
        }}>
          {isVideo && playsInApp(r) ? <Play size={14} /> : <ExternalLink size={14} />} {openLabel}
        </Button>
        {hasPosition && !editing && (
          <Button size="sm" variant="ghost" title={isVideo ? 'Choose where the video starts, e.g. if you watched some already' : 'Set the page you are on'}
            onClick={() => {
              setValue(r.bookmark.page?.toString() ?? '')
              setEditing(true)
            }}>
            {isVideo ? <><Clock size={14} /> Set start</> : <><Pencil size={14} /> Set page</>}
          </Button>
        )}
        <IconButton label="Detach" onClick={onDetach}><X size={16} /></IconButton>
      </div>
    </li>
  )
}

function CommentsSection({ refItem, comments }: { refItem: ItemRef; comments: { id: number; body: string; createdAt: number }[] }) {
  const [text, setText] = useState('')
  const add = useAction(() => api.addComment(refItem.type, refItem.id, text), () => setText(''))
  const del = useAction((id: number) => api.deleteComment(id))
  return (
    <aside className="details-section comments">
      <h3>Comments</h3>
      <form onSubmit={(e) => (e.preventDefault(), add.mutate(undefined))} className="comment-form">
        <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note for yourself"
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && add.mutate(undefined)} aria-label="New comment" />
        <Button size="sm" variant="secondary" type="submit" disabled={!text.trim() || add.isPending}>Add comment</Button>
        <ErrorText error={add.error} />
      </form>
      {comments.length === 0 ? (
        <Empty>No comments yet.</Empty>
      ) : (
        <ul className="comment-list">
          {comments.map((c) => (
            <li key={c.id}>
              <time dateTime={new Date(c.createdAt).toISOString()}>{new Date(c.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time>
              <p>{c.body}</p>
              <IconButton label="Delete comment" className="comment-del" onClick={() => del.mutate(c.id, { onError: toastError })}><Trash2 size={14} /></IconButton>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}

/** Pick a resource to attach, with the same search and folders as the Resources window. */
export function AttachDialog() {
  const ref = useUi((s) => s.attaching)
  const detail = useDetail(ref?.type ?? 'goal', ref?.id ?? 0, !!ref)
  const [folder, setFolder] = useState<FolderFilter>('all')
  const attached = new Set((detail.data?.resources ?? []).map((r) => r.id))
  const attach = useAction(
    (r: Resource) => api.attach(ref!.type, ref!.id, r.id).then(() => r),
    (r) => {
      toast(`Attached “${r.title}”`)
      setUi({ attaching: null })
    },
  )
  const close = () => setUi({ attaching: null })
  return (
    <Dialog open={!!ref} onClose={close} wide title={detail.data ? `Attach to “${detail.data.item.title}”` : 'Attach a resource'}
      footer={<>
        <Button variant="secondary" className="push-left" onClick={() => {
          setUi({ attaching: null, resourceEditing: { id: null, attachTo: ref!, folderId: typeof folder === 'number' ? folder : null } })
        }}><Plus size={15} /> New resource</Button>
        <Button variant="ghost" onClick={close}>Cancel</Button>
      </>}>
      <ResourceBrowser
        folder={folder}
        onFolderChange={setFolder}
        row={(r, folderName) => {
          const isAttached = attached.has(r.id)
          return (
            <li key={r.id} className={`row${isAttached ? ' is-done' : ''}`}>
              <button type="button" className="row-main row-pick" disabled={isAttached || attach.isPending}
                onClick={() => attach.mutate(r, { onError: toastError })}>
                <ResourceRowTitle r={r} />
                <span className="row-meta">{resourceMeta(r, folderName)}{isAttached ? <span className="tag tag-ok">Attached</span> : null}</span>
              </button>
            </li>
          )
        }}
      />
    </Dialog>
  )
}
