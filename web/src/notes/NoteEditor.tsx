// A note: title plus a Markdown document edited with formatting shown as you type.
// Saves itself a moment after you stop typing. Until the server confirms, the latest text is kept
// in this browser too, so closing the window or losing the server never loses writing.
import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import * as Menu from '@radix-ui/react-dropdown-menu'
import {
  Bold, Code, Heading2, Heading3, ImagePlus, Italic, List, ListOrdered, ListTodo, MoreHorizontal, Quote, SquareCode, Strikethrough, Trash2,
} from 'lucide-react'
import { api, ApiError, onReconnect } from '../api.ts'
import { keys } from '../hooks.ts'
import { closeNoteTab, openDetails, openReader } from '../ui-store.ts'
import { Button, HostWindow, IconButton, toast, usePortalContainer } from '../ui.tsx'
import { trashNoteWithUndo } from './actions.ts'
import { parseDeskworkLink, registerNoteEditor } from './insert.ts'
import { setStatus, statuses, useNoteStatus, type SaveStatus } from './noteStatus.ts'
import type { Note } from '../../../shared/types.ts'

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: 'Saved',
  dirty: 'Editing…',
  saving: 'Saving…',
  offline: 'Server offline. Saved in this browser; it goes to the server when it’s back.',
  error: 'Not saved',
}

// ---------- local drafts ----------

interface Draft { title: string; body: string; at: number }
const draftKey = (id: number) => `deskwork.note-draft.${id}`
function readDraft(id: number): Draft | null {
  try {
    return JSON.parse(localStorage.getItem(draftKey(id)) ?? 'null')
  } catch {
    return null
  }
}
function writeDraft(id: number, d: Draft) {
  try {
    localStorage.setItem(draftKey(id), JSON.stringify(d))
  } catch {}
}
function clearDraft(id: number) {
  try {
    localStorage.removeItem(draftKey(id))
  } catch {}
}

// ---------- toolbar ----------

function Toolbar({ editor, onImage }: { editor: Editor; onImage: () => void }) {
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h2: e.isActive('heading', { level: 2 }), h3: e.isActive('heading', { level: 3 }), bold: e.isActive('bold'),
      italic: e.isActive('italic'), strike: e.isActive('strike'), code: e.isActive('code'), bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'), task: e.isActive('taskList'), quote: e.isActive('blockquote'), codeBlock: e.isActive('codeBlock'),
    }),
  })
  const b = (label: string, on: boolean, run: () => void, icon: React.ReactNode) => (
    <button type="button" className="tool" aria-label={label} title={label} aria-pressed={on}
      onMouseDown={(e) => e.preventDefault()} onClick={run}>{icon}</button>
  )
  const c = () => editor.chain().focus()
  return (
    <div className="note-toolbar" role="toolbar" aria-label="Formatting">
      {b('Heading', active.h2, () => c().toggleHeading({ level: 2 }).run(), <Heading2 size={17} />)}
      {b('Subheading', active.h3, () => c().toggleHeading({ level: 3 }).run(), <Heading3 size={17} />)}
      <span className="tool-sep" />
      {b('Bold (⌘B)', active.bold, () => c().toggleBold().run(), <Bold size={16} />)}
      {b('Italic (⌘I)', active.italic, () => c().toggleItalic().run(), <Italic size={16} />)}
      {b('Strikethrough', active.strike, () => c().toggleStrike().run(), <Strikethrough size={16} />)}
      {b('Inline code', active.code, () => c().toggleCode().run(), <Code size={16} />)}
      <span className="tool-sep" />
      {b('Bulleted list', active.bullet, () => c().toggleBulletList().run(), <List size={17} />)}
      {b('Numbered list', active.ordered, () => c().toggleOrderedList().run(), <ListOrdered size={17} />)}
      {b('Checklist', active.task, () => c().toggleTaskList().run(), <ListTodo size={17} />)}
      {b('Quote', active.quote, () => c().toggleBlockquote().run(), <Quote size={16} />)}
      {b('Code block', active.codeBlock, () => c().toggleCodeBlock().run(), <SquareCode size={17} />)}
      <span className="tool-sep" />
      {b('Add an image (or paste one)', false, onImage, <ImagePlus size={17} />)}
    </div>
  )
}

// ---------- editor ----------

