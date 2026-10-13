import { Suspense, lazy, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import * as RTooltip from '@radix-ui/react-tooltip'
import { api, ApiError, onReconnect } from './api.ts'
import { keys, useMe } from './hooks.ts'
import { openDetails, useUi } from './ui-store.ts'
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
import { WikiWindow } from './wiki/WikiWindow.tsx'
import { isWikiPath } from './wiki/route.ts'
import { listenForChanges } from './wiki/sync.ts'

// /wiki is the wiki on its own, full screen, in its own window.
const WikiApp = lazy(() => import('./wiki/WikiApp.tsx').then((m) => ({ default: m.WikiApp })))

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
        if (id === 'wiki') return <WikiWindow key={id} deskRef={deskRef} />
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

  // /?open=goal:7 — how the wiki's own window asks the desk to show something it can't.
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get('open')
    const m = /^(goal|task):(\d+)$/.exec(asked ?? '')
    if (!m) return
    openDetails({ type: m[1] as 'goal' | 'task', id: Number(m[2]) })
    window.history.replaceState(null, '', window.location.pathname)
  }, [])

  // Keep up with edits made in the wiki's own window.
  useEffect(() => listenForChanges(qc), [qc])

  if (me.isPending) return <div className="boot" aria-busy="true" />
  if (me.error) {
    if (me.error instanceof ApiError && me.error.status === 401) return <><Login /><Toasts /></>
    return (
      <main className="login">
        <div className="login-card">
          <h1 className="dialog-title">Can't reach the server</h1>
          <p>{me.error.message}</p>
          <p className="login-hint">It starts by itself when you log in. To start it now, run <code>brew services start deskwork</code> in Terminal. This page reconnects on its own.</p>
        </div>
        <Retry onRetry={() => me.refetch()} />
      </main>
    )
  }

  if (isWikiPath()) return <Suspense fallback={<div className="boot" aria-busy="true" />}><WikiApp /></Suspense>

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
