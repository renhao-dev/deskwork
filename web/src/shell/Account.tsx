import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Trash2, UserPlus } from 'lucide-react'
import { api } from '../api.ts'
import { keys, useMe, useRefreshAll } from '../hooks.ts'
import { setUi, useUi } from '../ui-store.ts'
import { Button, Confirm, Dialog, ErrorText, Field, IconButton, toast, toastError } from '../ui.tsx'
import type { NotificationSettings, PomodoroSettings, User } from '../../../shared/types.ts'
import { ensureNotificationPermission, notificationPermission, notify } from '../notify.ts'

export function Login() {
  const qc = useQueryClient()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const login = useMutation({
    mutationFn: () => api.login(username, password),
    onSuccess: (u) => {
      qc.setQueryData(keys.me, u)
      qc.invalidateQueries()
    },
  })
  return (
    <main className="login">
      <form className="login-card" onSubmit={(e) => (e.preventDefault(), login.mutate())}>
        <div className="brand brand-lg">
          <svg viewBox="0 0 32 32" width="34" height="34" aria-hidden>
            <circle cx="16" cy="17" r="10" fill="none" stroke="currentColor" strokeWidth="3" />
            <path d="M16 17V11.5M13 4h6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <span>Deskwork</span>
        </div>
        <p className="login-lede">Your goals, tasks and hours, one desk.</p>
        <Field label="Username">
          <input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field label="Password">
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorText error={login.error} />
        <Button variant="primary" type="submit" disabled={login.isPending || !username}>Sign in</Button>
        <p className="login-hint">First time here? Sign in as admin / admin, then change the password in Settings.</p>
      </form>
    </main>
  )
}

