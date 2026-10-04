// System notifications (macOS Notification Center). They're shown through the service worker when
// there is one, so they come from Deskwork with its icon and clicking them brings the app forward.

export const notificationsSupported = () => typeof Notification !== 'undefined'

export const notificationPermission = (): NotificationPermission | 'unsupported' =>
  notificationsSupported() ? Notification.permission : 'unsupported'

/** Asks once; must be called from a click or key press. */
export async function ensureNotificationPermission() {
  if (!notificationsSupported()) return 'unsupported' as const
  if (Notification.permission === 'default') return Notification.requestPermission()
  return Notification.permission
}

export async function notify(title: string, body: string, opts: { tag: string; sticky?: boolean }) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return
  const options: NotificationOptions = {
    body,
    tag: opts.tag, // the same tag replaces instead of stacking, e.g. when two Deskwork windows are open
    icon: '/icons/icon-192.png',
    requireInteraction: !!opts.sticky,
  }
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) return await reg.showNotification(title, options)
  } catch {}
  new Notification(title, options)
}
