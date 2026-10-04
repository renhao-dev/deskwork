import { Suspense, lazy, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import * as RTooltip from '@radix-ui/react-tooltip'
import { api, ApiError, onReconnect } from './api.ts'
import { keys, useMe } from './hooks.ts'
import { useUi } from './ui-store.ts'
import { Toasts } from './ui.tsx'
import { applyTheme } from './theme.ts'
import { TopBar } from './shell/TopBar.tsx'
import { Login, SettingsDialog, UsersDialog } from './shell/Account.tsx'
import { CompletedWindow, GoalsWindow, OPTIONAL_WINDOWS, TasksWindow } from './desk/windows.tsx'
import { PlayerWindow } from './desk/PlayerWindow.tsx'
import { NotesWindow } from './notes/NotesWindow.tsx'

// The book reader carries the PDF engine, so it loads only when a book is opened.
const ReaderWindow = lazy(() => import('./reader/ReaderWindow.tsx').then((m) => ({ default: m.ReaderWindow })))
import { AttachDialog, CreateDialog, ItemWindow } from './items/DetailsDialog.tsx'
import { CompleteDialog, StartDialog } from './items/WorkDialogs.tsx'
import { ResourceDialog } from './resources/ResourceDialog.tsx'

function Desk() {
  const deskRef = useRef<HTMLDivElement>(null)
  const open = useUi((s) => s.open)
  return (
    <main className="desk" ref={deskRef}>
      <GoalsWindow deskRef={deskRef} />
      <TasksWindow deskRef={deskRef} />
      <CompletedWindow deskRef={deskRef} />
      <ItemWindow deskRef={deskRef} />
      {open.map((id) => {
        if (id === 'player') return <PlayerWindow key={id} deskRef={deskRef} />
        if (id === 'notes') return <NotesWindow key={id} deskRef={deskRef} />
        if (id === 'reader') return <Suspense key={id} fallback={null}><ReaderWindow deskRef={deskRef} /></Suspense>
        const W = OPTIONAL_WINDOWS[id]
        return W ? <W key={id} deskRef={deskRef} /> : null
      })}
    </main>
  )
}

export function App() {
  const me = useMe()
  const qc = useQueryClient()

  // Day boundaries are computed on the server in your timezone, so keep it current.
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (me.data && tz && me.data.settings.timezone !== tz) {
      api.saveSettings({ timezone: tz }).then((u) => {
        qc.setQueryData(keys.me, u)
        qc.invalidateQueries({ queryKey: keys.dashboard })
      }, () => {})
    }
  }, [me.data, qc])

  const theme = me.data?.settings.theme
  useEffect(() => {
    if (theme) applyTheme(theme)
  }, [theme])

  useEffect(() => {
    const off = onReconnect(() => qc.invalidateQueries())
    return () => void off()
  }, [qc])

  if (me.isPending) return <div className="boot" aria-busy="true" />
  if (me.error) {
    if (me.error instanceof ApiError && me.error.status === 401) return <><Login /><Toasts /></>
    return (
      <main className="login">
        <div className="login-card">
          <h1 className="dialog-title">Can't reach the server</h1>
          <p>{me.error.message}</p>
          <p className="login-hint">It starts by itself when you log in. To start it now, run <code>scripts/start.sh</code> in the Deskwork project folder. This page reconnects on its own.</p>
        </div>
        <Retry onRetry={() => me.refetch()} />
      </main>
    )
  }

  return (
    <RTooltip.Provider delayDuration={150}>
      <div className="app">
        <TopBar />
        <Desk />
      </div>
      <StartDialog />
      <CompleteDialog />
      <CreateDialog />
      <AttachDialog />
      <ResourceDialog />
      <SettingsDialog />
      <UsersDialog />
      <Toasts />
    </RTooltip.Provider>
  )
}

function Retry({ onRetry }: { onRetry: () => void }) {
  useEffect(() => {
    const t = setInterval(onRetry, 3000)
    return () => clearInterval(t)
  }, [onRetry])
  return null
}