export function SettingsDialog() {
  const open = useUi((s) => s.dialog === 'settings')
  const { data: me } = useMe()
  const qc = useQueryClient()
  const refresh = useRefreshAll()
  const [dayStart, setDayStart] = useState(4)
  const [pomo, setPomo] = useState<PomodoroSettings>({ work: 25, short: 5, long: 15, every: 4 })
  const [notif, setNotif] = useState<NotificationSettings>({ enabled: true, pomodoro: true })
  const [permission, setPermission] = useState(notificationPermission())
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')

  useEffect(() => {
    if (open && me) {
      setDayStart(me.settings.dayStartHour)
      setPomo(me.settings.pomodoro)
      setNotif(me.settings.notifications)
      setPermission(notificationPermission())
      setCurrent('')
      setNext('')
      save.reset()
      pw.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const save = useMutation({
    mutationFn: () => api.saveSettings({ dayStartHour: dayStart, pomodoro: pomo, notifications: notif }),
    onSuccess: (u) => {
      qc.setQueryData(keys.me, u)
      refresh()
      toast('Settings saved')
      setUi({ dialog: null })
    },
  })
  const pw = useMutation({
    mutationFn: () => api.changePassword(current, next),
    onSuccess: () => {
      toast('Password changed')
      setCurrent('')
      setNext('')
    },
  })

  const pomoField = (k: keyof PomodoroSettings, label: string) => (
    <Field label={label} className="field-narrow">
      <input type="number" min={1} max={240} value={pomo[k]} onChange={(e) => setPomo((p) => ({ ...p, [k]: Number(e.target.value) }))} />
    </Field>
  )

  return (
    <Dialog open={open} onClose={() => setUi({ dialog: null })} title="Settings"
      footer={<>
        <Button variant="ghost" onClick={() => setUi({ dialog: null })}>Cancel</Button>
        <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>Save settings</Button>
      </>}>
      <section className="settings-section">
        <h3>Your day</h3>
        <Field label="A new day starts at" hint="Work after midnight counts toward the previous day until this hour.">
          <select value={dayStart} onChange={(e) => setDayStart(Number(e.target.value))}>
            {Array.from({ length: 13 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
        </Field>
      </section>
      <section className="settings-section">
        <h3>Pomodoro</h3>
        <div className="field-row">
          {pomoField('work', 'Focus, min')}
          {pomoField('short', 'Break, min')}
          {pomoField('long', 'Long break, min')}
          {pomoField('every', 'Long break every')}
        </div>
        <p className="field-hint">Applies to timers you start from now on.</p>
      </section>
      <section className="settings-section">
        <h3>Notifications</h3>
        <label className="toggle-line">
          <input type="checkbox" checked={notif.enabled} onChange={(e) => {
            setNotif((n) => ({ ...n, enabled: e.target.checked }))
            if (e.target.checked) ensureNotificationPermission().then(() => setPermission(notificationPermission()), () => {})
          }} />
          Notify me when a goal's time budget is used up
        </label>
        <label className="toggle-line">
          <input type="checkbox" checked={notif.pomodoro} disabled={!notif.enabled}
            onChange={(e) => setNotif((n) => ({ ...n, pomodoro: e.target.checked }))} />
          Also when Pomodoro breaks start and end
        </label>
        {notif.enabled && (permission === 'denied' ? (
          <p className="field-hint notice">
            Notifications are blocked for Deskwork. Allow them in Chrome (the site settings for localhost) and in macOS
            System Settings → Notifications, then come back here.
          </p>
        ) : permission === 'unsupported' ? (
          <p className="field-hint">This browser can't show notifications.</p>
        ) : (
          <div className="inline-actions">
            <Button size="sm" onClick={async () => {
              setPermission(await ensureNotificationPermission())
              await notify('Deskwork notifications work', "You'll get one like this when a time budget is used up.", { tag: 'deskwork-test' })
            }}>Send a test notification</Button>
            <span className="field-hint">Deskwork needs to be open for these; minimized is fine.</span>
          </div>
        ))}
      </section>
      <ErrorText error={save.error} />
      <section className="settings-section">
        <h3>Password</h3>
        <form className="field-row" onSubmit={(e) => (e.preventDefault(), pw.mutate())}>
          <Field label="Current password"><input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
          <Field label="New password"><input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
          <Button type="submit" className="align-end" disabled={!current || !next || pw.isPending}>Change password</Button>
        </form>
        <ErrorText error={pw.error} />
      </section>
    </Dialog>
  )
}

export function UsersDialog() {
  const open = useUi((s) => s.dialog === 'users')
  const { data: me } = useMe()
  const qc = useQueryClient()
  const users = useQuery({ queryKey: keys.users, queryFn: api.users, enabled: open })
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [resetting, setResetting] = useState<User | null>(null)
  const [newPw, setNewPw] = useState('')
  const [deleting, setDeleting] = useState<User | null>(null)
  const invalidate = () => qc.invalidateQueries({ queryKey: keys.users })

  const create = useMutation({
    mutationFn: () => api.createUser(name, password, isAdmin),
    onSuccess: (u) => {
      toast(`Added ${u.username}`)
      setName('')
      setPassword('')
      setIsAdmin(false)
      invalidate()
    },
  })

  return (
    <>
      <Dialog open={open} onClose={() => setUi({ dialog: null })} title="Users" wide>
        <ul className="user-list">
          {users.data?.map((u) => (
            <li key={u.id}>
              <span className="user-list-name">{u.username}{u.id === me?.id ? ' (you)' : ''}</span>
              <label className="toggle-line">
                <input type="checkbox" checked={u.isAdmin} disabled={u.id === me?.id}
                  onChange={(e) => api.updateUser(u.id, { isAdmin: e.target.checked }).then(invalidate, toastError)} />
                Admin
              </label>
              <Button size="sm" variant="ghost" onClick={() => { setResetting(u); setNewPw('') }}><KeyRound size={14} /> Reset password</Button>
              {u.id !== me?.id && <IconButton label={`Delete ${u.username}`} className="danger-hover" onClick={() => setDeleting(u)}><Trash2 size={15} /></IconButton>}
            </li>
          ))}
        </ul>
        <form className="field-row add-user" onSubmit={(e) => (e.preventDefault(), create.mutate())}>
          <Field label="Username"><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></Field>
          <Field label="Password"><input type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" /></Field>
          <label className="toggle-line align-end"><input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} /> Admin</label>
          <Button type="submit" variant="primary" className="align-end" disabled={!name || !password || create.isPending}><UserPlus size={15} /> Add user</Button>
        </form>
        <ErrorText error={create.error} />
      </Dialog>

      <Dialog open={!!resetting} onClose={() => setResetting(null)} title={`New password for ${resetting?.username}`}
        footer={<>
          <Button variant="ghost" onClick={() => setResetting(null)}>Cancel</Button>
          <Button variant="primary" disabled={newPw.length < 4} onClick={() =>
            api.updateUser(resetting!.id, { password: newPw }).then(() => { toast('Password reset'); setResetting(null) }, toastError)
          }>Set password</Button>
        </>}>
        <Field label="New password" hint="They'll be signed out everywhere."><input value={newPw} onChange={(e) => setNewPw(e.target.value)} autoFocus /></Field>
      </Dialog>

      <Confirm open={!!deleting} onClose={() => setDeleting(null)} title={`Delete ${deleting?.username}?`} confirmLabel="Delete user"
        onConfirm={() => api.deleteUser(deleting!.id).then(() => { toast(`Deleted ${deleting!.username}`); setDeleting(null); invalidate() }, toastError)}>
        <p>All of their goals, tasks, resources and history are deleted. This can't be undone.</p>
      </Confirm>
    </>
  )
}
