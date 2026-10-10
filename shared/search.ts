// What you type isn't SQLite's query language, so it's translated. Every word becomes a term that
// must appear, and the last one matches as a prefix so results narrow as you keep typing.
export function searchQuery(input: string): string | null {
  const words = input.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  if (!words.length) return null
  return words.map((w, i) => (i === words.length - 1 ? `"${w}"*` : `"${w}"`)).join(' ')
}
