'use client'

import { useRef, useState } from 'react'

import { browserExportResources } from '@/components/documents/exportResources'
import { FORMAT_LABEL } from '@/lib/documents/export/capabilities'
import { exportDocument } from '@/lib/documents/generation/tools'
import type { DocumentEnv, ExportFormat } from '@/lib/documents/model'
import { emptyStore, getRevision, type RevisionStore } from '@/lib/documents/revisions'
import { parseSession, serializeSession } from '@/lib/documents/session'
import type { Made, Turn, UploadInfo } from '@/lib/output-system/agent/loop'
import { buildFile, FORMAT_NAME, type BuiltFile } from '@/lib/output-system/files/build'
import { applyChanges, describeUpload, readUpload, UploadError, writeUpload, type Upload } from '@/lib/output-system/files/upload'
import { sampleStore, type StoreId } from '@/lib/output-system/fixtures/stores'
import { LANE_LABELS, type Lane } from '@/lib/output-system/lanes'
import { documentName, madeText } from '@/lib/output-system/history'
import { kindName } from '@/lib/output-system/strict'
import formats from '../../../docs/output-system/formats.json'

import { DocumentCard, type DownloadState } from '../document-chat/DocumentCard'
import { ChartView } from './ChartView'
import { RichText } from './RichText'
import styles from './outputVerify.module.css'

// The /output-verify conversation (Sessions 1 and 2). One request at a time goes
// to /output-verify/model; files are built here in the browser from the sample
// store, so their rows can't differ from the store's. Documents and all their
// versions live here too, in the engine's own saved-session format, and go back
// with each request so a follow-up can change the current one; exports are made
// here, of the exact version asked for.

type Entry =
  | { id: number; who: 'person'; text: string; attachment?: string }
  | { id: number; who: 'souvenir'; made: Made; file?: BuiltFile; fileError?: string; changeSummary?: string[] }

type FormatInfo = { label: string; status: 'built' | 'planned' }
const FORMAT_TABLE = formats.formats as Record<string, FormatInfo>

/** Whether a kind can be exported in a format today, by the format's name ("PDF", "Excel"). */
function isBuiltFor(thing: Lane, name: string): boolean {
  const key = Object.entries(FORMAT_TABLE).find(([k, v]) => v.label.toLowerCase() === name.toLowerCase() || k === name.toLowerCase())?.[0]
  const kind = (formats.kinds as Record<string, { built?: { exports: { format: string; supported: boolean }[] } }>)[thing]
  return !!key && !!kind?.built?.exports.some((e) => e.format === key && e.supported)
}

const env: DocumentEnv = { now: () => new Date().toISOString(), nextId: (p) => `${p}-${crypto.randomUUID().slice(0, 8)}` }

const sizeText = (bytes: number) => (bytes < 1024 ? `${bytes} bytes` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)

