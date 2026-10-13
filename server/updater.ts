// Updating from inside the app. Only an install made with Homebrew can do it: the formula's start
// script says where brew is (DESKWORK_BREW) and where the installed copy lives (DESKWORK_OPT).
//
// The server asks brew for the new version, then quits. It runs as a service that is kept alive,
// so it is started again at once, and the start script by then points at the new version.
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isNewer } from './version.ts'
import type { UpdateStatus } from '../shared/types.ts'

/** The end of what a command printed: that is where it says what went wrong. */
const lastLines = (text: string) => text.trim().split('\n').slice(-4).join('\n').slice(-400)

export function createUpdater(o: {
  /** The brew program, when this is a Homebrew install. */
  brew?: string
  /** The folder Homebrew keeps the current Deskwork in (it has the package.json). */
  installed?: string
  /** The version that is running. */
  current: string
  /** Stops the server, so that it comes back as the new version. */
  restart: () => void
}) {
  let status: UpdateStatus = { state: 'idle' }

  const available = () => !!o.brew && !!o.installed && existsSync(o.brew)

  const brew = (...args: string[]) => new Promise<void>((resolve, reject) => {
    // The service starts with a bare PATH; brew needs git, curl and its own programs.
    const env = { ...process.env, PATH: `${dirname(o.brew!)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_ENV_HINTS: '1' }
    execFile(o.brew!, args, { env, timeout: 20 * 60_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(lastLines(`${stdout}\n${stderr}`) || err.message))
      else resolve()
    })
  })

  const installedVersion = () => {
    try {
      return String((JSON.parse(readFileSync(join(o.installed!, 'package.json'), 'utf8')) as { version?: string }).version ?? '')
    } catch {
      return ''
    }
  }

  async function run() {
    // `brew update` fetches the list of versions. If it stumbles (some other tap is broken, say)
    // the upgrade may still work, so its complaint is only used when nothing got installed.
    const fetchProblem = await brew('update').then(() => null, (e: Error) => e)
    await brew('upgrade', 'deskwork')
    if (!isNewer(installedVersion(), o.current)) {
      throw fetchProblem ?? new Error('Homebrew has no newer Deskwork yet. Try again in a few minutes.')
    }
  }

  /** Starts updating unless it already is. Returns at once: follow it with status(). */
  function start(): UpdateStatus {
    if (!available()) return (status = { state: 'failed', error: 'This copy of Deskwork was not installed with Homebrew, so it cannot update itself.' })
    if (status.state === 'running' || status.state === 'restarting') return status
    status = { state: 'running' }
    run().then(
      () => {
        status = { state: 'restarting' }
        o.restart()
      },
      (e: Error) => {
        console.error('Update failed:', e.message)
        status = { state: 'failed', error: e.message }
      },
    )
    return status
  }

  return { available, start, status: () => status }
}
