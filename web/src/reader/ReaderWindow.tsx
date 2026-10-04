// Reading a book inside Deskwork: pages are drawn here, so a selection can go straight into a note.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { BookOpen, ExternalLink, Minus, Plus, Quote, StickyNote, Link2 } from 'lucide-react'
import { api, fileUrl } from '../api.ts'
import { keys, useDetail } from '../hooks.ts'
import { setUi, useUi, type ItemRef } from '../ui-store.ts'
import { Button, Empty, IconButton, toast } from '../ui.tsx'
import { FloatingWindow } from '../desk/FloatingWindow.tsx'
import { appendToActiveNote, selectionMarkdown } from '../notes/insert.ts'
import { openReadingWindow } from '../resources/resources.tsx'
import { pdfjs, tidySelection, type PdfDoc } from './pdf.ts'
import type { AttachedResource } from '../../../shared/types.ts'

const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3]
/** "fit" keeps the page as wide as the window; a number is a fixed zoom. */
type Zoom = 'fit' | number

interface PageBox { width: number; height: number }

/**
 * One page: drawn on a canvas, with a transparent layer of real text on top for selecting.
 * With `zoom: 'fit'` the page is scaled to the window's width — each page separately, because
 * scans often mix page sizes (a small cover, then large spreads).
 */
function Page({ doc, number, zoom, available, onSize }: {
  doc: PdfDoc; number: number; zoom: Zoom; available: number; onSize: (n: number, b: PageBox) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = host.current
    if (!el) return
    // Draw a page when it comes near the window, so a 500-page book stays quick.
    const io = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), { root: el.closest('.reader-scroll'), rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const el = host.current
    if (!el) return
    let cancelled = false
    let task: { cancel(): void } | null = null
    ;(async () => {
      const page = await doc.getPage(number)
      const natural = page.getViewport({ scale: 1 }).width
      const scale = zoom === 'fit' ? Math.max(0.1, Math.min(4, available / natural)) : zoom
      const viewport = page.getViewport({ scale })
      onSize(number, { width: viewport.width, height: viewport.height })
      if (cancelled || !visible) return
      const canvas = el.querySelector('canvas') as HTMLCanvasElement
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      const ctx = canvas.getContext('2d')!
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      task = page.render({ canvas, canvasContext: ctx, viewport })
      await (task as unknown as { promise: Promise<void> }).promise.catch(() => {})
      if (cancelled) return
      const layer = el.querySelector('.reader-text') as HTMLDivElement
      layer.replaceChildren()
      layer.style.width = `${viewport.width}px`
      layer.style.height = `${viewport.height}px`
      const text = new pdfjs.TextLayer({ textContentSource: await page.getTextContent(), container: layer, viewport })
      await text.render()
    })()
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, number, zoom, available, visible, onSize])

  return (
    <div className="reader-page" data-page={number} ref={host}>
      <canvas />
      <div className="reader-text" />
      <span className="reader-page-number">{number}</span>
    </div>
  )
}

