// A small always-on-top window with the running timer, for when you're working in another app.
// Uses Chrome's document picture-in-picture, so it floats above other windows.
import { useEffect, useState } from 'react'
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { Check, Pause, PictureInPicture2, Play, Square } from 'lucide-react'
import { api } from '../api.ts'
import { useAction, useDashboard } from '../hooks.ts'
import { viewTimer } from '../../../shared/timer.ts'
import { openDetails, setUi } from '../ui-store.ts'
import { IconButton, PortalContainer, Toasts, toastError } from '../ui.tsx'
import { closePip, openPip, pipSupported, usePipKind } from './pip.ts'
import { formatClock } from '../../../shared/day.ts'

function MiniTimer({ main, win }: { main: Window; win: Window }) {
  // Tick from the floating window: it stays visible, while the main window's timers slow down
  // as soon as it's behind another app.
  const { data } = useDashboard()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = win.setInterval(() => setNow(Date.now()), 1000)
    return () => win.clearInterval(t)
  }, [win])
  const view = data?.timer ? viewTimer(data.timer, Math.max(now, Date.now())) : null
  const pause = useAction(() => api.pauseTimer())
  const resume = useAction(() => api.resumeTimer())
  const stop = useAction(() => api.stopTimer())
  const s = view?.state

  if (!view || !s) {
    return (
      <div className="mini mini-idle">
        <p>No timer running.</p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => main.focus()}>Open Deskwork</button>
      </div>
    )
  }

  const over = view.overBudgetSeconds != null
  const show = () => {
    openDetails({ type: s.itemType, id: s.itemId })
    main.focus()
  }
  return (
    <div className={`mini${view.onBreak ? ' is-break' : ''}${s.status === 'paused' ? ' is-paused' : ''}${over ? ' is-over' : ''}`}>
      <button type="button" className="mini-item" onClick={show} title="Open this goal in Deskwork">{s.itemTitle}</button>
      <div className="mini-clock">{over && !view.countsDown ? '+' : ''}{formatClock(view.clockSeconds)}</div>
      <div className="mini-phase">
        {s.status === 'paused' ? 'Paused' : view.phaseLabel}
        {over && s.mode === 'pomodoro' ? ` · +${formatClock(view.overBudgetSeconds!)} over` : ''}
      </div>
      <div className="mini-controls">
        {s.status === 'paused'
          ? <IconButton label="Resume" onClick={() => resume.mutate(undefined, { onError: toastError })}><Play size={18} /></IconButton>
          : <IconButton label="Pause" onClick={() => pause.mutate(undefined, { onError: toastError })}><Pause size={18} /></IconButton>}
        <IconButton label="Stop and log time" onClick={() => stop.mutate(undefined, { onError: toastError })}><Square size={16} /></IconButton>
        <IconButton label="Complete" className="timer-complete" onClick={() => {
          setUi({ completing: { type: s.itemType, id: s.itemId, via: 'timer' } })
          main.focus() // the completion form opens in the main window
        }}><Check size={19} /></IconButton>
      </div>
    </div>
  )
}

export function MiniTimerButton() {
  const qc = useQueryClient()
  const floating = usePipKind()
  if (!pipSupported()) return null
  const open = floating === 'timer'
  return (
    <IconButton label={open ? 'Close the floating timer' : 'Float the timer above other windows'}
      className={open ? 'is-on' : ''}
      onClick={() => {
        if (open) return closePip()
        openPip('timer', { width: 300, height: 190, title: 'Deskwork timer' }, (win, host) => (
          <QueryClientProvider client={qc}>
            <PortalContainer value={host}>
              <MiniTimer main={window} win={win} />
              <Toasts />
            </PortalContainer>
          </QueryClientProvider>
        )).catch(() => toastError(new Error('Could not open the floating timer')))
      }}>
      <PictureInPicture2 size={16} />
    </IconButton>
  )
}
