// Slugs make wiki links readable: /wiki/linear-algebra/eigenvalues-42. The id in the URL is what
// actually finds the page, so a slug may repeat and renaming a page never breaks a link.
export function slugify(text: string, fallback = 'untitled') {
  const s = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // drop accents, keeping the letter
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-') // any script's letters and digits survive
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return s || fallback
}

/** Appends -2, -3… until the slug is free. `taken` holds slugs already in use. */
export function uniqueSlug(text: string, taken: Iterable<string>, fallback?: string) {
  const base = slugify(text, fallback)
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let i = 2; ; i++) {
    const next = `${base}-${i}`
    if (!used.has(next)) return next
  }
}
