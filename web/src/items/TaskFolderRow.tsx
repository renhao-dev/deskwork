// A folder in the Tasks window: one row standing for several tasks. Click it to open it and see
// the tasks underneath; click again to close it.
import { useRef, type HTMLAttributes, type ReactNode } from 'react'
import { CalendarDays, ChevronRight, Folder, GripVertical, Pencil, Ungroup } from 'lucide-react'
import { IconButton } from '../ui.tsx'
import { sectionOfTask } from './taskLayout.ts'
import type { Task, TaskFolder } from '../../../shared/types.ts'

function NameInput({ title, onDone }: { title: string; onDone: (title: string | null) => void }) {
  // Escape leaves the name as it was; without this the blur that follows would save it anyway.
  const cancelled = useRef(false)
  return (
    <input
      className="folder-name-input" aria-label="Folder name" defaultValue={title} maxLength={200} autoFocus
      onFocus={(e) => e.target.select()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation() // Space and Enter are typing here, not "open the folder"
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          cancelled.current = true
          onDone(null)
        }
      }}
      onBlur={(e) => !cancelled.current && onDone(e.target.value.trim() || null)}
    />
  )
}

export function TaskFolderRow({
  folder, tasks, day, active, renaming, onStartRename, onRename, onToggle, onUngroup, headProps, children,
}: {
  folder: TaskFolder
  /** The folder's tasks on today's list. */
  tasks: Task[]
  day: string
  /** The timer is running on one of its tasks. */
  active: boolean
  renaming: boolean
  onStartRename: () => void
  /** The new name, or null when renaming was abandoned. */
  onRename: (title: string | null) => void
  onToggle: () => void
  onUngroup: () => void
  /** Makes the heading draggable and a place to drop tasks. */
  headProps: HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string | undefined>
  /** The rows of its tasks, shown while it is open. */
  children: ReactNode
}) {
  const open = !folder.collapsed
  const late = tasks.filter((t) => sectionOfTask(t, day) === 'due').length
  const today = tasks.filter((t) => sectionOfTask(t, day) === 'today').length
  return (
    <li className="task-folder" data-open={open}>
      <div className={`row folder-head${active ? ' is-active' : ''}`} {...headProps}>
        <span className="row-grip" aria-hidden><GripVertical size={14} /></span>
        <div
          className="row-main" role="button" tabIndex={0} aria-expanded={open}
          onClick={onToggle}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onToggle())}
        >
          <span className="row-title">
            <ChevronRight size={15} className="folder-twist" aria-hidden />
            <Folder size={15} className="folder-mark" aria-hidden />
            {renaming ? <NameInput title={folder.title} onDone={onRename} /> : folder.title}
          </span>
          <span className="row-meta">
            {tasks.length === 1 ? '1 task' : `${tasks.length} tasks`}
            {late > 0 && <span className="tag tag-late"><CalendarDays size={12} /> {late} late</span>}
            {today > 0 && <span className="tag tag-today"><CalendarDays size={12} /> {today} today</span>}
            {active && !open ? <span className="live-dot">In progress</span> : null}
          </span>
        </div>
        <div className="row-actions">
          <IconButton label={`Rename the folder “${folder.title}”`} onClick={onStartRename}><Pencil size={15} /></IconButton>
          <IconButton label={`Ungroup “${folder.title}”: remove the folder and keep its tasks`} onClick={onUngroup}><Ungroup size={15} /></IconButton>
        </div>
      </div>
      {open && <ul className="rows folder-rows" aria-label={`Tasks in ${folder.title}`}>{children}</ul>}
    </li>
  )
}
