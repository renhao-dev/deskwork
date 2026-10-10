// What a note can hold. The editor adds its interactive pieces on top; tests use this list alone
// to check that Markdown goes in and comes back out unchanged.
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'

export const noteExtensions = [
  StarterKit.configure({ link: { openOnClick: false, autolink: true, defaultProtocol: 'https', protocols: ['deskwork'] } }),
  Image.configure({ allowBase64: false }),
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit.configure({ table: { resizable: false } }),
]
