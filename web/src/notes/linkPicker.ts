// Typing [[ offers what you can link to. Picking one leaves an ordinary Markdown link behind, so
// the note stays plain text and the link survives export.
import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { api } from '../api.ts'
import type { LinkTarget } from '../../../shared/types.ts'

export interface PickerState {
  items: LinkTarget[]
  index: number
  /** Where the caret is on screen, for placing the list. */
  rect: { left: number; top: number; bottom: number } | null
  pick: (item: LinkTarget) => void
}

export const LinkPicker = (set: (state: PickerState | null) => void) =>
  Extension.create({
    name: 'linkPicker',
    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          char: '[[',
          startOfLine: false,
          // Markdown links are written by hand too; only offer this when [[ was typed.
          allowSpaces: true,
          items: ({ query }) => api.linkTargets(query).catch(() => []),
          command: ({ editor, range, props }) => {
            const item = props as LinkTarget
            // The space after the link carries no mark of its own, or typing would continue the link.
            editor.chain().focus()
              .insertContentAt(range, [
                { type: 'text', text: item.title, marks: [{ type: 'link', attrs: { href: item.address } }] },
                { type: 'text', text: ' ' },
              ])
              .run()
          },
          render: () => {
            let items: LinkTarget[] = []
            let index = 0
            let command: ((item: LinkTarget) => void) | null = null
            let rect: DOMRect | null = null // the caret doesn't move while you arrow through the list

            const show = () => set(
              command && items.length
                ? { items, index, rect: rect && { left: rect.left, top: rect.top, bottom: rect.bottom }, pick: command }
                : null,
            )
            return {
              onStart: (props) => {
                items = props.items as LinkTarget[]
                index = 0
                command = (item) => props.command(item as unknown as Record<string, unknown>)
                rect = props.clientRect?.() ?? null
                show()
              },
              onUpdate: (props) => {
                items = props.items as LinkTarget[]
                index = Math.min(index, Math.max(0, items.length - 1))
                command = (item) => props.command(item as unknown as Record<string, unknown>)
                rect = props.clientRect?.() ?? null
                show()
              },
              onKeyDown: (props) => {
                if (!items.length) return false
                if (props.event.key === 'ArrowDown') {
                  index = (index + 1) % items.length
                  show()
                  return true
                }
                if (props.event.key === 'ArrowUp') {
                  index = (index - 1 + items.length) % items.length
                  show()
                  return true
                }
                if (props.event.key === 'Enter' || props.event.key === 'Tab') {
                  command?.(items[index])
                  return true
                }
                if (props.event.key === 'Escape') {
                  set(null)
                  return true
                }
                return false
              },
              onExit: () => {
                items = []
                command = null
                set(null)
              },
            }
          },
        }),
      ]
    },
  })
