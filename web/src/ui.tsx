import { createContext, useContext } from 'react'
import * as RDialog from '@radix-ui/react-dialog'
import * as RTooltip from '@radix-ui/react-tooltip'
import { X } from 'lucide-react'
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { useSyncExternalStore } from 'react'

/**
 * Where menus and dialogs should be rendered. Inside the floating window they must go into that
 * window's own document, or they'd pop up in the main window instead.
 */
export const PortalContainer = createContext<HTMLElement | null>(null)
export const usePortalContainer = () => useContext(PortalContainer) ?? undefined

/**
 * The window a component lives in. Timers belong to their own window, and Chrome slows down the
 * main window's timers while it's hidden — the floating window's keep their normal pace.
 */
export const HostWindow = createContext<Window | null>(null)
export const useHostWindow = (): Window => useContext(HostWindow) ?? window

// ---------- buttons ----------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'brass'

export function Button({
  variant = 'secondary', size, className = '', ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' }) {
  return <button type="button" className={`btn btn-${variant}${size ? ` btn-${size}` : ''} ${className}`} {...rest} />
}

export function IconButton({ label, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type="button" aria-label={label} title={label} className={`icon-btn ${className}`} {...rest} />
}

/**
 * Wraps a control that may be disabled and explains why on hover or click.
 * Disabled buttons swallow pointer events, so the span listens instead.
 */
export function Explained({ reason, children }: { reason: string | null; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  if (!reason) return <>{children}</>
  return (
    <RTooltip.Root open={open} onOpenChange={setOpen} delayDuration={150}>
      <RTooltip.Trigger asChild>
        <span
          className="explained"
          tabIndex={0}
          // preventDefault stops Radix from closing the tooltip it treats as clicked away.
          onPointerDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setOpen(true)
            clearTimeout(timer.current)
            timer.current = setTimeout(() => setOpen(false), 2200)
          }}
        >
          {children}
        </span>
      </RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content className="tooltip" sideOffset={6} collisionPadding={12}>
          {reason}
          <RTooltip.Arrow className="tooltip-arrow" />
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  )
}

// ---------- dialog ----------

export function Dialog({
  open, onClose, title, children, footer, wide, description,
}: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean; description?: string
}) {
  return (
    <RDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <RDialog.Portal container={usePortalContainer()}>
        <RDialog.Overlay className="dialog-overlay" />
        <RDialog.Content
          className={`dialog${wide ? ' dialog-wide' : ''}`}
          aria-describedby={undefined}
          // A dialog opened on top of this one must not close it.
          onInteractOutside={(e) => (e.target as Element | null)?.closest?.('.dialog, .menu, .tooltip, .toasts') && e.preventDefault()}
        >
          <header className="dialog-head">
            <RDialog.Title className="dialog-title">{title}</RDialog.Title>
            <RDialog.Close asChild>
              <IconButton label="Close"><X size={18} /></IconButton>
            </RDialog.Close>
          </header>
          {description && <RDialog.Description className="dialog-desc">{description}</RDialog.Description>}
          <div className="dialog-body">{children}</div>
          {footer && <footer className="dialog-foot">{footer}</footer>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}

// ---------- form bits ----------

export function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null
  return <p className="error-text" role="alert">{error instanceof Error ? error.message : String(error)}</p>
}

export function ProgressBar({ done, target, compact }: { done: number; target: number; compact?: boolean }) {
  const pct = Math.min(100, (done / Math.max(1, target)) * 100)
  return (
    <div className={`progress${compact ? ' progress-compact' : ''}`}>
      <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={target} aria-valuenow={done}>
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="progress-label">
        <strong>{done}</strong> / {target} pts
      </span>
    </div>
  )
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <p>{children}</p>
      {action}
    </div>
  )
}

/** Hours + minutes input backed by a minute count. */
export function DurationInput({ minutes, onChange }: { minutes: number; onChange: (m: number) => void }) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return (
    <div className="duration-input">
      <input type="number" min={0} max={24} value={h} aria-label="Hours"
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0) * 60 + m)} />
      <span>h</span>
      <input type="number" min={0} max={59} value={m} aria-label="Minutes"
        onChange={(e) => onChange(h * 60 + Math.min(59, Math.max(0, Number(e.target.value) || 0)))} />
      <span>min</span>
    </div>
  )
}

// ---------- toasts ----------

interface ToastAction { label: string; run: () => void }
let toasts: { id: number; text: string; tone: 'info' | 'error'; action?: ToastAction }[] = []
const toastListeners = new Set<() => void>()
let toastId = 0

export function toast(text: string, tone: 'info' | 'error' = 'info', action?: ToastAction) {
  const id = ++toastId
  toasts = [...toasts, { id, text, tone, action }]
  toastListeners.forEach((l) => l())
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id)
    toastListeners.forEach((l) => l())
  }, tone === 'error' || action ? 7000 : 3500)
}

export const toastError = (e: unknown) => toast(e instanceof Error ? e.message : String(e), 'error')

export function Toasts() {
  const list = useSyncExternalStore((l) => (toastListeners.add(l), () => toastListeners.delete(l)), () => toasts)
  return (
    <div className="toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          {t.text}
          {t.action && (
            <button type="button" className="toast-action" onClick={() => {
              t.action!.run()
              toasts = toasts.filter((x) => x.id !== t.id)
              toastListeners.forEach((l) => l())
            }}>{t.action.label}</button>
          )}
        </div>
      ))}
    </div>
  )
}

export function Confirm({
  open, onClose, onConfirm, title, children, confirmLabel, pending,
}: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; children: ReactNode; confirmLabel: string; pending?: boolean
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={onConfirm} disabled={pending}>{confirmLabel}</Button>
      </>}>
      {children}
    </Dialog>
  )
}
