// The list that appears after [[ — pages, goals, tasks and books you can link to.
import { useEffect, useRef } from 'react'
import { BookOpen, FileText, ListChecks, Target } from 'lucide-react'
import { usePortalContainer } from '../ui.tsx'
import { createPortal } from 'react-dom'
import type { PickerState } from './linkPicker.ts'
import type { LinkTarget } from '../../../shared/types.ts'

const ICON = {
  page: <FileText size={14} />, goal: <Target size={14} />, task: <ListChecks size={14} />, book: <BookOpen size={14} />,
}

export function LinkMenu({ state }: { state: PickerState }) {
  const host = usePortalContainer() ?? document.body
  const list = useRef<HTMLUListElement>(null)

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [state.index])

  if (!state.rect) return null
  // Below the caret, unless that would fall off the bottom of the window.
  const room = host.ownerDocument.defaultView!.innerHeight - state.rect.bottom
  const below = room > 240
  const style: React.CSSProperties = below
    ? { left: state.rect.left, top: state.rect.bottom + 4 }
    : { left: state.rect.left, bottom: host.ownerDocument.defaultView!.innerHeight - state.rect.top + 4 }

  return createPortal(
    <ul className="link-menu" style={style} ref={list} role="listbox" aria-label="Link to">
      {state.items.map((item: LinkTarget, i) => (
        <li key={`${item.kind}-${item.id}`} role="option" aria-selected={i === state.index}
            className={`link-option${i === state.index ? ' is-active' : ''}`}>
          <button type="button" onMouseDown={(e) => (e.preventDefault(), state.pick(item))}>
            <span className="link-option-icon">{ICON[item.kind]}</span>
            <span className="link-option-title">{item.title}</span>
            <span className="link-option-hint">{item.hint}</span>
          </button>
        </li>
      ))}
    </ul>,
    host,
  )
}
