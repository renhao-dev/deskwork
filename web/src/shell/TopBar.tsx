import { useEffect, useRef, useState } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { useQueryClient } from '@tanstack/react-query'
import { AppWindow, Check, ChevronDown, CircleUser, Download, FolderKanban, History, LayoutGrid, BookMarked, BookOpen, Library, ListChecks, LogOut, Monitor, Moon, Pause, Play, Settings, Square, Sun, Target, Users, WifiOff } from 'lucide-react'
import { api, useServerOnline } from '../api.ts'
import { keys, useAction, useMe, useTimerView } from '../hooks.ts'
import { getUi, openDetails, openWindow, setUi } from '../ui-store.ts'
import { Button, IconButton, toast, toastError } from '../ui.tsx'
import { formatClock, formatDuration } from '../../../shared/day.ts'
import { applyTheme } from '../theme.ts'
import { installApp, useCanInstall } from '../pwa.ts'
import { installUpdate, useRelease } from '../updates.ts'
import { MiniTimerButton } from './MiniTimer.tsx'
import { notify } from '../notify.ts'
import type { Theme, User } from '../../../shared/types.ts'

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'Match system', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

function chime(times = 2) {
  try {
    const ctx = new AudioContext()
    for (let i = 0; i < times; i++) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = 880 - i * 220
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.28)
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + i * 0.28 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.28 + 0.5)
      o.connect(g).connect(ctx.destination)
      o.start(ctx.currentTime + i * 0.28)
      o.stop(ctx.currentTime + i * 0.28 + 0.55)
    }
    setTimeout(() => ctx.close(), 1500)
  } catch {}
}

function TimerBar() {
  const view = useTimerView()
  const s = view?.state
  const pause = useAction(() => api.pauseTimer())
  const resume = useAction(() => api.resumeTimer())
  const stop = useAction(() => api.stopTimer(), (r) => {
    if (r.session) toast(`Logged ${formatDuration(r.session.seconds)} on “${r.session.itemTitle}”`)
  })

  // Chime and notify on phase changes, and ask for the result once the budget runs out.
  const { data: me } = useMe()
  const notifySettings = me?.settings.notifications
  const lastPhase = useRef<string | null>(null)
  const prompted = useRef<string | null>(null)
  const seenRunning = useRef<string | null>(null)
  useEffect(() => {
    if (!s) {
      lastPhase.current = null
      return
    }
    const key = `${s.id}:${s.phase}:${s.round}`
    if (lastPhase.current && lastPhase.current !== key && lastPhase.current.startsWith(s.id)) {
      chime(s.phase === 'work' ? 1 : 2)
      if (notifySettings?.enabled && notifySettings.pomodoro) {
        if (s.phase === 'work') notify('Back to focus', `Focus round ${s.round + 1} on “${s.itemTitle}”.`, { tag: `deskwork-phase-${s.id}` })
        else notify(s.phase === 'long' ? 'Long break' : 'Break time',
          `${s.phase === 'long' ? s.pomodoro.long : s.pomodoro.short} minutes. “${s.itemTitle}” continues after.`, { tag: `deskwork-phase-${s.id}` })
      }
    }
    lastPhase.current = key
    if (s.status === 'running') seenRunning.current = s.id
    // Crossing the budget asks for the result once, but the timer keeps running as overtime.
    if (view?.overBudgetSeconds != null && prompted.current !== s.id) {
      prompted.current = s.id
      chime(3)
      // Only notify when it just happened, not when reopening the app long after.
      if (notifySettings?.enabled && seenRunning.current === s.id) {
        notify('Time budget crossed!', `Today's time for “${s.itemTitle}” is used up. The timer keeps going until you complete it.`,
          { tag: `deskwork-budget-${s.id}`, sticky: true })
      }
      if (!getUi().completing) setUi({ completing: { type: s.itemType, id: s.itemId, via: 'timer' } })
    }
  }, [s?.id, s?.phase, s?.round, s?.status, view?.overBudgetSeconds != null])

  useEffect(() => {
    document.title = view ? `${formatClock(view.clockSeconds)} ${view.state.itemTitle}` : 'Deskwork'
  }, [view?.clockSeconds, view?.state.itemTitle])

  if (!view || !s) {
    return (
      <div className="timer timer-idle">
        <span className="timer-idle-text">Nothing running. Press Start on a goal or task.</span>
      </div>
    )
  }

  const busy = pause.isPending || resume.isPending || stop.isPending
  const over = view.overBudgetSeconds != null
  return (
    <div className={`timer${view.onBreak ? ' is-break' : ''}${s.status === 'paused' ? ' is-paused' : ''}${over ? ' is-over' : ''}`}>
      <button type="button" className="timer-item" onClick={() => openDetails({ type: s.itemType, id: s.itemId })}
        title="Open details">
        {s.itemType === 'goal' ? <Target size={15} aria-label="Goal" /> : <ListChecks size={15} aria-label="Task" />}
        <span>{s.itemTitle}</span>
      </button>
      <span className="timer-phase">
        {s.status === 'paused' ? 'Paused' : view.phaseLabel}
        {over && s.mode === 'pomodoro' && <span className="timer-over">+{formatClock(view.overBudgetSeconds!)} over</span>}
      </span>
      <span className="timer-clock" aria-live="off">{over && !view.countsDown ? '+' : ''}{formatClock(view.clockSeconds)}</span>
      <div className="timer-controls">
        <MiniTimerButton />
        {(s.status === 'paused'
          ? <IconButton label="Resume" onClick={() => resume.mutate(undefined, { onError: toastError })} disabled={busy}><Play size={17} /></IconButton>
          : <IconButton label="Pause" onClick={() => pause.mutate(undefined, { onError: toastError })} disabled={busy}><Pause size={17} /></IconButton>)}
        <IconButton label="Stop and log time" onClick={() => stop.mutate(undefined, { onError: toastError })} disabled={busy}><Square size={15} /></IconButton>
        <IconButton label="Complete" className="timer-complete"
          onClick={() => setUi({ completing: { type: s.itemType, id: s.itemId, via: 'timer' } })}><Check size={18} /></IconButton>
      </div>
    </div>
  )
}