function download(file: BuiltFile) {
  const url = URL.createObjectURL(new Blob([file.bytes as BlobPart], { type: file.mimeType }))
  const a = document.createElement('a')
  a.href = url
  a.download = file.fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** What Souvenir's turn says when it goes back to the model as history. */
function historyText(e: Entry, revisions: RevisionStore): string {
  if (e.who === 'person') return e.attachment ? `${e.text}\n(Attached: ${e.attachment})` : e.text
  return madeText(e.made, revisions, e.file ? { fileName: e.file.fileName, rows: e.file.rows } : undefined, e.changeSummary)
}

export function Conversation() {
  const [storeId, setStoreId] = useState<StoreId>('fernhill-goods')
  const [entries, setEntries] = useState<Entry[]>([])
  const [draft, setDraft] = useState('')
  const [upload, setUpload] = useState<Upload | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [revisions, setRevisions] = useState<RevisionStore>(emptyStore)
  const [currentDoc, setCurrentDoc] = useState<string | null>(null)
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({})
  const nextId = useRef(1)
  const fileInput = useRef<HTMLInputElement>(null)
  const busy = progress !== null

  async function makeFile(made: Made, store: StoreId, currentUpload: Upload | null): Promise<Partial<Extract<Entry, { who: 'souvenir' }>>> {
    try {
      if (made.kind === 'file') {
        const file = await buildFile(sampleStore(store), made.spec, { resources: (s) => browserExportResources(s) })
        return { file }
      }
      if (made.kind === 'upload-change' && currentUpload) {
        const { upload: changed, summary } = applyChanges(currentUpload, made.changes)
        const bytes = writeUpload(changed)
        const fileName = currentUpload.fileName.replace(/(\.[a-z]+)$/i, ' (changed)$1')
        return { file: { fileName, format: currentUpload.format, mimeType: currentUpload.format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes, rows: changed.rows.length, title: fileName }, changeSummary: summary }
      }
    } catch (e) {
      return { fileError: e instanceof UploadError ? e.message : 'The file couldn’t be made from this request. Try asking again.' }
    }
    return {}
  }

  async function send(text: string) {
    const request = text.trim()
    if (!request || busy) return
    const person: Entry = { id: nextId.current++, who: 'person', text: request, ...(upload ? { attachment: upload.fileName } : {}) }
    const history: Turn[] = entries.map((e) => ({ role: e.who, text: historyText(e, revisions) }))
    const documents = revisions.documents.size > 0 ? { session: serializeSession({ store: revisions, exports: { records: [], events: [] }, deckId: null }), current: currentDoc } : undefined
    let nextRevisions = revisions
    const currentUpload = upload
    setEntries((list) => [...list, person])
    setDraft('')
    setProgress('Working on it')
    let made: Made = { kind: 'error', message: 'Souvenir couldn’t reach the model just now. Try again in a moment.' }
    try {
      const res = await fetch('/output-verify/model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, history, request, ...(currentUpload ? { upload: describeUpload(currentUpload) as UploadInfo } : {}), ...(documents ? { documents } : {}) }),
      })
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        made = { kind: 'error', message: body?.error ?? made.message }
      } else {
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let nl
          while ((nl = buffer.indexOf('\n')) >= 0) {
            const line = JSON.parse(buffer.slice(0, nl)) as { type: 'progress'; label: string } | { type: 'result'; made: Made; documents?: string }
            buffer = buffer.slice(nl + 1)
            if (line.type === 'progress') setProgress(line.label)
            else {
              made = line.made
              const loaded = line.documents ? parseSession(line.documents, env) : null
              if (loaded?.status === 'loaded') nextRevisions = loaded.session.store
            }
          }
        }
      }
    } catch {
      // keep the honest error above
    }
    if (made.kind === 'file' || made.kind === 'upload-change') setProgress('Making your file')
    const extra = await makeFile(made, storeId, currentUpload)
    // A document is shown only if its version really arrived.
    if (made.kind === 'document' && !nextRevisions.revisions.has(made.revisionId)) made = { kind: 'error', message: 'Souvenir couldn’t put this together correctly. Nothing was changed. Try asking again.' }
    if (made.kind === 'document') {
      setRevisions(nextRevisions)
      setCurrentDoc(made.outputId)
    }
    setEntries((list) => [...list, { id: nextId.current++, who: 'souvenir', made, ...extra }])
    setProgress(null)
  }

  async function attach(files: FileList | null) {
    setUploadError(null)
    const f = files?.[0]
    if (!f) return
    try {
      setUpload(readUpload(f.name, new Uint8Array(await f.arrayBuffer())))
    } catch (e) {
      setUpload(null)
      setUploadError(e instanceof UploadError ? e.message : 'That file couldn’t be read. Upload a CSV or Excel (.xlsx) file.')
    }
    if (fileInput.current) fileInput.current.value = ''
  }

  /** Downloads exactly the version asked for, made here with the engine's exporters. */
  async function exportVersion(revisionId: string, format: ExportFormat) {
    setDownloads((d) => ({ ...d, [revisionId]: { format, status: 'working' } }))
    const out = await exportDocument({ revisionId, format }, { store: revisions, env, resources: browserExportResources })
    if (!out.ok) {
      setDownloads((d) => ({ ...d, [revisionId]: { format, status: 'failed', message: out.error.message } }))
      return
    }
    download({ fileName: out.result.filename, mimeType: out.result.mimeType, bytes: out.result.bytes } as BuiltFile)
    setDownloads((d) => ({ ...d, [revisionId]: null }))
  }

  const store = sampleStore(storeId)
  // The newest entry for each document shows it open; older versions start folded.
  const latestEntry = new Map<string, number>()
  for (const e of entries) if (e.who === 'souvenir' && e.made.kind === 'document') latestEntry.set(e.made.outputId, e.id)

  return (
    <section aria-labelledby="request-heading" className={styles.section}>
      <h2 id="request-heading" className={styles.heading}>Your request</h2>
      <fieldset className={styles.storePicker} disabled={busy || entries.length > 0}>
        <legend className={styles.note}>Store</legend>
        {(['fernhill-goods', 'saffron-loom'] as StoreId[]).map((id) => (
          <label key={id} className={styles.storeOption}>
            <input type="radio" name="store" value={id} checked={storeId === id} onChange={() => setStoreId(id)} />
            {sampleStore(id).name} ({sampleStore(id).currency})
          </label>
        ))}
      </fieldset>

      <ol className={styles.thread} aria-live="polite">
        {entries.map((e) =>
          e.who === 'person' ? (
            <li key={e.id} className={styles.person}>
              <p className={styles.personText}>{e.text}</p>
              {e.attachment ? <p className={styles.attachment}>Attached: {e.attachment}</p> : null}
            </li>
          ) : (
            <li key={e.id} className={styles.souvenir}>
              {e.made.kind === 'document' || e.made.kind === 'export' ? (
                <DocumentResult made={e.made} revisions={revisions} latest={e.made.kind === 'document' && latestEntry.get(e.made.outputId) === e.id} download={downloads[e.made.revisionId] ?? null} onDownload={(format) => void exportVersion(e.made.kind === 'document' || e.made.kind === 'export' ? e.made.revisionId : '', format)} />
              ) : (
                <Result entry={e} storeId={storeId} onFormat={(name) => send(`Make it as ${name} instead.`)} busy={busy} />
              )}
            </li>
          ),
        )}
        {progress ? (
          <li className={styles.souvenir}>
            <p className={styles.progress} role="status">{progress}…</p>
          </li>
        ) : null}
      </ol>

      <form
        className={styles.composer}
        onSubmit={(ev) => {
          ev.preventDefault()
          void send(draft)
        }}
      >
        <label htmlFor="request" className={styles.visuallyHidden}>Your request</label>
        <textarea
          id="request"
          className={styles.request}
          rows={3}
          value={draft}
          disabled={busy}
          onChange={(ev) => setDraft(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter' && !ev.shiftKey) {
              ev.preventDefault()
              void send(draft)
            }
          }}
          placeholder={storeId === 'saffron-loom' ? 'For example: What were my top 3 products over the last 12 months?' : 'For example: Export last month’s orders as Excel.'}
        />
        <div className={styles.composerRow}>
          <label className={styles.attach}>
            <input ref={fileInput} type="file" accept=".csv,.xlsx" className={styles.visuallyHidden} disabled={busy} onChange={(ev) => void attach(ev.target.files)} />
            <span>{upload ? `Attached: ${upload.fileName} (${upload.rows.length} rows)` : 'Attach a CSV or Excel file'}</span>
          </label>
          {upload ? (
            <button type="button" className={styles.textButton} onClick={() => setUpload(null)} disabled={busy}>Remove</button>
          ) : null}
          <button type="submit" className={styles.primary} disabled={busy || !draft.trim()}>Send</button>
        </div>
        {uploadError ? <p className={styles.error} role="alert">{uploadError}</p> : null}
        <p className={styles.note}>Sample data runs to 30 Sept 2026, so “last month” means September 2026. {store.name} uses {store.currency}.</p>
      </form>
    </section>
  )
}

