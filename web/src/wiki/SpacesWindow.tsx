// Manage → Spaces: the containers your wiki pages live in. Every goal is given one when it's
// created and keeps it afterwards, so most of this list looks after itself — this is where you
// rename a space, give it an icon, or put away the ones you've finished with.
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, BookMarked, MoreHorizontal, Pencil, Plus, Target, Trash2 } from 'lucide-react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { api } from '../api.ts'
import { keys, useSpaces } from '../hooks.ts'
import { openDetails } from '../ui-store.ts'
import { Button, Confirm, Empty, IconButton, toast, toastError, usePortalContainer } from '../ui.tsx'
import { FloatingWindow } from '../desk/FloatingWindow.tsx'
import type { Space } from '../../../shared/types.ts'

const pages = (n: number) => (n === 1 ? '1 page' : `${n} pages`)

export function SpacesWindow({ deskRef }: { deskRef: React.RefObject<HTMLDivElement | null> }) {
  const qc = useQueryClient()
  const { data } = useSpaces()
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const [name, setName] = useState('')
  const [deleting, setDeleting] = useState<Space | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [showGoalSpaces, setShowGoalSpaces] = useState(false)

  const refresh = () => qc.invalidateQueries({ queryKey: keys.spaces })
  const all = data ?? []
  // Every goal is given a space, so most of this list is made for you. Yours come first.
  const goalCount = all.filter((s) => s.goalId && !s.archivedAt).length
  const archivedCount = all.filter((s) => s.archivedAt).length
  const list = all.filter((s) => (showArchived || !s.archivedAt) && (showGoalSpaces || !s.goalId))
  const onlyGoalSpaces = list.length === 0 && goalCount > 0

  const submit = async () => {
    const n = name.trim()
    if (!n) return setEditing(null)
    try {
      if (editing === 'new') await api.createSpace({ name: n })
      else if (editing != null) await api.updateSpace(editing, { name: n })
      refresh()
    } catch (e) {
      toastError(e)
    }
    setEditing(null)
  }

  const archive = async (s: Space) => {
    try {
      await api.updateSpace(s.id, { archived: !s.archivedAt })
      refresh()
    } catch (e) {
      toastError(e)
    }
  }

  const remove = async () => {
    if (!deleting) return
    try {
      await api.deleteSpace(deleting.id)
      refresh()
      toast(`Deleted “${deleting.name}”`)
      setDeleting(null)
    } catch (e) {
      toastError(e)
    }
  }

  const nameInput = (
    <form className="folder-form" onSubmit={(e) => (e.preventDefault(), submit())}>
      <input autoFocus value={name} maxLength={100} aria-label="Space name" placeholder="Space name"
        onChange={(e) => setName(e.target.value)} onBlur={submit}
        onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setEditing(null))} />
    </form>
  )

  return (
    <FloatingWindow id="manage-spaces" title="Spaces" icon={<BookMarked size={17} />} closable meta={data?.length}
      deskRef={deskRef} className="window-manage"
      defaultRect={(d) => ({ x: Math.max(16, (d.width - 520) / 2 + 40), y: 70, w: 520, h: Math.min(600, d.height - 100) })}
      actions={<Button size="sm" variant="primary" onClick={() => { setEditing('new'); setName('') }}><Plus size={14} /> New space</Button>}>
      <div className="window-filters">
        {goalCount > 0 && (
          <label className="toggle-line">
            <input type="checkbox" checked={showGoalSpaces} onChange={(e) => setShowGoalSpaces(e.target.checked)} />
            Show {goalCount} goal {goalCount === 1 ? 'space' : 'spaces'}
          </label>
        )}
        {archivedCount > 0 && (
          <label className="toggle-line">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show {archivedCount} archived
          </label>
        )}
      </div>
      {editing === 'new' && <div className="row"><div className="row-main">{nameInput}</div></div>}
      {!data ? null : list.length === 0 && editing !== 'new' ? (
        <Empty action={<Button size="sm" onClick={() => { setEditing('new'); setName('') }}><Plus size={14} /> New space</Button>}>
          {onlyGoalSpaces
            ? `Every space so far came with a goal. Tick “Show ${goalCount} goal spaces” to see them.`
            : 'No spaces yet. Each goal you create gets one.'}
        </Empty>
      ) : (
        <ul className="rows">
          {list.map((s) => (
            <li key={s.id} className={`row${s.archivedAt ? ' is-archived' : ''}`}>
              <div className="row-main">
                {editing === s.id ? nameInput : (
                  <span className="row-title">
                    {s.icon ? <span aria-hidden>{s.icon}</span> : s.goalId ? <Target size={14} className="space-mark" /> : null}
                    {s.name}
                  </span>
                )}
                <div className="row-meta">
                  <span>{pages(s.pageCount)}</span>
                  {s.goalId && <span className="tag">Goal space</span>}
                  {/* Only worth saying when the space has drifted from the goal's name. */}
                  {s.goalTitle && s.goalTitle !== s.name && <span>for “{s.goalTitle}”</span>}
                  {s.archivedAt && <span className="tag">Archived</span>}
                </div>
              </div>
              <Menu.Root>
                <Menu.Trigger asChild><IconButton label={`Actions for ${s.name}`}><MoreHorizontal size={16} /></IconButton></Menu.Trigger>
                <Menu.Portal container={usePortalContainer()}>
                  <Menu.Content className="menu" align="end" sideOffset={4}>
                    <Menu.Item className="menu-item" onSelect={() => { setEditing(s.id); setName(s.name) }}>
                      <Pencil size={15} /> Rename
                    </Menu.Item>
                    {s.goalId && (
                      <Menu.Item className="menu-item" onSelect={() => openDetails({ type: 'goal', id: s.goalId! })}>
                        <Target size={15} /> Open its goal
                      </Menu.Item>
                    )}
                    <Menu.Item className="menu-item" onSelect={() => archive(s)}>
                      {s.archivedAt ? <><ArchiveRestore size={15} /> Bring back</> : <><Archive size={15} /> Archive</>}
                    </Menu.Item>
                    <Menu.Item className="menu-item is-danger" onSelect={() => setDeleting(s)}>
                      <Trash2 size={15} /> Delete
                    </Menu.Item>
                  </Menu.Content>
                </Menu.Portal>
              </Menu.Root>
            </li>
          ))}
        </ul>
      )}
      <Confirm open={!!deleting} onClose={() => setDeleting(null)} onConfirm={remove}
        title={`Delete “${deleting?.name}”?`} confirmLabel="Delete space">
        {deleting?.pageCount
          ? <p>This space still holds {pages(deleting.pageCount)}. Move or delete them first — deleting a space never throws pages away.</p>
          : <p>The space is empty, so nothing is lost. Any goal pointing at it will be given a new one next time you write a note.</p>}
      </Confirm>
    </FloatingWindow>
  )
}
