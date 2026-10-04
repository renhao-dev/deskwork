import { useEffect, useRef, useState, type ReactNode, type PointerEvent as RPointerEvent } from 'react'
import { Maximize2, Minimize2, X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../api.ts'
import { keys, useMe } from '../hooks.ts'
import { closeWindow, focusWindow, useUi, type WindowId } from '../ui-store.ts'
import { IconButton } from '../ui.tsx'
import type { User, WindowRect } from '../../../shared/types.ts'

const MIN_W = 260
const MIN_H = 180

export function useNarrow() {
  const q = '(max-width: 760px)'
  const [narrow, setNarrow] = useState(() => matchMedia(q).matches)
  useEffect(() => {
    const m = matchMedia(q)
    const on = () => setNarrow(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return narrow
}

function clamp(r: WindowRect, desk: DOMRect, whole = false): WindowRect {
  const w = Math.min(Math.max(MIN_W, r.w), Math.max(MIN_W, desk.width))
  const h = Math.min(Math.max(MIN_H, r.h), Math.max(MIN_H, desk.height))
  // `whole` keeps the entire window on the desk (when it opens); dragging only keeps the title bar.
  return {
    w, h,
    x: Math.min(Math.max(0, r.x), Math.max(0, desk.width - (whole ? w : 120))),
    y: Math.min(Math.max(0, r.y), Math.max(0, desk.height - (whole ? h : 48))),
  }
}

export function FloatingWindow({
  id, title, icon, meta, actions, children, closable, onClose, leading, defaultRect, deskRef, className = '',
}: {
  id: WindowId
  title: string
  icon?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  children: ReactNode
  closable?: boolean
  /** Replaces the default close behavior (hiding the window). */
  onClose?: () => void
  /** Shown before the icon, e.g. a back arrow. */
  leading?: ReactNode
  defaultRect: (desk: DOMRect) => WindowRect
  deskRef: React.RefObject<HTMLDivElement | null>
  className?: string
}) {
  const { data: me } = useMe()
  const qc = useQueryClient()
  const narrow = useNarrow()
  const z = useUi((s) => s.focusOrder.indexOf(id))
  const isFront = useUi((s) => s.focusOrder.at(-1) === id)
  const saved = me?.settings.layout[id]
  const [rect, setRect] = useState<WindowRect | null>(null)
  const drag = useRef<{ kind: 'move' | 'resize'; sx: number; sy: number; start: WindowRect } | null>(null)

  // Place the window once the desk has a size, and keep it on screen when the desk shrinks.
  useEffect(() => {
    const desk = deskRef.current
    if (!desk) return
    const place = () => {
      const box = desk.getBoundingClientRect()
      setRect((cur) => clamp(cur ?? saved ?? defaultRect(box), box, !cur))
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(desk)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deskRef])

  const persist = (r: WindowRect) => {
    qc.setQueryData<User>(keys.me, (u) => u && { ...u, settings: { ...u.settings, layout: { ...u.settings.layout, [id]: r } } })
    api.saveSettings({ layout: { [id]: r } }).catch(() => {})
  }

  const maximized = !!rect?.max
  const toggleMax = () => {
    if (!rect) return
    const next = { ...rect, max: !rect.max }
    setRect(next)
    persist(next)
  }

  const onPointerDown = (kind: 'move' | 'resize') => (e: RPointerEvent) => {
    if (e.button !== 0 || !rect || narrow || maximized) return
    if (kind === 'move' && (e.target as HTMLElement).closest('button, a, input, select')) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { kind, sx: e.clientX, sy: e.clientY, start: rect }
  }
  const onPointerMove = (e: RPointerEvent) => {
    const d = drag.current
    const desk = deskRef.current
    if (!d || !desk) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    const box = desk.getBoundingClientRect()
    setRect(clamp(
      d.kind === 'move' ? { ...d.start, x: d.start.x + dx, y: d.start.y + dy } : { ...d.start, w: d.start.w + dx, h: d.start.h + dy },
      box,
    ))
  }
  const onPointerUp = () => {
    if (drag.current && rect) persist(rect)
    drag.current = null
  }

  if (!rect && !narrow) return null
  const style = narrow || !rect ? undefined
    : maximized ? { left: 0, top: 0, width: '100%', height: '100%', zIndex: 10 + z }
    : { left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: 10 + z }

  return (
    <section
      className={`window${isFront ? ' is-front' : ''}${maximized ? ' is-max' : ''} ${className}`}
      style={style}
      aria-label={title}
      onPointerDownCapture={() => focusWindow(id)}
    >
      <header className="window-head" onPointerDown={onPointerDown('move')} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onDoubleClick={(e) => !narrow && !(e.target as HTMLElement).closest('button, a, input, select') && toggleMax()}>
        {leading}
        {icon && <span className="window-icon" aria-hidden>{icon}</span>}
        <h2 className="window-title">{title}</h2>
        {meta && <span className="window-meta">{meta}</span>}
        <div className="window-actions">
          {actions}
          {!narrow && (
            <IconButton label={maximized ? `Restore ${title}` : `Maximize ${title}`} onClick={toggleMax}>
              {maximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </IconButton>
          )}
          {closable && (
            <IconButton label={`Close ${title}`} onClick={() => (onClose ? onClose() : closeWindow(id))}><X size={16} /></IconButton>
          )}
        </div>
      </header>
      <div className="window-body">{children}</div>
      {!narrow && !maximized && (
        <div className="window-resize" aria-hidden onPointerDown={onPointerDown('resize')} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
      )}
    </section>
  )
}