function ReaderView({ refItem, resource, jumpTo }: { refItem: ItemRef; resource: AttachedResource; jumpTo?: number }) {
  const qc = useQueryClient()
  const scroll = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<PdfDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState<Zoom>('fit')
  const [available, setAvailable] = useState(700) // width a page may use, for fitting
  const [page, setPage] = useState(resource.bookmark.page ?? 1)
  const [menu, setMenu] = useState<{ x: number; y: number; text: string; page: number } | null>(null)
  const sizes = useRef(new Map<number, PageBox>())
  const onSize = useCallback((n: number, b: PageBox) => sizes.current.set(n, b), [])

  useEffect(() => {
    let cancelled = false
    const task = pdfjs.getDocument({ url: fileUrl(resource.id), withCredentials: true })
    task.promise.then((d) => !cancelled && setDoc(d), (e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
      task.destroy()
    }
  }, [resource.id])

  // How much width a page may use, kept up to date as the window is resized.
  useEffect(() => {
    const box = scroll.current
    if (!box) return
    const measure = () => setAvailable(Math.max(120, box.clientWidth - 16))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(box)
    return () => ro.disconnect()
  }, [doc])

  const goTo = useCallback((n: number) => {
    const el = scroll.current?.querySelector(`.reader-page[data-page="${n}"]`)
    el?.scrollIntoView({ block: 'start' })
  }, [])

  // Open where you left off, or at the page a note linked to.
  const opened = useRef(false)
  useEffect(() => {
    if (!doc || opened.current) return
    opened.current = true
    const target = jumpTo ?? resource.bookmark.page
    if (target && target > 1) setTimeout(() => goTo(target), 60)
  }, [doc, jumpTo, resource.bookmark.page, goTo])
  useEffect(() => {
    if (doc && jumpTo) setTimeout(() => goTo(jumpTo), 60)
  }, [doc, jumpTo, goTo])

  // The page you're on is your bookmark, saved as you read (and counted in the session).
  const savedPage = useRef(resource.bookmark.page)
  useEffect(() => {
    if (!doc || page === savedPage.current) return
    const t = setTimeout(() => {
      savedPage.current = page
      api.saveBookmark(refItem.type, refItem.id, { resourceId: resource.id, page })
        .then(() => qc.invalidateQueries({ queryKey: keys.dashboard }), () => {})
    }, 1500)
    return () => clearTimeout(t)
  }, [page, doc, refItem.type, refItem.id, resource.id, qc])

  const onScroll = () => {
    const box = scroll.current
    if (!box) return
    // The page filling the top of the view is the one you're reading.
    const top = box.getBoundingClientRect().top + 80
    for (const el of Array.from(box.querySelectorAll('.reader-page'))) {
      const r = el.getBoundingClientRect()
      if (r.bottom > top) {
        setPage(Number((el as HTMLElement).dataset.page))
        break
      }
    }
  }

  const openMenu = (e: React.MouseEvent) => {
    const sel = (scroll.current?.ownerDocument.getSelection?.() ?? null)
    const text = tidySelection(sel?.toString() ?? '')
    if (!text) return // no selection: leave the browser's own menu alone
    e.preventDefault()
    const node = sel?.anchorNode
    const el = (node instanceof Element ? node : node?.parentElement)?.closest('.reader-page') as HTMLElement | null
    // Keep the menu inside the window, wherever the click happened.
    const box = scroll.current!.getBoundingClientRect()
    const x = Math.min(Math.max(4, e.clientX - box.left), Math.max(4, box.width - 220))
    const y = Math.min(Math.max(4, e.clientY - box.top), Math.max(4, box.height - 180))
    setMenu({ x, y, text, page: Number(el?.dataset.page ?? page) })
  }

  const send = (kind: 'text' | 'reference' | 'quote') => {
    const m = menu!
    setMenu(null)
    const md = selectionMarkdown(kind, m.text, { id: resource.id, title: resource.title, page: m.page })
    if (appendToActiveNote(md)) toast(kind === 'text' ? 'Added to your note' : kind === 'reference' ? `Added with a link to p. ${m.page}` : 'Added as a quote')
    else toast('Open a note first: a goal’s Notes tab, then New note.', 'error')
  }

  if (error) return <div className="pad"><p className="error-text">This book couldn’t be opened: {error}</p></div>
  if (!doc) return <p className="muted pad">Opening the book…</p>

  return (
    <div className="reader">
      <div className="reader-bar">
        <span className="reader-pages">Page <strong>{page}</strong> of {doc.numPages}</span>
        <div className="reader-zoom">
          <IconButton label="Zoom out" onClick={() => setZoom((z) => (z === 'fit' ? 0.8 : ZOOMS.filter((x) => x < z - 0.01).pop() ?? 0.5))}><Minus size={15} /></IconButton>
          <span>{zoom === 'fit' ? 'Fit' : `${Math.round(zoom * 100)}%`}</span>
          <IconButton label="Zoom in" onClick={() => setZoom((z) => (z === 'fit' ? 1.25 : ZOOMS.find((x) => x > z + 0.01) ?? 3))}><Plus size={15} /></IconButton>
          <Button size="sm" variant="ghost" aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')}
            title="Fit the page to the window">Fit</Button>
        </div>
        <Button size="sm" variant="ghost" title="Chrome's own viewer, in its own window, for printing or searching"
          onClick={() => openReadingWindow(`${fileUrl(resource.id)}#page=${page}`, `deskwork-book-${resource.id}`)}>
          <ExternalLink size={14} /> Browser viewer
        </Button>
      </div>
      <div className="reader-scroll" ref={scroll} onScroll={onScroll} onContextMenu={openMenu} onPointerDown={() => setMenu(null)}>
        {Array.from({ length: doc.numPages }, (_, i) => (
          <Page key={i + 1} doc={doc} number={i + 1} zoom={zoom} available={available} onSize={onSize} />
        ))}
      </div>
      {menu && (
        <div className="reader-menu" style={{ left: menu.x, top: menu.y }} role="menu" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" role="menuitem" onClick={() => send('text')}><StickyNote size={15} /> Add to note</button>
          <button type="button" role="menuitem" onClick={() => send('reference')}><Link2 size={15} /> Add with page link</button>
          <button type="button" role="menuitem" onClick={() => send('quote')}><Quote size={15} /> Add as a quote</button>
          <span className="menu-sep" />
          <button type="button" role="menuitem" onClick={() => {
            navigator.clipboard.writeText(menu.text).then(() => toast('Copied'), () => toast('Could not copy', 'error'))
            setMenu(null)
          }}>Copy</button>
        </div>
      )}
    </div>
  )
}

export function ReaderWindow({ deskRef }: { deskRef: React.RefObject<HTMLDivElement | null> }) {
  const reader = useUi((s) => s.reader)
  const detail = useDetail(reader?.type ?? 'goal', reader?.id ?? 0, !!reader)
  if (!reader) return null
  const resource = detail.data?.resources.find((r) => r.id === reader.resourceId)
  return (
    <FloatingWindow
      id="reader"
      title={resource?.title ?? 'Book'}
      icon={<BookOpen size={17} />}
      meta={detail.data?.item.title}
      closable
      onClose={() => setUi({ reader: null })}
      deskRef={deskRef}
      className="window-reader"
      defaultRect={(d) => {
        const w = Math.min(820, d.width - 32)
        return { x: Math.max(16, (d.width - w) / 2), y: 16, w, h: Math.max(400, d.height - 32) }
      }}
    >
      {detail.isPending ? <p className="muted pad">Loading…</p> : !resource ? (
        <Empty action={<Button size="sm" onClick={() => setUi({ reader: null })}>Close</Button>}>
          This book is no longer attached to the {reader.type}.
        </Empty>
      ) : !resource.hasFile ? (
        <Empty>This resource has no file uploaded.</Empty>
      ) : (
        <ReaderView key={`${reader.type}:${reader.id}:${resource.id}`} refItem={reader} resource={resource} jumpTo={reader.page} />
      )}
    </FloatingWindow>
  )
}
