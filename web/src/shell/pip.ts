// The floating window: a small always-on-top window (Chrome's document picture-in-picture).
// Chrome allows one per app, so the timer and the notes share it — opening one closes the other.
import { useSyncExternalStore, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { toast } from '../ui.tsx'

declare global {
  interface Window { documentPictureInPicture?: { requestWindow(o?: { width?: number; height?: number }): Promise<Window> } }
}

export type PipKind = 'timer' | 'notes'

let current: { kind: PipKind; win: Window; root: Root } | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

export const pipSupported = () => typeof window !== 'undefined' && !!window.documentPictureInPicture

/** Which window is floating right now, if any. */
export function usePipKind(): PipKind | null {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => current?.kind ?? null)
}

/** The floating window has its own document, so the app's styles and theme have to be copied in. */
function copyStyles(target: Window) {
  for (const sheet of Array.from(document.styleSheets)) {
    const node = sheet.ownerNode as HTMLElement | null
    if (!node) continue
    if (node instanceof HTMLLinkElement) {
      // The floating window has no address of its own, so the link needs the full URL.
      const link = target.document.createElement('link')
      link.rel = 'stylesheet'
      link.href = node.href
      target.document.head.appendChild(link)
    } else {
      target.document.head.appendChild(node.cloneNode(true))
    }
  }
  const theme = document.documentElement.dataset.theme
  if (theme) target.document.documentElement.dataset.theme = theme
  target.document.body.style.margin = '0'
}

export function closePip() {
  if (!current) return
  const { win, root } = current
  current = null
  root.unmount()
  win.close()
  notify()
}

export async function openPip(
  kind: PipKind,
  opts: { width: number; height: number; title: string },
  render: (win: Window, container: HTMLElement) => ReactNode,
) {
  // Chrome allows one floating window per app.
  if (current && current.kind !== kind) toast(`The floating ${current.kind} closed: there can only be one floating window.`)
  closePip()
  const win = await window.documentPictureInPicture!.requestWindow({ width: opts.width, height: opts.height })
  copyStyles(win)
  win.document.title = opts.title
  const host = win.document.createElement('div')
  host.className = 'pip-host'
  win.document.body.appendChild(host)
  const root = createRoot(host)
  root.render(render(win, host))
  current = { kind, win, root }
  notify()
  win.addEventListener('pagehide', () => {
    if (current?.win !== win) return
    current = null
    root.unmount()
    notify()
  })
}
