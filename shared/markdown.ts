// Notes are Markdown. Search and summaries want the words, not the punctuation around them.
export function plainText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ') // code blocks say nothing about what a page is about
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links keep their words, drop the address
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]\s+\[[ xX]\]|[-*+]|\d+[.)])\s*/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
