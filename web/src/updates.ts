// Noticing that Deskwork has been updated while this window stayed open.
import { toast } from './ui.tsx'

let loadedBuild: string | null = null
let told = false

async function check() {
  try {
    const { build } = (await (await fetch('/api/health', { cache: 'no-store' })).json()) as { build?: string }
    if (!build) return
    if (loadedBuild === null) loadedBuild = build
    else if (build !== loadedBuild && !told) {
      told = true
      toast('Deskwork has been updated.', 'info', { label: 'Reload', run: () => location.reload() })
    }
  } catch {}
}

/** Checks now, when the window is used again, and every few minutes. */
export function watchForUpdates() {
  check()
  addEventListener('focus', check)
  addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check())
  setInterval(check, 5 * 60_000)
}
