import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUpdater } from '../server/updater.ts'

/**
 * A stand-in for Homebrew: a script called `brew` that writes down what it was asked, and a folder
 * standing for the installed Deskwork at version 0.1.0. `onUpgrade` is the shell it runs for
 * `brew upgrade` (given the folder as $OPT).
 */
function fakeBrew(onUpgrade: string) {
  const dir = mkdtempSync(join(tmpdir(), 'deskwork-brew-'))
  const installed = join(dir, 'opt')
  mkdirSync(installed)
  writeFileSync(join(installed, 'package.json'), '{ "version": "0.1.0" }')
  const brew = join(dir, 'brew')
  writeFileSync(brew, `#!/bin/bash
echo "$*" >> "${dir}/asked"
OPT="${installed}"
if [ "$1" = "upgrade" ]; then
${onUpgrade}
fi
`)
  chmodSync(brew, 0o755)
  const asked = () => readFileSync(join(dir, 'asked'), 'utf8').trim().split('\n')
  return { dir, brew, installed, asked }
}

/** Waits for the updater to finish, one way or the other. */
async function settled(updater: ReturnType<typeof createUpdater>) {
  for (let i = 0; i < 200 && updater.status().state === 'running'; i++) await new Promise((r) => setTimeout(r, 25))
  return updater.status()
}

test('updating asks brew for the new version, then restarts the server', async () => {
  const fake = fakeBrew(`echo '{ "version": "0.2.0" }' > "$OPT/package.json"`)
  let restarts = 0
  const updater = createUpdater({ brew: fake.brew, installed: fake.installed, current: '0.1.0', restart: () => restarts++ })
  assert.equal(updater.available(), true)
  assert.deepEqual(updater.start(), { state: 'running' })
  // A second click while it works doesn't start a second one.
  assert.deepEqual(updater.start(), { state: 'running' })
  assert.deepEqual(await settled(updater), { state: 'restarting' })
  assert.equal(restarts, 1)
  assert.deepEqual(fake.asked(), ['update', 'upgrade deskwork'])
  rmSync(fake.dir, { recursive: true, force: true })
})

test('when brew fails, the reason is kept and the server is not restarted', async () => {
  const fake = fakeBrew(`echo "Error: No internet, no bottle" >&2\nexit 1`)
  let restarts = 0
  const updater = createUpdater({ brew: fake.brew, installed: fake.installed, current: '0.1.0', restart: () => restarts++ })
  updater.start()
  const status = await settled(updater)
  assert.equal(status.state, 'failed')
  assert.match(status.error ?? '', /No internet, no bottle/)
  assert.equal(restarts, 0)
  // It can be tried again.
  assert.deepEqual(updater.start(), { state: 'running' })
  await settled(updater)
  rmSync(fake.dir, { recursive: true, force: true })
})

test('when brew installs nothing newer, the server is not restarted', async () => {
  const fake = fakeBrew(`echo "Warning: deskwork 0.1.0 already installed"`)
  let restarts = 0
  const updater = createUpdater({ brew: fake.brew, installed: fake.installed, current: '0.1.0', restart: () => restarts++ })
  updater.start()
  const status = await settled(updater)
  assert.equal(status.state, 'failed')
  assert.match(status.error ?? '', /no newer Deskwork yet/)
  assert.equal(restarts, 0)
  rmSync(fake.dir, { recursive: true, force: true })
})

test('a copy that was not installed with Homebrew cannot update itself', () => {
  const updater = createUpdater({ current: '0.1.0', restart: () => assert.fail('must not restart') })
  assert.equal(updater.available(), false)
  const status = updater.start()
  assert.equal(status.state, 'failed')
  assert.match(status.error ?? '', /not installed with Homebrew/)
})
