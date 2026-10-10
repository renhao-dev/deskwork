import { BookOpen, FileText, Link2, StickyNote, PlayCircle } from 'lucide-react'
import { api, fileUrl } from '../api.ts'
import { openPlayer, openReader, setUi, type ItemRef } from '../ui-store.ts'
import { toast } from '../ui.tsx'
import { formatClock } from '../../../shared/day.ts'
import type { AttachedResource, Resource, ResourceKind } from '../../../shared/types.ts'

export const KIND_LABEL: Record<ResourceKind, string> = {
  pdf: 'Book file',
  physical: 'Physical book',
  video: 'Video',
  link: 'Link',
  note: 'Note',
}

export function KindIcon({ kind, size = 16 }: { kind: ResourceKind; size?: number }) {
  const Icon = { pdf: FileText, physical: BookOpen, video: PlayCircle, link: Link2, note: StickyNote }[kind]
  return <Icon size={size} aria-hidden />
}

export interface YouTubeRef { videoId: string | null; listId: string | null; start: number | null }

export function parseYouTube(raw: string): YouTubeRef | null {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  const host = u.hostname.replace(/^(www|m|music)\./, '')
  let videoId: string | null = null
  if (host === 'youtu.be') videoId = u.pathname.slice(1).split('/')[0] || null
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const m = /^\/(shorts|embed|live|v)\/([\w-]{6,})/.exec(u.pathname)
    videoId = m ? m[2] : u.searchParams.get('v')
  } else return null
  const listId = u.searchParams.get('list')
  const t = u.searchParams.get('t') ?? u.searchParams.get('start')
  const start = t ? parseTimeParam(t) : null
  if (!videoId && !listId) return null
  return { videoId, listId, start }
}

function parseTimeParam(t: string): number | null {
  if (/^\d+$/.test(t)) return Number(t)
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t)
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : null
}

export function youtubeLink(yt: YouTubeRef, seconds: number | null, index: number | null) {
  const p = new URLSearchParams()
  if (yt.videoId) p.set('v', yt.videoId)
  if (yt.listId) p.set('list', yt.listId)
  if (index != null && yt.listId) p.set('index', String(index + 1))
  if (seconds) p.set('t', `${Math.floor(seconds)}s`)
  return yt.videoId ? `https://www.youtube.com/watch?${p}` : `https://www.youtube.com/playlist?${p}`
}

export function bookmarkLabel(r: AttachedResource): string | null {
  const b = r.bookmark
  if (r.kind === 'pdf' || r.kind === 'physical') {
    if (b.page == null) return null
    return r.totalPages ? `p. ${b.page} of ${r.totalPages}` : `p. ${b.page}`
  }
  if (r.kind === 'video' && b.seconds != null) {
    return `${b.videoIndex != null ? `video ${b.videoIndex + 1}, ` : ''}at ${formatClock(b.seconds)}`
  }
  return null
}

/** Whether this resource plays inside the app's player window. */
export const playsInApp = (r: Resource) =>
  r.kind === 'video' && ((r.videoSource === 'youtube' && !!parseYouTube(r.url)) || (r.videoSource === 'file' && r.hasFile))

/**
 * Opens a book in its own window without tabs or toolbars, so reading doesn't happen among
 * other tabs. Each book gets one named window: opening it again reuses that window.
 */
export function openReadingWindow(url: string, name: string) {
  const w = Math.min(1100, screen.availWidth - 80)
  const h = screen.availHeight - 60
  const left = Math.round((screen.availWidth - w) / 2)
  const win = window.open(url, name, `popup,width=${w},height=${h},left=${left},top=30`)
  if (win) win.focus()
  else window.open(url, '_blank') // popup blocked: fall back to a tab
}

export function openResource(r: Resource | AttachedResource, ref?: ItemRef) {
  const b = 'bookmark' in r ? r.bookmark : null
  // Books and links opened outside Deskwork can't report progress; opening them is what gets logged.
  // Videos in the player log themselves as they play.
  if (ref && !playsInApp(r) && (r.kind === 'pdf' || r.kind === 'link' || r.kind === 'video')) {
    api.noteOpened(ref.type, ref.id, r.id).catch(() => {})
  }
  switch (r.kind) {
    case 'pdf':
      if (!r.hasFile) return toast('Upload the book file first', 'error')
      // Read it inside Deskwork, so selections can go into notes. Opened from the library rather
      // than from a goal it still opens; there is just no bookmark of yours to move.
      return openReader(ref ?? null, r.id, b?.page ?? undefined)
    case 'video':
      if (ref && playsInApp(r)) return openPlayer(ref, r.id)
      if (r.videoSource === 'file') {
        if (!r.hasFile) return toast('Upload the video file first', 'error')
        window.open(`${fileUrl(r.id)}${b?.seconds ? `#t=${Math.floor(b.seconds)}` : ''}`, '_blank', 'noopener')
        return
      }
      if (r.videoSource === 'youtube') {
        const yt = parseYouTube(r.url)
        if (yt) return void window.open(youtubeLink(yt, b?.seconds ?? null, b?.videoIndex ?? null), '_blank', 'noopener')
      }
      if (r.url) window.open(r.url, '_blank', 'noopener')
      return
    case 'link':
      if (r.url) window.open(r.url, '_blank', 'noopener')
      return
    default:
      setUi({ resourceEditing: { id: r.id } })
  }
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}