function LoadedNote({ note }: { note: Note }) {
  const qc = useQueryClient()
  const id = note.id
  const draft = useRef(readDraft(id))
  const [title, setTitle] = useState(draft.current?.title ?? note.title)
  const [error, setError] = useState<string | null>(null)
  const status = useNoteStatus(id)
  const titleRef = useRef(title)
  const revision = useRef(0) // bumps on every change, so a save knows if more typing happened meanwhile
  const pendingUploads = useRef(0)
  const host = useContext(HostWindow) ?? window // timers must come from the window we're shown in
  const timer = useRef<number | undefined>(undefined) // window.setTimeout returns a number
  const editorRef = useRef<Editor | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const save = useCallback(async () => {
    const editor = editorRef.current
    if (!editor || editor.isDestroyed) return
    host.clearTimeout(timer.current)
    if (pendingUploads.current > 0) {
      // Don't save while an image is still a local placeholder.
      timer.current = host.setTimeout(save, 500)
      return
    }
    const rev = revision.current
    const body = editor.getMarkdown()
    setStatus(id, 'saving')
    try {
      const saved = await api.updateNote(id, { title: titleRef.current, body })
      qc.setQueryData(keys.note(id), saved)
      qc.invalidateQueries({ queryKey: ['notes', saved.itemType, saved.itemId] })
      if (revision.current === rev) {
        clearDraft(id)
        setStatus(id, 'saved')
      }
      setError(null)
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) setStatus(id, 'offline')
      else {
        setStatus(id, 'error')
        setError(e instanceof Error ? e.message : String(e))
      }
    }
  }, [id, qc, host])

  const changed = useCallback(() => {
    revision.current++
    const editor = editorRef.current
    if (editor) writeDraft(id, { title: titleRef.current, body: editor.getMarkdown(), at: Date.now() })
    setStatus(id, 'dirty')
    host.clearTimeout(timer.current)
    timer.current = host.setTimeout(save, 900)
  }, [id, save, host])

  // Images: show right away from memory, swap in the uploaded file when it's stored.
  const addImages = useCallback((files: File[], pos?: number) => {
    const editor = editorRef.current
    if (!editor) return
    for (const file of files) {
      const local = URL.createObjectURL(file)
      pendingUploads.current++
      const at = pos ?? editor.state.selection.to
      editor.chain().focus().insertContentAt(at, { type: 'image', attrs: { src: local, alt: 'Uploading…' } }).run()
      const update = (fn: (tr: import('@tiptap/pm/state').Transaction, pos: number, attrs: Record<string, unknown>) => void) => {
        const ed = editorRef.current
        if (!ed || ed.isDestroyed) return
        const tr = ed.state.tr
        const hits: { pos: number; attrs: Record<string, unknown> }[] = []
        ed.state.doc.descendants((node, p) => {
          if (node.type.name === 'image' && node.attrs.src === local) hits.push({ pos: p, attrs: node.attrs })
        })
        for (const h of hits.reverse()) fn(tr, h.pos, h.attrs)
        ed.view.dispatch(tr)
      }
      api.uploadNoteImage(file, file.name || 'screenshot.png')
        .then(({ url }) => update((tr, p, attrs) => tr.setNodeMarkup(p, undefined, { ...attrs, src: url, alt: '' })))
        .catch((e) => {
          update((tr, p) => tr.delete(p, p + 1))
          toast(`Couldn't add the image: ${e instanceof Error ? e.message : e}`, 'error')
        })
        .finally(() => {
          pendingUploads.current--
          URL.revokeObjectURL(local)
          changed()
        })
    }
  }, [changed])
  const addImagesRef = useRef(addImages)
  addImagesRef.current = addImages

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true, defaultProtocol: 'https', protocols: ['deskwork'] } }),
      Image.configure({ allowBase64: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Write here. Paste screenshots straight in; # for a heading, - for a list, [] for a checklist.' }),
      Markdown,
    ],
    content: draft.current?.body ?? note.body,
    contentType: 'markdown',
    onUpdate: () => changed(),
    editorProps: {
      attributes: { class: 'note-prose', 'aria-label': 'Note text' },
      handleDOMEvents: {
        // A page link put in by the reader opens that book at that page.
        click: (_view, event) => {
          const href = (event.target as HTMLElement).closest('a')?.getAttribute('href') ?? ''
          const link = parseDeskworkLink(href)
          if (!link) return false
          event.preventDefault()
          openReader({ type: note.itemType, id: note.itemId }, link.resourceId, link.page)
          return true
        },
      },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
        if (!files.length) return false
        addImagesRef.current(files)
        return true
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false
        const files = [...(event.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'))
        if (!files.length) return false
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        addImagesRef.current(files, pos)
        return true
      },
    },
  }, [id])
  editorRef.current = editor

  // Let the reader (and anything else) add text to the note that's open.
  useEffect(() => (editor ? registerNoteEditor(id, editor) : undefined), [id, editor])

  // A draft from last time (never confirmed by the server) goes up right away.
  useEffect(() => {
    if (draft.current) {
      setStatus(id, 'dirty')
      timer.current = host.setTimeout(save, 300)
    } else setStatus(id, 'saved')
  }, [id, save])

  // Retry when the server comes back, and every few seconds while offline or failing.
  useEffect(() => onReconnect(() => statuses.get(id) === 'offline' && save()), [id, save])
  useEffect(() => {
    if (status !== 'offline') return
    const t = host.setInterval(save, 5000)
    return () => host.clearInterval(t)
  }, [status, save, host])

  // Leaving the tab or closing the window: send what's pending (the draft covers a failed send).
  useEffect(() => () => {
    host.clearTimeout(timer.current)
    if (statuses.get(id) !== 'saved') void save()
  }, [id, save])

  const trash = () => trashNoteWithUndo(qc, { id, title: titleRef.current, itemType: note.itemType, itemId: note.itemId })

  return (
    <div className="note">
      <div className="note-head">
        <input className="note-title" value={title} placeholder="Untitled note" aria-label="Note title" maxLength={200}
          onChange={(e) => {
            setTitle(e.target.value)
            titleRef.current = e.target.value
            qc.setQueryData<Note>(keys.note(id), (n) => n && { ...n, title: e.target.value })
            changed()
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), editor?.commands.focus('start'))} />
        <div className="note-meta">
          <button type="button" className="note-item-link" onClick={() => openDetails({ type: note.itemType, id: note.itemId })}>
            {note.itemType === 'goal' ? 'Goal' : 'Task'}: {note.itemTitle}
          </button>
          <span className={`note-status is-${status}`} role="status" title={error ?? undefined}>
            {status === 'error' && error ? `Not saved: ${error}` : STATUS_TEXT[status]}
          </span>
          {status === 'error' && <Button size="sm" variant="ghost" onClick={() => save()}>Try again</Button>}
          <Menu.Root>
            <Menu.Trigger asChild>
              <IconButton label="Note actions"><MoreHorizontal size={16} /></IconButton>
            </Menu.Trigger>
            <Menu.Portal container={usePortalContainer()}>
              <Menu.Content className="menu" align="end" sideOffset={4}>
                <Menu.Item className="menu-item" onSelect={trash}><Trash2 size={15} /> Move to Trash</Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
        </div>
      </div>
      {editor && <Toolbar editor={editor} onImage={() => fileInput.current?.click()} />}
      <div className="note-scroll" onClick={(e) => e.target === e.currentTarget && editor?.commands.focus('end')}>
        <EditorContent editor={editor} />
      </div>
      <input ref={fileInput} type="file" accept="image/*" multiple hidden
        onChange={(e) => {
          addImages([...(e.target.files ?? [])])
          e.target.value = ''
        }} />
    </div>
  )
}

export function NoteEditor({ id }: { id: number }) {
  const q = useQuery({ queryKey: keys.note(id), queryFn: () => api.note(id), staleTime: Infinity, retry: 1 })
  if (q.isPending) return <p className="muted pad">Loading…</p>
  if (q.error) {
    const gone = q.error instanceof ApiError && q.error.status === 404
    return (
      <div className="pad note-missing">
        <p>{gone ? 'This note no longer exists. It may have been deleted with its goal.' : q.error.message}</p>
        <Button size="sm" onClick={() => closeNoteTab(id)}>Close tab</Button>
      </div>
    )
  }
  if (q.data.deletedAt) {
    return (
      <div className="pad note-missing">
        <p>“{q.data.title || 'Untitled note'}” is in the Trash.</p>
        <Button size="sm" onClick={() => closeNoteTab(id)}>Close tab</Button>
      </div>
    )
  }
  return <LoadedNote key={id} note={q.data} />
}