function DocumentResult({ made, revisions, latest, download, onDownload }: {
  made: Extract<Made, { kind: 'document' | 'export' }>
  revisions: RevisionStore
  latest: boolean
  download: DownloadState
  onDownload: (format: ExportFormat) => void
}) {
  const snapshot = getRevision(revisions, made.revisionId).snapshot
  const name = documentName(snapshot)
  if (made.kind === 'export') {
    return (
      <div className={styles.card}>
        <p className={styles.cardTitle}>{name}, version {made.version}</p>
        <p className={styles.cardMeta}>{FORMAT_LABEL[made.format]}</p>
        <button type="button" className={styles.primary} disabled={download?.status === 'working'} onClick={() => onDownload(made.format)}>
          {download?.status === 'working' ? 'Making the file…' : `Download ${FORMAT_LABEL[made.format]}`}
        </button>
        {download?.status === 'failed' ? <p className={styles.error} role="alert">{FORMAT_LABEL[download.format]} download failed: {download.message}</p> : null}
      </div>
    )
  }
  return (
    <div className={styles.documentReply}>
      <p className={styles.documentLead}>{made.created ? `Here is your ${kindName(made.docKind)}.` : `Version ${made.version}: ${made.changeSummary.charAt(0).toLowerCase()}${made.changeSummary.slice(1)}.`}</p>
      {made.followUp ? <p className={styles.documentLead}>{made.followUp}</p> : null}
      <DocumentCard snapshot={snapshot} title={name} version={made.version} current={latest} onDownload={onDownload} download={download} />
    </div>
  )
}

