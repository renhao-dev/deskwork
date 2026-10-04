import { Fragment, cloneElement, isValidElement, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { useQueryClient } from '@tanstack/react-query'
import {
  ChevronRight, CornerUpLeft, Folder, FolderInput, FolderOpen, FolderPlus, Inbox, Library, MoreHorizontal, Pencil, Search, Trash2, X,
} from 'lucide-react'
import { api } from '../api.ts'
import { keys, useFolders, useResources } from '../hooks.ts'
import { Confirm, Empty, IconButton, toast, toastError } from '../ui.tsx'
import { KIND_LABEL, KindIcon, formatBytes } from './resources.tsx'
import type { Resource, ResourceFolder } from '../../../shared/types.ts'
import { buildFolderTree, type FolderTree } from '../../../shared/folders.ts'
import { useResourceDnd, type ResourceDnd } from './dnd.ts'

/** Which folder is shown: every resource, only those without a folder, or one folder. */
export type FolderFilter = 'all' | 'none' | number

// Case- and accent-insensitive, so "hebrew" finds "Hébreu" and "HEBREW".
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

export function matches(r: Resource, query: string) {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = fold(`${r.title} ${r.author}`)
  return words.every((w) => hay.includes(w))
}

// ---------- folder tree ----------

export type { FolderTree }

export function useFolderTree() {
  const { data: folders } = useFolders()
  return useMemo(() => buildFolderTree(folders ?? []), [folders])
}

// ---------- sidebar ----------

type Adding = { parentId: number | null } | null

function FolderList({
  tree, resources, value, onChange, searching, dnd,
}: {
  tree: FolderTree; resources: Resource[]; value: FolderFilter; onChange: (f: FolderFilter) => void; searching: boolean
  dnd: ResourceDnd
}) {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [adding, setAdding] = useState<Adding>(null)
  const [renaming, setRenaming] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [deleting, setDeleting] = useState<ResourceFolder | null>(null)
  const refresh = () => {
    qc.invalidateQueries({ queryKey: keys.folders })
    qc.invalidateQueries({ queryKey: keys.resources })
  }

  // Opening a folder also unfolds it in the tree, and everything above it, so its subfolders show.
  useEffect(() => {
    if (typeof value !== 'number') return
    const up = tree.lineage(value)
    if (up.some((id) => !expanded.has(id))) setExpanded((e) => new Set([...e, ...up]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, tree])

  // Counts include everything nested inside a folder.
  const counts = useMemo(() => {
    const direct = new Map<number | null, number>()
    for (const r of resources) direct.set(r.folderId, (direct.get(r.folderId) ?? 0) + 1)
    const total = new Map<number, number>()
    for (const { folder } of tree.ordered) {
      let n = 0
      for (const id of tree.subtree(folder.id)) n += direct.get(id) ?? 0
      total.set(folder.id, n)
    }
    return { unfiled: direct.get(null) ?? 0, total }
  }, [resources, tree])

  const toggle = (id: number) => setExpanded((e) => {
    const next = new Set(e)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const busy = useRef(false) // Enter and then blur both submit; only the first one counts
  const submit = async () => {
    const n = name.trim()
    if (!n) return (setAdding(null), setRenaming(null))
    if (busy.current) return
    busy.current = true
    try {
      if (renaming != null) await api.updateFolder(renaming, { name: n })
      else if (adding) onChange((await api.createFolder(n, adding.parentId)).id)
      setAdding(null)
      setRenaming(null)
      setName('')
      refresh()
    } catch (e) {
      toastError(e)
    } finally {
      busy.current = false
    }
  }

  const move = async (f: ResourceFolder, parentId: number | null) => {
    try {
      await api.updateFolder(f.id, { parentId })
      if (parentId != null) setExpanded((e) => new Set([...e, ...tree.lineage(parentId)]))
      toast(parentId == null ? `Moved “${f.name}” to the top level` : `Moved “${f.name}” into “${tree.byId.get(parentId)?.name}”`)
      refresh()
    } catch (e) {
      toastError(e)
    }
  }

  const remove = async () => {
    if (!deleting) return
    try {
      await api.deleteFolder(deleting.id)
      toast(`Deleted folder “${deleting.name}”`)
      if (typeof value === 'number' && tree.subtree(deleting.id).has(value)) onChange(deleting.parentId ?? 'all')
      setDeleting(null)
      refresh()
    } catch (e) {
      toastError(e)
    }
  }

  const startAdding = (parentId: number | null) => {
    setRenaming(null)
    setName('')
    setAdding({ parentId })
    if (parentId != null) setExpanded((e) => new Set([...e, parentId]))
  }

  const nameInput = (depth: number) => (
    <li style={{ '--depth': depth } as React.CSSProperties}>
      <form className="folder-form" onSubmit={(e) => (e.preventDefault(), submit())}>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Folder name" aria-label="Folder name"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              setAdding(null)
              setRenaming(null)
            }
          }}
          onBlur={submit} maxLength={80} />
      </form>
    </li>
  )

  // "All resources" is the root: folders dropped there go to the top level, resources lose their folder.
  const plain = (key: 'all' | 'none', label: string, icon: ReactNode, count: number) => (
    <li className="folder-item" style={{ '--depth': 0 } as React.CSSProperties}
      {...dnd.dropProps(`side-${key}`, null, key === 'none' ? { accepts: 'resource' } : {})}>
      <span className="folder-toggle" aria-hidden />
      <button type="button" className="folder-btn" aria-current={value === key && !searching ? 'true' : undefined} onClick={() => onChange(key)}>
        {icon}<span className="folder-name">{label}</span><span className="folder-count">{count}</span>
      </button>
    </li>
  )

  const node = (f: ResourceFolder, depth: number): ReactNode => {
    const kids = tree.children(f.id)
    const open = expanded.has(f.id)
    const current = value === f.id && !searching
    const blocked = tree.subtree(f.id) // can't move into itself or its own subfolders
    return (
      <Fragment key={f.id}>
        {renaming === f.id ? nameInput(depth) : (
          <li className="folder-item" style={{ '--depth': depth } as React.CSSProperties}
            {...dnd.dragProps({ kind: 'folder', id: f.id, parentId: f.parentId, title: f.name })}
            {...dnd.dropProps(`side-${f.id}`, f.id, {
              // Hovering a closed folder while dragging opens it, so you can drop deeper.
              onLinger: kids.length > 0 && !open ? () => setExpanded((e) => new Set([...e, f.id])) : undefined,
            })}>
            {kids.length > 0 ? (
              <button type="button" className={`folder-toggle${open ? ' is-open' : ''}`} aria-expanded={open}
                aria-label={`${open ? 'Collapse' : 'Expand'} ${f.name}`} onClick={() => toggle(f.id)}>
                <ChevronRight size={14} />
              </button>
            ) : <span className="folder-toggle" aria-hidden />}
            <button type="button" className="folder-btn" aria-current={current ? 'true' : undefined} onClick={() => onChange(f.id)}>
              {current ? <FolderOpen size={16} /> : <Folder size={16} />}
              <span className="folder-name" title={f.name}>{f.name}</span>
              <span className="folder-count">{counts.total.get(f.id) ?? 0}</span>
            </button>
            <Menu.Root>
              <Menu.Trigger asChild>
                <IconButton label={`Folder options for ${f.name}`} className="folder-more"><MoreHorizontal size={15} /></IconButton>
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Content className="menu" align="start" sideOffset={4}>
                  <Menu.Item className="menu-item" onSelect={() => startAdding(f.id)}><FolderPlus size={15} /> New subfolder</Menu.Item>
                  <Menu.Item className="menu-item" onSelect={() => { setAdding(null); setRenaming(f.id); setName(f.name) }}>
                    <Pencil size={15} /> Rename
                  </Menu.Item>
                  <Menu.Sub>
                    <Menu.SubTrigger className="menu-item"><FolderInput size={15} /> Move to <ChevronRight size={14} className="menu-sub-arrow" /></Menu.SubTrigger>
                    <Menu.Portal>
                      <Menu.SubContent className="menu menu-scroll" sideOffset={4}>
                        <Menu.Item className="menu-item" disabled={f.parentId == null} onSelect={() => move(f, null)}>
                          <CornerUpLeft size={15} /> Top level
                        </Menu.Item>
                        <Menu.Separator className="menu-sep" />
                        {tree.ordered.map(({ folder: t, depth: d }) => (
                          <Menu.Item key={t.id} className="menu-item" disabled={blocked.has(t.id) || t.id === f.parentId}
                            style={{ paddingLeft: 10 + d * 14 }} onSelect={() => move(f, t.id)}>
                            <Folder size={15} /> {t.name}
                          </Menu.Item>
                        ))}
                      </Menu.SubContent>
                    </Menu.Portal>
                  </Menu.Sub>
                  <Menu.Separator className="menu-sep" />
                  <Menu.Item className="menu-item" onSelect={() => setDeleting(f)}><Trash2 size={15} /> Delete folder</Menu.Item>
                </Menu.Content>
              </Menu.Portal>
            </Menu.Root>
          </li>
        )}
        {open && kids.map((k) => node(k, depth + 1))}
        {adding?.parentId === f.id && nameInput(depth + 1)}
      </Fragment>
    )
  }

  const deletingParent = deleting?.parentId != null ? tree.byId.get(deleting.parentId) : null
  const deletingCount = deleting ? counts.total.get(deleting.id) ?? 0 : 0
  const deletingKids = deleting ? tree.children(deleting.id).length : 0

  return (
    <nav className="folders" aria-label="Folders">
      <ul>
        {plain('all', 'All resources', <Library size={16} />, resources.length)}
        {plain('none', 'No folder', <Inbox size={16} />, counts.unfiled)}
        {tree.children(null).map((f) => node(f, 0))}
        {adding?.parentId === null ? nameInput(0) : (
          <li style={{ '--depth': 0 } as React.CSSProperties} className="folder-item">
            <span className="folder-toggle" aria-hidden />
            <button type="button" className="folder-btn folder-add" onClick={() => startAdding(null)}>
              <FolderPlus size={16} /> <span className="folder-name">New folder</span>
            </button>
          </li>
        )}
      </ul>
      <Confirm open={!!deleting} onClose={() => setDeleting(null)} onConfirm={remove}
        title={`Delete folder “${deleting?.name}”?`} confirmLabel="Delete folder">
        <p>
          Only the folder is deleted.{' '}
          {deletingKids + deletingCount === 0 ? 'It is empty.' : <>
            Its {deletingKids > 0 ? `${deletingKids} subfolder${deletingKids === 1 ? '' : 's'} and ` : ''}
            resources move up to {deletingParent ? `“${deletingParent.name}”` : 'the top level'}.
          </>}
        </p>
      </Confirm>
    </nav>
  )
}

// ---------- browser ----------

/**
 * Search and folders around a list of resources. A folder shows its subfolders first, then what's
 * directly inside it, like Finder. Searching looks in every folder.
 * `row` renders each resource, so the Resources window and the attach picker can differ.
 */
export function ResourceBrowser({
  row, folder, onFolderChange, empty,
}: {
  row: (r: Resource, folderPath: string | null) => ReactNode
  folder: FolderFilter
  onFolderChange: (f: FolderFilter) => void
  empty?: ReactNode
}) {
  const { data: resources } = useResources()
  const tree = useFolderTree()
  const dnd = useResourceDnd(tree)
  const [query, setQuery] = useState('')
  const searching = query.trim().length > 0
  const select = (f: FolderFilter) => {
    setQuery('')
    onFolderChange(f)
  }

  // A folder that was deleted elsewhere falls back to everything.
  useEffect(() => {
    if (typeof folder === 'number' && tree.byId.size && !tree.byId.has(folder)) onFolderChange('all')
  }, [folder, tree, onFolderChange])

  const shown = (resources ?? []).filter((r) =>
    searching ? matches(r, query) : folder === 'all' ? true : folder === 'none' ? r.folderId == null : r.folderId === folder)
  const subfolders = !searching && typeof folder === 'number' ? tree.children(folder) : []

  const countIn = (id: number) => {
    const ids = tree.subtree(id)
    return (resources ?? []).filter((r) => r.folderId != null && ids.has(r.folderId)).length
  }

  const heading = searching ? (
    <h3 className="res-list-title">Results for “{query.trim()}”<span className="muted"> in all folders</span></h3>
  ) : typeof folder === 'number' ? (
    <nav className="res-list-title crumbs" aria-label="Folder path">
      <button type="button" onClick={() => select('all')} {...dnd.dropProps('crumb-root', null)}>All resources</button>
      {tree.lineage(folder).map((id, i, all) => (
        <Fragment key={id}>
          <ChevronRight size={13} aria-hidden />
          {i === all.length - 1
            ? <span aria-current="page">{tree.byId.get(id)?.name}</span>
            : <button type="button" onClick={() => select(id)} {...dnd.dropProps(`crumb-${id}`, id)}>{tree.byId.get(id)?.name}</button>}
        </Fragment>
      ))}
    </nav>
  ) : (
    <h3 className="res-list-title">{folder === 'all' ? 'All resources' : 'No folder'}</h3>
  )

  return (
    <div className={`res-browser${dnd.dragging ? ' is-dragging' : ''}`}>
      <div className="res-search">
        <Search size={16} aria-hidden />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by title or author"
          aria-label="Search resources"
          onKeyDown={(e) => {
            // Escape clears the search first; only an empty search lets Escape close a dialog.
            if (e.key === 'Escape' && query) {
              e.stopPropagation()
              setQuery('')
            }
          }} />
        {searching && <IconButton label="Clear search" onClick={() => setQuery('')}><X size={15} /></IconButton>}
      </div>
      <div className="res-panes">
        <FolderList tree={tree} resources={resources ?? []} value={folder} searching={searching} onChange={select} dnd={dnd} />
        <section className="res-list" aria-label="Resources in this folder">
          {heading}
          {!resources ? <p className="muted pad">Loading…</p> : shown.length === 0 && subfolders.length === 0 ? (
            searching ? <Empty>Nothing matches “{query.trim()}”. Try fewer letters or another word.</Empty>
              : empty ?? <Empty>This folder is empty.</Empty>
          ) : (
            <ul className="rows">
              {subfolders.map((f) => (
                <li key={`f${f.id}`} className="row"
                  {...dnd.dragProps({ kind: 'folder', id: f.id, parentId: f.parentId, title: f.name })}
                  {...dnd.dropProps(`list-${f.id}`, f.id)}>
                  <button type="button" className="row-main row-pick" onClick={() => select(f.id)}>
                    <span className="row-title"><Folder size={16} className="subfolder-icon" /> {f.name}</span>
                    <span className="row-meta">Folder, {countIn(f.id)} resource{countIn(f.id) === 1 ? '' : 's'}</span>
                  </button>
                </li>
              ))}
              {shown.map((r) => {
                const el = row(r, searching && r.folderId != null ? tree.path(r.folderId) : null)
                // Every resource row can be dragged onto a folder.
                return isValidElement(el)
                  ? cloneElement(el, dnd.dragProps({ kind: 'resource', id: r.id, folderId: r.folderId, title: r.title }) as object)
                  : el
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

/** One-line description under a resource title. */
export function resourceMeta(r: Resource, folderPath: string | null) {
  return [
    KIND_LABEL[r.kind],
    r.author,
    r.fileSize ? formatBytes(r.fileSize) : '',
    r.kind === 'video' && r.videoSource === 'youtube' ? 'YouTube' : '',
    folderPath ? `in ${folderPath}` : '',
  ].filter(Boolean).join(', ')
}

export function ResourceRowTitle({ r }: { r: Resource }) {
  return <span className="row-title"><KindIcon kind={r.kind} /> {r.title}</span>
}
