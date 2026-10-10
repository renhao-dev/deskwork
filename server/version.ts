// Which Deskwork this is, and whether a newer one has been released. Installs through Homebrew
// update with `brew upgrade`, so all the app can do is say that one exists.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as {
  version: string
  repository?: { url?: string }
}
export const VERSION = pkg.version
/** owner/name on GitHub, taken from package.json so a fork checks its own releases. */
const REPO = /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(pkg.repository?.url ?? '')?.[1]

/** Whether version `a` is newer than `b`, comparing 1.2.10 against 1.2.9 by number. */
export function isNewer(a: string, b: string) {
  const parse = (v: string) => v.replace(/^v/, '').split(/[.-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0)
  const [x, y] = [parse(a), parse(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

export interface Latest { version: string; url: string }
let cached: { at: number; latest: Latest | null } | null = null
const TWELVE_HOURS = 12 * 3_600_000

/** The newest release on GitHub, asked at most twice a day. Offline or rate-limited just means "don't know". */
export async function latestRelease(): Promise<Latest | null> {
  if (!REPO) return null
  if (cached && Date.now() - cached.at < TWELVE_HOURS) return cached.latest
  let latest: Latest | null = null
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': `Deskwork/${VERSION}` },
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) {
      const r = (await res.json()) as { tag_name?: string; html_url?: string }
      if (r.tag_name && r.html_url) latest = { version: r.tag_name.replace(/^v/, ''), url: r.html_url }
    }
  } catch {}
  cached = { at: Date.now(), latest }
  return latest
}