function Result({ entry, storeId, onFormat, busy }: { entry: Extract<Entry, { who: 'souvenir' }>; storeId: StoreId; onFormat: (name: string) => void; busy: boolean }) {
  const m = entry.made
  switch (m.kind) {
    case 'chart': {
      const palette = sampleStore(storeId).brand.palette
      return (
        <div className={styles.chartReply}>
          <RichText text={m.lead} />
          <ChartView chart={m.chart} accent={palette.accent} ink={palette.ink} muted={palette.muted} />
        </div>
      )
    }
    case 'reply':
      return <RichText text={m.text} />
    case 'file':
    case 'upload-change':
      if (entry.fileError || !entry.file) return <p className={styles.error}>{entry.fileError ?? 'The file couldn’t be made.'}</p>
      return (
        <div className={styles.card}>
          <p className={styles.cardTitle}>{entry.file.fileName}</p>
          <p className={styles.cardMeta}>
            {FORMAT_NAME[entry.file.format as keyof typeof FORMAT_NAME] ?? entry.file.format.toUpperCase()} · {entry.file.rows} {entry.file.rows === 1 ? 'row' : 'rows'} · {sizeText(entry.file.bytes.byteLength)}
          </p>
          {entry.changeSummary?.length ? (
            <ul className={styles.changes}>{entry.changeSummary.map((s) => <li key={s}>{s}</li>)}</ul>
          ) : null}
          {m.note ? <p className={styles.cardNote}>{m.note}</p> : null}
          <button type="button" className={styles.primary} onClick={() => download(entry.file!)}>Download</button>
        </div>
      )
    case 'format-options':
      return (
        <div className={styles.card}>
          <p className={styles.cardTitle}>{m.requestedFormat} isn’t available for this</p>
          <p className={styles.cardNote}>{m.message}</p>
          <div className={styles.formatButtons}>
            {m.offered.map((name) =>
              isBuiltFor(m.thing, name) ? (
                <button key={name} type="button" className={styles.secondary} disabled={busy} onClick={() => onFormat(name)}>{name}</button>
              ) : (
                <button key={name} type="button" className={styles.secondary} disabled aria-describedby={`later-${entry.id}`}>{name} · Coming later</button>
              ),
            )}
          </div>
        </div>
      )
    case 'coming-later':
      return (
        <div className={styles.card}>
          <p className={styles.cardTitle}>{m.lane === 'export' ? 'Exports of made things' : LANE_LABELS[m.lane]}: coming later</p>
          <p className={styles.cardNote}>Souvenir would make this: {m.summary} This kind isn’t ready in the prototype yet.</p>
        </div>
      )
    case 'error':
      return <p className={styles.error} role="alert">{m.message}</p>
  }
}
