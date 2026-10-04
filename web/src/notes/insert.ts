// Sending text into the note you have open, e.g. from the book reader.
import type { Editor } from '@tiptap/react'
import { getUi } from '../ui-store.ts'

const editors = new Map<number, Editor>()

export function registerNoteEditor(id: number, editor: Editor) {
  editors.set(id, editor)
  return () => {
    if (editors.get(id) === editor) editors.delete(id)
  }
}

/** The note open in the Notes window, if any. */
export const activeNoteEditor = () => {
  const id = getUi().noteActive
  return id != null ? editors.get(id) ?? null : null
}

/** Appends Markdown to the open note. Returns false when no note is open. */
export function appendToActiveNote(markdown: string): boolean {
  const editor = activeNoteEditor()
  if (!editor || editor.isDestroyed) return false
  // Markdown blocks separate themselves, so this goes in after whatever the note already has.
  editor.chain().focus('end').insertContentAt(editor.state.doc.content.size, markdown, { contentType: 'markdown' }).run()
  return true
}

/** A link back to a page of a book, understood by notes: deskwork:book/12/137 */
export const bookLink = (resourceId: number, page: number) => `deskwork:book/${resourceId}/${page}`

export function parseDeskworkLink(href: string): { resourceId: number; page: number } | null {
  const m = /^deskwork:book\/(\d+)\/(\d+)$/.exec(href)
  return m ? { resourceId: Number(m[1]), page: Number(m[2]) } : null
}

/** The three ways the reader can put a selection into a note. */
export function selectionMarkdown(kind: 'text' | 'reference' | 'quote', text: string, book: { id: number; title: string; page: number }) {
  const link = `[p. ${book.page}](${bookLink(book.id, book.page)})`
  if (kind === 'text') return text
  if (kind === 'reference') return `${text} (${link})`
  return `> ${text.replace(/\n/g, '\n> ')}\n>\n> — ${book.title}, ${link}`
}
