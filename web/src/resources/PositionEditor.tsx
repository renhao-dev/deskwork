import { useState } from 'react'
import { Button, ErrorText } from '../ui.tsx'
import { formatClock } from '../../../shared/day.ts'
import { parsePosition, type Position } from '../../../shared/time.ts'

/**
 * Set where a video should start: a time in many formats, plus the video number for playlists.
 * Shows what the input means before saving, since "90" or "1h5m" can be read more than one way.
 */
export function PositionEditor({
  seconds, videoIndex, playlist, onSave, onCancel,
}: {
  seconds: number | null
  videoIndex: number | null
  playlist: boolean
  onSave: (p: { seconds: number; videoIndex: number | null }) => Promise<unknown>
  onCancel: () => void
}) {
  const [time, setTime] = useState(seconds != null ? formatClock(seconds) : '')
  const [video, setVideo] = useState(videoIndex != null ? String(videoIndex + 1) : '')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const parsed = parsePosition(time)
  // A pasted playlist link can carry its own video number.
  const fromLink = parsed && parsed !== 'invalid' ? parsed.videoIndex : undefined
  const videoNum = fromLink != null ? fromLink + 1 : video.trim() ? Number(video) : null
  const videoOk = videoNum == null || (Number.isInteger(videoNum) && videoNum >= 1)

  const preview = parsed === 'invalid' ? 'Write it like 42:17, 1:05:00, 90m or paste a YouTube link'
    : !videoOk ? 'The video number must be 1 or more'
    : `Starts at ${formatClock(parsed?.seconds ?? 0)}${playlist && videoNum ? ` in video ${videoNum}` : ''}`

  const save = async () => {
    if (parsed === 'invalid' || !videoOk) return
    setBusy(true)
    setError(null)
    try {
      await onSave({ seconds: parsed?.seconds ?? 0, videoIndex: playlist && videoNum ? videoNum - 1 : null })
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="position-editor" onSubmit={(e) => (e.preventDefault(), save())}>
      <div className="position-fields">
        {playlist && (
          <label className="position-field position-video">
            <span>Video</span>
            <input value={fromLink != null ? String(fromLink + 1) : video} onChange={(e) => setVideo(e.target.value)}
              inputMode="numeric" placeholder="1" disabled={fromLink != null} aria-label="Video number in the playlist" />
          </label>
        )}
        <label className="position-field">
          <span>Start at</span>
          <input autoFocus value={time} onChange={(e) => setTime(e.target.value)} placeholder="42:17"
            aria-label="Start at time" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onCancel())} />
        </label>
        <Button size="sm" variant="primary" type="submit" disabled={busy || parsed === 'invalid' || !videoOk}>Set start</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
      <p className={`position-preview${parsed === 'invalid' || !videoOk ? ' is-bad' : ''}`} aria-live="polite">{preview}</p>
      <ErrorText error={error} />
    </form>
  )
}
