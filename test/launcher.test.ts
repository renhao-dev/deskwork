import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { retireLauncher } from '../server/launcher.ts'

// A made-up home folder, so nothing here can touch the real ~/Applications.
function homeWithApp(identifier: string | null) {
  const home = mkdtempSync(join(tmpdir(), 'deskwork-home-'))
  const app = join(home, 'Applications', 'Deskwork(chrome tab).app')
  if (identifier !== null) {
    mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true })
    writeFileSync(join(app, 'Contents', 'Info.plist'),
      `<plist><dict><key>CFBundleIdentifier</key><string>${identifier}</string></dict></plist>`)
    writeFileSync(join(app, 'Contents', 'MacOS', 'Deskwork'), '#!/bin/bash\n')
  }
  return { home, app }
}

test('the launcher is removed once Deskwork is installed as an app', () => {
  const { home, app } = homeWithApp('local.deskwork.launcher')
  assert.equal(retireLauncher(home), true)
  assert.equal(existsSync(app), false)
  assert.equal(retireLauncher(home), false) // already gone: nothing to do, and no error
  rmSync(home, { recursive: true, force: true })
})

test('an app that only shares the name is left alone', () => {
  const { home, app } = homeWithApp('com.example.something-else')
  assert.equal(retireLauncher(home), false)
  assert.equal(existsSync(app), true)
  rmSync(home, { recursive: true, force: true })
})

test('no launcher means nothing happens', () => {
  const { home } = homeWithApp(null)
  assert.equal(retireLauncher(home), false)
  rmSync(home, { recursive: true, force: true })
})
