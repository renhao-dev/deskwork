// Links between things live in the note's own Markdown, as deskwork: addresses:
//   [Learn Hebrew](deskwork:goal/7)   [Verb patterns](deskwork:page/42)   [p. 137](deskwork:book/12/137)
// The id is what finds the target, so renaming never breaks a link.
export type LinkKind = 'page' | 'goal' | 'task' | 'book'

export interface LinkRef { kind: LinkKind; id: number; page?: number }

const ADDRESS = /^deskwork:(page|goal|task|book)\/(\d+)(?:\/(\d+))?$/

export function linkAddress(ref: LinkRef) {
  return ref.kind === 'book' ? `deskwork:book/${ref.id}/${ref.page ?? 1}` : `deskwork:${ref.kind}/${ref.id}`
}

export function parseLink(href: string): LinkRef | null {
  const m = ADDRESS.exec(href.trim())
  if (!m) return null
  return { kind: m[1] as LinkKind, id: Number(m[2]), ...(m[3] ? { page: Number(m[3]) } : {}) }
}

/** Every link in a note, in the order they appear, without repeats. */
export function linksIn(markdown: string): LinkRef[] {
  const out: LinkRef[] = []
  const seen = new Set<string>()
  for (const m of markdown.matchAll(/\]\((deskwork:[^)\s]+)\)/g)) {
    const ref = parseLink(m[1])
    if (!ref) continue
    const key = `${ref.kind}:${ref.id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(ref)
  }
  return out
}

/**
 * Rewrites each link's text to the target's current name, so a renamed goal or page reads right
 * wherever it was linked. A target that's gone keeps whatever was typed.
 */
export function refreshLinkText(markdown: string, nameOf: (ref: LinkRef) => string | null) {
  return markdown.replace(/\[([^\]]*)\]\((deskwork:[^)\s]+)\)/g, (whole, text: string, href: string) => {
    const ref = parseLink(href)
    if (!ref || ref.kind === 'book') return whole // a page reference reads "p. 137", not the book's name
    const name = nameOf(ref)
    return name && name !== text ? `[${name}](${href})` : whole
  })
}
