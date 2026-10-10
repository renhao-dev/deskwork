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

// ---------- a newer release ----------

const SEEN_KEY = 'deskwork.release-notice'

/** Says once a day that a newer Deskwork has been released, and how to get it. Needs a signed-in user. */
export async function announceNewRelease() {
  const latest = await fetch('/api/version', { cache: 'no-store' })
    .then((r) => r.json() as Promise<{ latest?: { version: string; url: string } | null }>)
    .then((v) => v.latest ?? null, () => null)
  if (!latest) return
  const today = new Date().toDateString()
  try {
    if (localStorage.getItem(SEEN_KEY) === `${latest.version} ${today}`) return
    localStorage.setItem(SEEN_KEY, `${latest.version} ${today}`)
  } catch {}
  const { url } = latest
  toast(`Deskwork ${latest.version} is out. Update in Terminal: brew upgrade deskwork`, 'info',
    { label: 'What’s new', run: () => window.open(url, '_blank', 'noopener') })
}
