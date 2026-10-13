// The Homebrew install puts a small launcher in Launchpad, "Deskwork(chrome tab)", made by
// packaging/mac-launcher.sh. Once Deskwork is installed as a Chrome app, that app is the icon to
// use, so the launcher is removed.
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'

/** Removes the launcher from ~/Applications. True when there was one to remove. */
export function retireLauncher(home = homedir()): boolean {
  const app = join(home, 'Applications', 'Deskwork(chrome tab).app')
  const plist = join(app, 'Contents', 'Info.plist')
  if (!existsSync(plist)) return false
  // Only ever delete the app this project made, never something else that happens to share the name.
  if (!readFileSync(plist, 'utf8').includes('<string>local.deskwork.launcher</string>')) return false
  rmSync(app, { recursive: true, force: true })
  // Tell Launchpad it's gone. Best effort: the icon disappears on its own a little later anyway.
  execFile(LSREGISTER, ['-u', app], () => {})
  return true
}
