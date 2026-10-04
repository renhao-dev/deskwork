import { Suspense, lazy } from 'react'
import { QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { NotebookPen, PictureInPicture2, X } from 'lucide-react'
import { api } from '../api.ts'
import { keys } from '../hooks.ts'
import { closeNoteTab, setUi, useUi } from '../ui-store.ts'
import { Button, Empty, HostWindow, IconButton, PortalContainer, Toasts, toastError } from '../ui.tsx'
import { closePip, openPip, pipSupported, usePipKind } from '../shell/pip.ts'
import { FloatingWindow } from '../desk/FloatingWindow.tsx'
import { useNoteStatus } from './noteStatus.ts'

// The editor is large; load it only when a note is opened.
const NoteEditor = lazy(() => import('./NoteEditor.tsx').then((m) => ({ default: m.NoteEditor })))

function NoteTab({ id, active }: { id: number; active: boolean }) {
  const { data } = useQuery({ queryKey: keys.note(id), queryFn: () => api.note(id), staleTime: Infinity, retry: 1 })
  const status = useNoteStatus(id)
  const title = data?.title || 'Untitled note'
  const unsaved = status !== 'saved'
  return (
    <div className={`note-tab${active ? ' is-active' : ''}`} role="presentation">
      <button type="button" role="tab" aria-selected={active} className="note-tab-btn" title={title}
        onClick={() => setUi({ noteActive: id })}
        onAuxClick={(e) => e.button === 1 && closeNoteTab(id)}>
        <span className="note-tab-title">{title}</span>
        {unsaved && <span className={`note-tab-dot is-${status}`} aria-label={status === 'offline' ? 'Not on the server yet' : 'Saving'} />}
      </button>
      <button type="button" className="note-tab-close" aria-label={`Close ${title}`} onClick={() => closeNoteTab(id)}><X size={13} /></button>
    </div>
  )
}

/** The tab strip and the open note: shown on the desk, or in the floating window. */
export function NotesPane() {
  const tabs = useUi((s) => s.noteTabs)
  const active = useUi((s) => s.noteActive)
  return (
    <>
      {tabs.length > 0 && (
        <div className="note-tabs" role="tablist" aria-label="Open notes">
          {tabs.map((id) => <NoteTab key={id} id={id} active={id === active} />)}
        </div>
      )}
      {active != null && tabs.includes(active) ? (
        <Suspense fallback={<p className="muted pad">Loading editor…</p>}><NoteEditor key={active} id={active} /></Suspense>
      ) : (
        <Empty>No notes open. Open or create one from a goal’s Notes tab.</Empty>
      )}
    </>
  )
}

/** Notes you're working on, one tab each. Opened from a goal's Notes tab. */
export function NotesWindow({ deskRef }: { deskRef: React.RefObject<HTMLDivElement | null> }) {
  const qc = useQueryClient()
  const tabs = useUi((s) => s.noteTabs)
  const floating = usePipKind() === 'notes'
  const float = () => {
    if (floating) return closePip()
    openPip('notes', { width: 520, height: 680, title: 'Deskwork notes' }, (win, host) => (
      <QueryClientProvider client={qc}>
        <HostWindow value={win}>
          <PortalContainer value={host}>
            <div className="pip-notes"><NotesPane /></div>
            <Toasts />
          </PortalContainer>
        </HostWindow>
      </QueryClientProvider>
    )).catch(() => toastError(new Error('Could not open the floating notes window')))
  }
  return (
    <FloatingWindow
      id="notes"
      title="Notes"
      icon={<NotebookPen size={17} />}
      meta={tabs.length > 1 ? tabs.length : undefined}
      closable
      deskRef={deskRef}
      className="window-notes"
      actions={pipSupported() ? (
        <IconButton label={floating ? 'Bring the notes back to the desk' : 'Float the notes above other windows'}
          className={floating ? 'is-on' : ''} onClick={float}><PictureInPicture2 size={16} /></IconButton>
      ) : undefined}
      defaultRect={(d) => {
        const w = Math.min(760, Math.max(420, d.width * 0.5))
        return { x: Math.max(16, d.width - w - 16), y: 16, w, h: Math.max(420, d.height - 32) }
      }}
    >
      {floating ? (
        <Empty action={<Button size="sm" onClick={float}>Bring back here</Button>}>
          Your notes are in the floating window, above your other windows.
        </Empty>
      ) : <NotesPane />}
    </FloatingWindow>
  )
}
