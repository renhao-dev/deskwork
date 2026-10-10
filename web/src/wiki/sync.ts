// The wiki can be open on the desk and in its own window at the same time. When a page is saved
// in one, the other is told to refetch it, so you never read a stale copy of your own writing.
import type { QueryClient } from '@tanstack/react-query'
import { keys } from '../hooks.ts'

type Message = { kind: 'note'; id: number } | { kind: 'spaces' }

const channel = 'BroadcastChannel' in globalThis ? new BroadcastChannel('deskwork-wiki') : null

export function announce(message: Message) {
  channel?.postMessage(message)
}

export function listenForChanges(qc: QueryClient) {
  if (!channel) return () => {}
  const onMessage = (e: MessageEvent<Message>) => {
    if (e.data?.kind === 'note') {
      qc.invalidateQueries({ queryKey: keys.note(e.data.id) })
      qc.invalidateQueries({ queryKey: ['space-pages'] })
      qc.invalidateQueries({ queryKey: ['notes'] })
    } else if (e.data?.kind === 'spaces') {
      qc.invalidateQueries({ queryKey: keys.spaces })
    }
  }
  channel.addEventListener('message', onMessage)
  return () => channel.removeEventListener('message', onMessage)
}
