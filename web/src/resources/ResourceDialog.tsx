import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { api, ApiError } from '../api.ts'
import { keys, useRefreshAll, useResources } from '../hooks.ts'
import { useFolderTree } from './ResourceBrowser.tsx'
import { setUi, useUi } from '../ui-store.ts'
import { Button, Confirm, Dialog, ErrorText, Field, toast } from '../ui.tsx'
import { KIND_LABEL, KindIcon, formatBytes, parseYouTube } from './resources.tsx'
import type { Resource, ResourceKind, VideoSource } from '../../../shared/types.ts'

const KINDS: ResourceKind[] = ['pdf', 'physical', 'video', 'link', 'note']

function uploadWithProgress(id: number, file: File, onProgress: (p: number) => void) {
  return new Promise<Resource>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', `/api/resources/${id}/file`)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name))
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onload = () => {
      const data = JSON.parse(xhr.responseText || '{}')
      if (xhr.status >= 200 && xhr.status < 300) resolve(data)
      else reject(new ApiError(xhr.status, data.error ?? 'Upload failed'))
    }
    xhr.onerror = () => reject(new ApiError(0, 'Upload failed: the server is offline'))
    xhr.send(file)
  })
}

export function ResourceDialog() {
  const editing = useUi((s) => s.resourceEditing)
  const { data: all } = useResources()
  const tree = useFolderTree()
  const qc = useQueryClient()
  const refresh = useRefreshAll()
  const existing = editing?.id ? all?.find((r) => r.id === editing.id) : undefined

  const [kind, setKind] = useState<ResourceKind>('pdf')
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [url, setUrl] = useState('')
  const [note, setNote] = useState('')
  const [pages, setPages] = useState('')
  const [videoSource, setVideoSource] = useState<'web' | 'file'>('web')
  const [file, setFile] = useState<File | null>(null)
  const [folderId, setFolderId] = useState<number | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!editing) return
    const r = existing
    setKind(r?.kind ?? 'pdf')
    setTitle(r?.title ?? '')
    setAuthor(r?.author ?? '')
    setUrl(r?.url ?? '')
    setNote(r?.note ?? '')
    setPages(r?.totalPages ? String(r.totalPages) : '')
    setVideoSource(r?.videoSource === 'file' ? 'file' : 'web')
    setFolderId(r ? r.folderId : editing.folderId ?? null)
    setFile(null)
    setProgress(null)
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, existing?.id])

  const close = () => !busy && setUi({ resourceEditing: null })
  const needsFile = kind === 'pdf' || (kind === 'video' && videoSource === 'file')
  const needsUrl = kind === 'link' || (kind === 'video' && videoSource === 'web')
  const yt = kind === 'video' && videoSource === 'web' ? parseYouTube(url) : null

  const save = async () => {
    setError(null)
    if (!title.trim()) return setError('Give the resource a title')
    if (needsUrl && !/^https?:\/\//i.test(url.trim())) return setError('Paste a full link starting with https://')
    if (needsFile && !file && !existing?.hasFile) return setError(kind === 'pdf' ? 'Choose a PDF to upload' : 'Choose a video file to upload')
    const source: VideoSource | null = kind !== 'video' ? null : videoSource === 'file' ? 'file' : yt ? 'youtube' : 'other'
    const payload: Partial<Resource> = {
      kind, title, author, note, url: needsUrl ? url.trim() : '', videoSource: source, folderId,
      totalPages: kind === 'pdf' || kind === 'physical' ? (pages ? Number(pages) : null) : null,
    }
    setBusy(true)
    try {
      let r = existing ? await api.updateResource(existing.id, payload) : await api.createResource(payload)
      if (file && needsFile) {
        setProgress(0)
        r = await uploadWithProgress(r.id, file, setProgress)
      }
      if (editing?.attachTo) await api.attach(editing.attachTo.type, editing.attachTo.id, r.id)
      qc.invalidateQueries({ queryKey: keys.resources })
      refresh()
      toast(existing ? `Saved “${r.title}”` : `Added “${r.title}”`)
      setUi({ resourceEditing: null })
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const remove = async () => {
    if (!existing) return
    try {
      await api.deleteResource(existing.id)
      qc.invalidateQueries({ queryKey: keys.resources })
      refresh()
      toast(`Deleted “${existing.title}”`)
      setConfirmDelete(false)
      setUi({ resourceEditing: null })
    } catch (e) {
      setError(e)
    }
  }

  return (
    <>
      <Dialog
        open={!!editing}
        onClose={close}
        title={existing ? existing.title : editing?.attachTo ? 'Add a resource' : 'New resource'}
        footer={<>
          {existing && <Button variant="danger" className="push-left" onClick={() => setConfirmDelete(true)} disabled={busy}>Delete</Button>}
          <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy}>{existing ? 'Save changes' : editing?.attachTo ? 'Add and attach' : 'Add resource'}</Button>
        </>}
      >
        <div className="kind-picker" role="radiogroup" aria-label="Kind of resource">
          {KINDS.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className="kind-chip"
              disabled={!!existing && existing.kind !== k} onClick={() => setKind(k)}>
              <KindIcon kind={k} /> {KIND_LABEL[k]}
            </button>
          ))}
        </div>

        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus
            placeholder={kind === 'video' ? 'Rust in 100 lectures' : kind === 'link' ? 'The Rust Book online' : 'The Rust Programming Language'} />
        </Field>

        <Field label="Folder">
          <select value={folderId ?? ''} onChange={(e) => setFolderId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">No folder</option>
            {tree.ordered.map(({ folder: f }) => <option key={f.id} value={f.id}>{tree.path(f.id)}</option>)}
          </select>
        </Field>

        {(kind === 'pdf' || kind === 'physical') && (
          <div className="field-row">
            <Field label="Author"><input value={author} onChange={(e) => setAuthor(e.target.value)} /></Field>
            <Field label="Pages" className="field-narrow">
              <input type="number" min={1} value={pages} onChange={(e) => setPages(e.target.value)} />
            </Field>
          </div>
        )}

        {kind === 'video' && (
          <div className="segmented" role="radiogroup" aria-label="Where the video lives">
            <button type="button" role="radio" aria-checked={videoSource === 'web'} onClick={() => setVideoSource('web')} disabled={!!existing && existing.videoSource === 'file'}>
              YouTube or web link
            </button>
            <button type="button" role="radio" aria-checked={videoSource === 'file'} onClick={() => setVideoSource('file')} disabled={!!existing && existing.videoSource !== 'file'}>
              Upload a file
            </button>
          </div>
        )}

        {needsUrl && (
          <Field
            label="Link"
            hint={kind === 'video'
              ? url.trim() && (yt ? 'YouTube video: plays here and remembers where you stopped.' : 'Opens in a new tab. You note where you stopped when completing.')
              : undefined}
          >
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
          </Field>
        )}

        {needsFile && (
          <Field label={kind === 'pdf' ? 'PDF file' : 'Video file'}
            hint={existing?.hasFile && !file ? `Current file: ${existing.fileName} (${formatBytes(existing.fileSize ?? 0)}). Choose another to replace it.` : undefined}>
            <span className="file-input">
              <Upload size={16} aria-hidden />
              <span>{file ? `${file.name} (${formatBytes(file.size)})` : 'Choose a file…'}</span>
              <input type="file" accept={kind === 'pdf' ? 'application/pdf,.pdf' : 'video/*'}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </span>
          </Field>
        )}

        {progress != null && (
          <div className="upload-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${progress * 100}%` }} />
            <span>Uploading {Math.round(progress * 100)}%</span>
          </div>
        )}

        <Field label={kind === 'note' ? 'Note' : 'Notes'} hint={kind === 'physical' ? 'Where it is, edition, anything useful.' : undefined}>
          <textarea rows={kind === 'note' ? 5 : 2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <ErrorText error={error} />
      </Dialog>
      <Confirm open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={remove}
        title={`Delete “${existing?.title}”?`} confirmLabel="Delete resource">
        <p>It will be detached from every goal and task, and its saved positions are lost.{existing?.hasFile ? ' The uploaded file is deleted too.' : ''}</p>
      </Confirm>
    </>
  )
}
