// Wiki addresses: /wiki, /wiki/linear-algebra, /wiki/linear-algebra/eigenvalues-42.
// The id at the end of a page's address is what finds it, so renaming a page never breaks a link.
export interface WikiRoute {
  spaceSlug: string | null
  pageId: number | null
}

export const WIKI_ROOT = '/wiki'

export function parseWikiPath(path: string): WikiRoute {
  const parts = path.replace(/^\/+|\/+$/g, '').split('/').map(decodeURIComponent)
  if (parts[0] !== 'wiki') return { spaceSlug: null, pageId: null }
  const page = parts[2] ? /-(\d+)$/.exec(parts[2]) : null
  return { spaceSlug: parts[1] ?? null, pageId: page ? Number(page[1]) : null }
}

export function wikiPath(space?: { slug: string } | null, page?: { slug: string; id: number } | null) {
  if (!space) return WIKI_ROOT
  const s = `${WIKI_ROOT}/${encodeURIComponent(space.slug)}`
  return page ? `${s}/${encodeURIComponent(`${page.slug || 'page'}-${page.id}`)}` : s
}

export const isWikiPath = (path = window.location.pathname) => path === WIKI_ROOT || path.startsWith(`${WIKI_ROOT}/`)
