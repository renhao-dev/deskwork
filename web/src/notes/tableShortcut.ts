// Markdown tables written straight into a note. Typing a header row, then a | --- | --- | row,
// then Enter turns the two lines into a table; pasting Markdown that holds a table does the same.
import { Extension, type JSONContent } from '@tiptap/core'
import { Plugin, TextSelection } from '@tiptap/pm/state'

/** The cells of a line like `| a | b |`, or null when the line isn't a table row. */
export function rowCells(line: string): string[] | null {
  const t = line.trim()
  if (!t.includes('|')) return null
  const inner = t.replace(/^\|/, '').replace(/\|$/, '')
  const cells = inner.split(/(?<!\\)\|/).map((c) => c.trim())
  return cells.length >= 1 && (t.startsWith('|') || cells.length >= 2) ? cells : null
}

/** How many columns a `| --- | :-: |` line marks out, or null when it isn't one. */
export function delimiterColumns(line: string): number | null {
  const cells = rowCells(line)
  return cells && cells.every((c) => /^:?-{3,}:?$/.test(c)) ? cells.length : null
}

/** Whether pasted text holds a Markdown table: a row directly followed by a matching delimiter row. */
export function hasMarkdownTable(text: string) {
  const lines = text.split(/\r?\n/)
  return lines.some((line, i) => {
    const cols = i > 0 ? delimiterColumns(line) : null
    return cols !== null && rowCells(lines[i - 1])?.length === cols
  })
}

/** A table with the given header and one empty row to write in. */
export function tableFor(header: string[]): JSONContent {
  const cell = (type: string, text: string): JSONContent => ({
    type, content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
  })
  return {
    type: 'table',
    content: [
      { type: 'tableRow', content: header.map((h) => cell('tableHeader', h)) },
      { type: 'tableRow', content: header.map(() => cell('tableCell', '')) },
    ],
  }
}

export const TableShortcut = Extension.create({
  name: 'tableShortcut',
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection
        // Only at the end of a delimiter row sitting at the top of the note, right under a header row.
        if (!empty || $from.depth !== 1 || $from.parent.type.name !== 'paragraph') return false
        if ($from.parentOffset !== $from.parent.content.size) return false
        const index = $from.index(0)
        const above = index > 0 ? editor.state.doc.child(index - 1) : null
        if (above?.type.name !== 'paragraph') return false
        const cols = delimiterColumns($from.parent.textContent)
        const header = rowCells(above.textContent)
        if (cols === null || header?.length !== cols) return false

        const from = $from.before() - above.nodeSize
        const table = editor.schema.nodeFromJSON(tableFor(header))
        // Caret into the first empty cell: past the table, the header row and into the next row's cell.
        const firstCell = from + 1 + table.child(0).nodeSize + 3
        return editor.chain()
          .insertContentAt({ from, to: $from.after() }, table.toJSON())
          .command(({ tr }) => { tr.setSelection(TextSelection.create(tr.doc, firstCell)); return true })
          .scrollIntoView()
          .run()
      },
    }
  },
  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        props: {
          handlePaste: (_view, event) => {
            const data = event.clipboardData
            const text = data?.getData('text/plain') ?? ''
            // Copied from a web page, the table already comes as HTML and is handled as such.
            if (data?.getData('text/html').includes('<table') || !hasMarkdownTable(text)) return false
            return editor.commands.insertContent(text, { contentType: 'markdown' })
          },
        },
      }),
    ]
  },
})
