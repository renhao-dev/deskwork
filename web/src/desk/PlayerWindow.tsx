import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Clock, ExternalLink, Link2, Link2Off, PlayCircle } from 'lucide-react'
import { api, fileUrl } from '../api.ts'
import { keys, useDetail, useTimerView } from '../hooks.ts'
import { setUi, useUi, type ItemRef } from '../ui-store.ts'
import { Button, Empty, toast } from '../ui.tsx'
import { PositionEditor } from '../resources/PositionEditor.tsx'
import { formatClock } from '../../../shared/day.ts'
import { parseYouTube, youtubeLink, type YouTubeRef } from '../resources/resources.tsx'
import { FloatingWindow } from './FloatingWindow.tsx'
import type { AttachedResource, Bookmark } from '../../../shared/types.ts'

interface Controller {
  play(): void
  pause(): void
  position(): { seconds: number; videoIndex: number | null } | null
  /** Jump to a position without starting playback if it was paused. */
  seek(seconds: number, videoIndex: number | null): void
}

interface PlayerEvents {
  bookmark: Bookmark
  onReady: (c: Controller) => void
  onPlaying: (playing: boolean) => void
}

// ---------- YouTube ----------

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window { YT?: any; onYouTubeIframeAPIReady?: () => void }
}

let ytApi: Promise<any> | null = null
function loadYouTubeApi(): Promise<any> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  ytApi ??= new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prev?.()
      resolve(window.YT)
    }
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    s.onerror = () => {
      ytApi = null
      reject(new Error('Could not load the YouTube player. Check your internet connection.'))
    }
    document.head.appendChild(s)
  })
  return ytApi
}

