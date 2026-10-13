// Noticing that Deskwork has been updated while this window stayed open, and getting a newer one.
import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from './api.ts'
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

const FIVE_MINUTES = 5 * 60_000

/** Asks now and every five minutes whether a newer Deskwork is out, and whether this copy can install it. */
export const useRelease = () =>
  useQuery({ queryKey: ['version'], queryFn: api.version, refetchInterval: FIVE_MINUTES, refetchIntervalInBackground: true, retry: false })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Installs the newer Deskwork and loads it: the server has Homebrew fetch it, then restarts.
 * `from` is the version running now. On success the page reloads; a failure is thrown with its reason.
 */
export async function installUpdate(from: string) {
  const started = await api.startUpdate()
  if (started.state === 'failed') throw new Error(started.error ?? 'The update did not work.')
  const giveUpAt = Date.now() + 25 * 60_000
  while (Date.now() < giveUpAt) {
    await sleep(2000)
    // The server is away for a moment while it restarts. A new version answering means it's done.
    const health = await fetch('/api/health', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ version?: string }>) : null), () => null)
    if (!health) continue
    const status = await api.updateStatus().catch((e) => (e instanceof ApiError && e.status === 401 ? 'signed out' as const : null))
    // A restart signs everyone out, so that too means the server came back: show what it is now.
    if ((health.version && health.version !== from) || status === 'signed out') {
      location.reload()
      return
    }
    if (status?.state === 'failed') throw new Error(status.error ?? 'The update did not work.')
  }
  throw new Error('The update is taking too long. Look at it in Terminal: brew upgrade deskwork')
}