/** Shows up when a newer Deskwork is out and this copy can install it. Click = update. */
function UpdateButton() {
  const { data } = useRelease()
  const [busy, setBusy] = useState(false)
  if (!data?.latest || !data.canUpdate) return null
  const update = () => {
    setBusy(true)
    // On success the page reloads into the new version, so only a failure comes back here.
    installUpdate(data.version).catch((e) => {
      setBusy(false)
      toastError(e)
    })
  }
  return (
    <Button variant="brass" size="sm" className="update-btn" disabled={busy} onClick={update}
      title={`Deskwork ${data.latest.version} is out (this is ${data.version}). Updating restarts Deskwork, so you sign in again afterwards.`}>
      <Download size={15} /> {busy ? 'Updating…' : 'Update'}
    </Button>
  )
}

export function TopBar() {
  const { data: me } = useMe()
  // A window that goes full screen on a narrow display has to start below this bar, and the bar
  // grows taller as it wraps — so its height is measured rather than assumed.
  const bar = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = bar.current
    if (!el) return
    const set = () => document.documentElement.style.setProperty('--topbar-h', `${Math.round(el.getBoundingClientRect().height)}px`)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const online = useServerOnline()
  const canInstall = useCanInstall()
  const qc = useQueryClient()
  const setTheme = (theme: Theme) => {
    // Switch right away; the account setting catches up in the background.
    applyTheme(theme)
    qc.setQueryData<User>(keys.me, (u) => u && { ...u, settings: { ...u.settings, theme } })
    api.saveSettings({ theme }).then((u) => qc.setQueryData(keys.me, u), toastError)
  }
  const logout = async () => {
    await api.logout().catch(() => {})
    qc.clear()
    location.reload()
  }
  return (
    <header className="topbar" ref={bar}>
      <div className="brand" aria-label="Deskwork">
        <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden>
          <circle cx="16" cy="17" r="10" fill="none" stroke="currentColor" strokeWidth="3" />
          <path d="M16 17V11.5M13 4h6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <span>Deskwork</span>
      </div>

      <nav className="topnav" aria-label="Main">
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button variant="ghost" className="nav-btn"><FolderKanban size={17} /> Manage <ChevronDown size={14} /></Button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content className="menu" sideOffset={6} align="start">
              <Menu.Item className="menu-item" onSelect={() => openWindow('manage-goals')}><Target size={15} /> Goals</Menu.Item>
              <Menu.Item className="menu-item" onSelect={() => openWindow('manage-tasks')}><ListChecks size={15} /> Tasks</Menu.Item>
              <Menu.Item className="menu-item" onSelect={() => openWindow('manage-resources')}><Library size={15} /> Resources</Menu.Item>
              <Menu.Item className="menu-item" onSelect={() => openWindow('manage-spaces')}><BookMarked size={15} /> Spaces</Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
        <Button variant="ghost" className="nav-btn" onClick={() => openWindow('wiki')}><BookOpen size={17} /> Wiki</Button>
        <Button variant="ghost" className="nav-btn" onClick={() => openWindow('history')}><History size={17} /> History</Button>
      </nav>

      <TimerBar />

      <div className="topbar-end">
        {!online && (
          <span className="offline" role="status" title="Your data is safe. The app reconnects on its own.">
            <WifiOff size={15} /> Server offline, reconnecting…
          </span>
        )}
        <UpdateButton />
        {canInstall && (
          <Button variant="brass" size="sm" className="install-btn" title="Gives Deskwork its own window, Dock icon and Cmd+Tab entry"
            onClick={() => installApp().catch(toastError)}>
            <AppWindow size={15} /> Install app
          </Button>
        )}
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button variant="ghost" className="nav-btn user-btn"><CircleUser size={18} /> <span className="user-name">{me?.username}</span></Button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content className="menu" sideOffset={6} align="end">
              <Menu.Item className="menu-item" onSelect={() => setUi({ dialog: 'settings' })}><Settings size={15} /> Settings</Menu.Item>
              <Menu.Item className="menu-item" onSelect={() => {
                // An escape hatch: puts every window back where it started.
                api.tidyWindows().then(() => location.reload(), toastError)
              }}><LayoutGrid size={15} /> Tidy windows</Menu.Item>
              {me?.isAdmin && <Menu.Item className="menu-item" onSelect={() => setUi({ dialog: 'users' })}><Users size={15} /> Users</Menu.Item>}
              <Menu.Separator className="menu-sep" />
              <Menu.Label className="menu-label">Theme</Menu.Label>
              <Menu.RadioGroup value={me?.settings.theme ?? 'system'} onValueChange={(v) => setTheme(v as Theme)}>
                {THEMES.map(({ value, label, icon: Icon }) => (
                  <Menu.RadioItem key={value} value={value} className="menu-item" onSelect={(e) => e.preventDefault()}>
                    <Icon size={15} /> {label}
                    <Menu.ItemIndicator className="menu-check"><Check size={15} /></Menu.ItemIndicator>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
              <Menu.Separator className="menu-sep" />
              <Menu.Item className="menu-item" onSelect={logout}><LogOut size={15} /> Sign out</Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      </div>
    </header>
  )
}
