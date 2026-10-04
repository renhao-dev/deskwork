// Reading a video position typed by a person: "42:17", "1:05:00", "90m", "1h5m", "90" (minutes),
// or a pasted YouTube link with a timestamp (…&t=2537s, &index=3).

export interface Position {
  seconds: number
  /** 0-based video in a playlist, when the input says which one (a YouTube link with &index=). */
  videoIndex?: number
}

const UNITS = /^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in(?:utes?|s)?)?)?\s*(?:(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?|s)?)?)?$/i

function fromUnits(v: string): number | null {
  const m = UNITS.exec(v.trim())
  if (!m || !(m[1] || m[2] || m[3])) return null
  return Math.round(Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0))
}

/** null for empty input, 'invalid' when it can't be read. */
export function parsePosition(raw: string): Position | null | 'invalid' {
  const v = raw.trim()
  if (!v) return null

  if (/^https?:\/\//i.test(v)) {
    let url: URL
    try {
      url = new URL(v)
    } catch {
      return 'invalid'
    }
    const t = url.searchParams.get('t') ?? url.searchParams.get('start')
    const seconds = t == null ? 0 : /^\d+$/.test(t) ? Number(t) : fromUnits(t)
    if (seconds == null) return 'invalid'
    const index = Number(url.searchParams.get('index'))
    return Number.isInteger(index) && index >= 1 ? { seconds, videoIndex: index - 1 } : { seconds }
  }

  if (v.includes(':')) {
    const parts = v.split(':')
    if (parts.length > 3 || parts.some((p) => !/^\d+$/.test(p.trim()))) return 'invalid'
    const nums = parts.map((p) => Number(p.trim()))
    if (nums.slice(1).some((n) => n >= 60)) return 'invalid' // "5:75" is a typo, not 6:15
    return { seconds: nums.reduce((acc, n) => acc * 60 + n, 0) }
  }

  // A bare number means minutes: people say "I'm 90 minutes in".
  if (/^\d+(?:\.\d+)?$/.test(v)) return { seconds: Math.round(Number(v) * 60) }

  const seconds = fromUnits(v)
  return seconds == null ? 'invalid' : { seconds }
}