function YouTubePlayer({ yt, bookmark, onReady, onPlaying, onBlocked }: PlayerEvents & { yt: YouTubeRef; onBlocked: (why: string) => void }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let player: any
    let cancelled = false
    const start = Math.floor(bookmark.seconds ?? yt.start ?? 0)
    const resumeInList = yt.listId && bookmark.videoIndex != null
    loadYouTubeApi().then((YT) => {
      if (cancelled || !host.current) return
      const el = document.createElement('div')
      host.current.replaceChildren(el)
      player = new YT.Player(el, {
        width: '100%',
        height: '100%',
        videoId: resumeInList ? undefined : yt.videoId ?? undefined,
        playerVars: {
          rel: 0, playsinline: 1, origin: location.origin, start,
          ...(yt.listId && !resumeInList ? { list: yt.listId, listType: 'playlist' } : {}),
        },
        events: {
          onReady: () => {
            if (resumeInList) player.cuePlaylist({ listType: 'playlist', list: yt.listId, index: bookmark.videoIndex, startSeconds: start })
            onReady({
              play: () => player.playVideo?.(),
              pause: () => player.pauseVideo?.(),
              position: () => {
                const seconds = player.getCurrentTime?.()
                if (typeof seconds !== 'number') return null
                const idx = yt.listId ? player.getPlaylistIndex?.() : null
                return { seconds, videoIndex: typeof idx === 'number' && idx >= 0 ? idx : null }
              },
              seek: (seconds, videoIndex) => {
                const state = player.getPlayerState?.() // 1 playing, 2 paused, 3 buffering, 5 cued, -1 unstarted
                const idx = yt.listId ? player.getPlaylistIndex?.() : null
                if (yt.listId && videoIndex != null && videoIndex !== idx) {
                  const args = { listType: 'playlist', list: yt.listId, index: videoIndex, startSeconds: seconds }
                  if (state === 1) player.loadPlaylist(args)
                  else player.cuePlaylist(args)
                } else if (state === 1 || state === 2 || state === 3) {
                  player.seekTo(seconds, true)
                } else {
                  // Not started yet: re-cue the current video at the new start.
                  const current = player.getVideoData?.()?.video_id ?? yt.videoId
                  if (yt.listId) player.cuePlaylist({ listType: 'playlist', list: yt.listId, index: idx ?? 0, startSeconds: seconds })
                  else if (current) player.cueVideoById({ videoId: current, startSeconds: seconds })
                }
              },
            })
          },
          onStateChange: (e: { data: number }) => onPlaying(e.data === YT.PlayerState.PLAYING),
          onError: (e: { data: number }) => {
            if (e.data === 101 || e.data === 150 || e.data === 153) onBlocked("This video's owner doesn't allow playing it outside YouTube.")
            else if (e.data === 100) onBlocked('This video was removed or is private.')
          },
        },
      })
    }, (err: Error) => onBlocked(err.message))
    return () => {
      cancelled = true
      try {
        player?.destroy()
      } catch {}
    }
    // Recreate only when the video itself changes; bookmark is read at load time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yt.videoId, yt.listId])
  return <div ref={host} className="player-frame" />
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------- uploaded file ----------

function FilePlayer({ resourceId, bookmark, onReady, onPlaying }: PlayerEvents & { resourceId: number }) {
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = video.current
    if (!v) return
    onReady({
      play: () => void v.play().catch(() => {}),
      pause: () => v.pause(),
      position: () => ({ seconds: v.currentTime, videoIndex: null }),
      seek: (seconds) => {
        v.currentTime = seconds
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId])
  return (
    <video
      ref={video}
      className="player-frame"
      src={fileUrl(resourceId)}
      controls
      preload="metadata"
      onLoadedMetadata={(e) => {
        if (bookmark.seconds) e.currentTarget.currentTime = bookmark.seconds
      }}
      onPlay={() => onPlaying(true)}
      onPause={() => onPlaying(false)}
    />
  )
}

// ---------- window ----------

function useBookmarkSaver(ref: ItemRef, resourceId: number, ctrl: React.RefObject<Controller | null>, played: React.RefObject<boolean>) {
  const last = useRef<string>('')
  const qc = useQueryClient()
  return useCallback((refresh = false) => {
    // Nothing to save until the video has actually played: before that the player may still report 0:00,
    // and just opening the player shouldn't count as watching.
    if (!played.current) return
    const pos = ctrl.current?.position()
    if (!pos) return
    const seconds = Math.floor(pos.seconds)
    const sig = `${seconds}:${pos.videoIndex}`
    if (sig === last.current) return
    last.current = sig
    api.saveBookmark(ref.type, ref.id, { resourceId, seconds, videoIndex: pos.videoIndex })
      .then(() => {
        if (refresh) qc.invalidateQueries({ queryKey: keys.detail(ref.type, ref.id) })
        // A running session lists what's being watched; keep that current.
        qc.invalidateQueries({ queryKey: keys.dashboard })
      })
      .catch(() => {})
  }, [ref.type, ref.id, resourceId, ctrl, played, qc])
}

function PlayerBody({ refItem, resource }: { refItem: ItemRef; resource: AttachedResource }) {
  const ctrl = useRef<Controller | null>(null)
  const [playing, setPlaying] = useState(false)
  const [blocked, setBlocked] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [settingStart, setSettingStart] = useState(false)
  const played = useRef(false)
  const save = useBookmarkSaver(refItem, resource.id, ctrl, played)
  const qc = useQueryClient()

  // A start set by hand: jump there and save it. It isn't logged as watched.
  const setStart = async (p: { seconds: number; videoIndex: number | null }) => {
    ctrl.current?.seek(p.seconds, p.videoIndex)
    await api.saveBookmark(refItem.type, refItem.id, { resourceId: resource.id, seconds: p.seconds, videoIndex: p.videoIndex, manual: true })
    qc.invalidateQueries({ queryKey: keys.detail(refItem.type, refItem.id) })
    setSettingStart(false)
    toast(`Starts at ${formatClock(p.seconds)}${p.videoIndex != null ? ` in video ${p.videoIndex + 1}` : ''}`)
  }

  // A start set from the goal's details while this player is open.
  const seekRequest = useUi((s) => s.playerSeek)
  useEffect(() => {
    if (!seekRequest || seekRequest.resourceId !== resource.id || seekRequest.type !== refItem.type || seekRequest.id !== refItem.id) return
    ctrl.current?.seek(seekRequest.seconds, seekRequest.videoIndex)
    setUi({ playerSeek: null })
  }, [seekRequest, resource.id, refItem.type, refItem.id])

  // Whether this video follows the timer is remembered per goal and video.
  const [syncOverride, setSyncOverride] = useState<boolean | undefined>(undefined)

  // Play requested from elsewhere (Start with this video): now if ready, or as soon as the player is.
  // Browsers may refuse to start a video by itself; then say so instead of sitting silently paused.
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)
  const requestPlay = useCallback((c: Controller) => {
    c.play()
    setTimeout(() => setAutoplayBlocked(!playingRef.current), 2500)
  }, [])
  const playingRef = useRef(false)
  const wantPlay = useRef(false)
  const playRequest = useUi((s) => s.playerPlay)
  useEffect(() => {
    if (!playRequest || playRequest.resourceId !== resource.id || playRequest.type !== refItem.type || playRequest.id !== refItem.id) return
    setUi({ playerPlay: null })
    if (playRequest.sync !== undefined) setSyncOverride(playRequest.sync) // chosen in the Start dialog
    if (ctrl.current) requestPlay(ctrl.current)
    else wantPlay.current = true
  }, [playRequest, resource.id, refItem.type, refItem.id, requestPlay])
  const synced = syncOverride ?? resource.syncTimer
  const view = useTimerView()
  const timerId = view?.state.id ?? null
  const shouldPlay = !!view && view.state.status === 'running' && !view.onBreak

  // Save the position while playing, when pausing, and when the window closes.
  useEffect(() => {
    if (!playing) {
      save()
      return
    }
    const t = setInterval(() => save(), 5000)
    return () => clearInterval(t)
  }, [playing, save])
  useEffect(() => () => save(true), [save])

  // The players register their listeners once, so route events through a ref to see fresh state.
  const onPlayingRef = useRef<(p: boolean) => void>(() => {})
  onPlayingRef.current = (p: boolean) => {
    playingRef.current = p
    if (p) {
      played.current = true
      setAutoplayBlocked(false)
    }
    setPlaying(p)
    const t = view?.state
    if (p && t && synced == null) setAsking(true)
  }

  // Follow the timer when synced: pause on breaks, pause and stop, resume on focus.
  const prevShouldPlay = useRef(shouldPlay)
  useEffect(() => {
    const prev = prevShouldPlay.current
    prevShouldPlay.current = shouldPlay
    if (!synced || prev === shouldPlay) return
    if (shouldPlay) ctrl.current?.play()
    else ctrl.current?.pause()
  }, [shouldPlay, synced])

  useEffect(() => {
    if (!timerId) setAsking(false)
  }, [timerId])

  const choose = (value: boolean) => {
    setSyncOverride(value)
    setAsking(false)
    api.setResourcePrefs(refItem.type, refItem.id, resource.id, { syncTimer: value })
      .then(() => qc.invalidateQueries({ queryKey: keys.detail(refItem.type, refItem.id) }), () => {})
  }

  const yt = resource.videoSource === 'youtube' ? parseYouTube(resource.url) : null
  const external = yt ? youtubeLink(yt, resource.bookmark.seconds, resource.bookmark.videoIndex) : null
  const events: PlayerEvents = {
    bookmark: resource.bookmark,
    onReady: (c) => {
      ctrl.current = c
      if (wantPlay.current) {
        wantPlay.current = false
        requestPlay(c)
      }
    },
    onPlaying: (p) => onPlayingRef.current(p),
  }

  return (
    <div className="player">
      <div className="player-stage">
        {blocked ? (
          <div className="player-blocked">
            <p>{blocked}</p>
            {external && (
              <a className="btn btn-primary" href={external} target="_blank" rel="noreferrer">
                <ExternalLink size={15} /> Open on YouTube at your spot
              </a>
            )}
          </div>
        ) : yt ? (
          <YouTubePlayer yt={yt} {...events} onBlocked={setBlocked} />
        ) : (
          <FilePlayer resourceId={resource.id} {...events} />
        )}
      </div>
      <div className="player-bar">
        {autoplayBlocked && !settingStart ? (
          <div className="sync-ask" role="status">
            <span>Your browser didn’t let the video start by itself. Press play on the video.</span>
            <Button size="sm" variant="ghost" onClick={() => setAutoplayBlocked(false)}>OK</Button>
          </div>
        ) : settingStart ? (
          <PositionEditor seconds={ctrl.current?.position()?.seconds ?? resource.bookmark.seconds}
            videoIndex={ctrl.current?.position()?.videoIndex ?? resource.bookmark.videoIndex}
            playlist={!!yt?.listId} onSave={setStart} onCancel={() => setSettingStart(false)} />
        ) : asking ? (
          <div className="sync-ask" role="group" aria-label="Sync video with timer">
            <span>Sync this video with your timer? It pauses on breaks and when you pause or stop.</span>
            <Button size="sm" variant="brass" onClick={() => choose(true)}>Sync</Button>
            <Button size="sm" variant="ghost" onClick={() => choose(false)}>Keep separate</Button>
          </div>
        ) : (
          <>
            <span className="player-hint">Your place is saved as you watch.</span>
            <Button size="sm" variant="ghost" onClick={() => setSettingStart(true)}
              title="Choose where the video starts, e.g. if you watched some already">
              <Clock size={14} /> Set start
            </Button>
            {synced != null && (
              <Button size="sm" variant="ghost" onClick={() => choose(!synced)}>
                {synced ? <><Link2 size={14} /> Synced with timer</> : <><Link2Off size={14} /> Not synced</>}
              </Button>
            )}
            {external && !blocked && (
              <a className="btn btn-ghost btn-sm" href={external} target="_blank" rel="noreferrer" onClick={() => ctrl.current?.pause()}>
                <ExternalLink size={14} /> YouTube
              </a>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export function PlayerWindow({ deskRef }: { deskRef: React.RefObject<HTMLDivElement | null> }) {
  const player = useUi((s) => s.player)
  const detail = useDetail(player?.type ?? 'goal', player?.id ?? 0, !!player)
  if (!player) return null
  const resource = detail.data?.resources.find((r) => r.id === player.resourceId)
  const itemTitle = detail.data?.item.title
  return (
    <FloatingWindow
      id="player"
      title={resource?.title ?? 'Player'}
      icon={<PlayCircle size={17} />}
      meta={itemTitle}
      closable
      deskRef={deskRef}
      className="window-player"
      defaultRect={(d) => {
        const w = Math.min(720, d.width - 32)
        return { x: Math.max(16, d.width - w - 40), y: Math.max(16, d.height - (w * 9) / 16 - 120), w, h: (w * 9) / 16 + 90 }
      }}
    >
      {detail.isPending ? <p className="muted pad">Loading…</p> : !resource ? (
        <Empty action={<Button size="sm" onClick={() => setUi({ player: null })}>Close player</Button>}>
          This video is no longer attached to the {player.type}.
        </Empty>
      ) : (
        <PlayerBody key={`${player.type}:${player.id}:${resource.id}`} refItem={player} resource={resource} />
      )}
    </FloatingWindow>
  )
}
