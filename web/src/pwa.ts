// Installing Deskwork as a Chrome app gives it its own window, Dock icon and Cmd+Tab entry.
import { useSyncExternalStore } from 'react'
import { api } from './api.ts'

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPromptEvent | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

export function setupPwa() {
  // The dev server rebuilds constantly; a service worker there would only get in the way.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // show our own button instead of relying on the address-bar icon
    deferred = e as InstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    notify()
    // Chrome's Deskwork app is now in Launchpad; the Homebrew launcher next to it is no longer needed.
    api.retireLauncher().catch(() => {})
  })
}

export const runningAsApp = () => matchMedia('(display-mode: standalone)').matches

/** True when Chrome is ready to install Deskwork and it isn't already running as an app. */
export function useCanInstall() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => !!deferred && !runningAsApp(),
  )
}

export async function installApp() {
  if (!deferred) return false
  const e = deferred
  await e.prompt()
  const { outcome } = await e.userChoice
  if (outcome === 'accepted') {
    deferred = null
    notify()
  }
  return outcome === 'accepted'
}
