'use client'

import { useRef, useState } from 'react'

import { browserExportResources } from '@/components/documents/exportResources'
import type { Made, Turn, UploadInfo } from '@/lib/output-system/agent/loop'
import { buildFile, FORMAT_NAME, type BuiltFile } from '@/lib/output-system/files/build'
import { applyChanges, describeUpload, readUpload, UploadError, writeUpload, type Upload } from '@/lib/output-system/files/upload'
import { sampleStore, type StoreId } from '@/lib/output-system/fixtures/stores'
import { LANE_LABELS, type Lane } from '@/lib/output-system/lanes'
import formats from '../../../docs/output-system/formats.json'

import { ChartView } from './ChartView'
import { RichText } from './RichText'
import styles from './outputVerify.module.css'

// The /output-verify conversation (Session 1). One request at a time goes to
// /output-verify/model; files are built here in the browser from the sample
// store, so their rows can't differ from the store's.

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
function historyText(e: Entry): string {
  if (e.who === 'person') return e.attachment ? `${e.text}\n(Attached: ${e.attachment})` : e.text
  const m = e.made
  switch (m.kind) {
    case 'reply':
      return m.text
    case 'file':
      return e.file ? `I made the file “${e.file.fileName}” (${e.file.rows} rows).` : 'I tried to make a file, but it couldn’t be built.'
    case 'upload-change':
      return e.file ? `I changed the uploaded file and made “${e.file.fileName}”. ${e.changeSummary?.join(' ') ?? ''}` : 'I tried to change the uploaded file, but it couldn’t be done.'
    case 'chart':
      return `${m.lead}\n(Chart: ${m.chart.title}: ${m.chart.points.map((p) => `${p.label} ${p.display}`).join(', ')})`
    case 'format-options':
      return m.message
    case 'coming-later':
      return `That would be a ${m.lane === 'export' ? 'new export' : LANE_LABELS[m.lane].toLowerCase()}: ${m.summary}`
    case 'error':
      return m.message
  }
}

export function Conversation() {
  const [storeId, setStoreId] = useState<StoreId>('fernhill-goods')
  const [entries, setEntries] = useState<Entry[]>([])
  const [draft, setDraft] = useState('')
  const [upload, setUpload] = useState<Upload | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
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
    const history: Turn[] = entries.map((e) => ({ role: e.who, text: historyText(e) }))
    const currentUpload = upload
    setEntries((list) => [...list, person])
    setDraft('')
    setProgress('Working on it')
    let made: Made = { kind: 'error', message: 'Souvenir couldn’t reach the model just now. Try again in a moment.' }
    try {
      const res = await fetch('/output-verify/model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, history, request, ...(currentUpload ? { upload: describeUpload(currentUpload) as UploadInfo } : {}) }),
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
            const line = JSON.parse(buffer.slice(0, nl)) as { type: 'progress'; label: string } | { type: 'result'; made: Made }
            buffer = buffer.slice(nl + 1)
            if (line.type === 'progress') setProgress(line.label)
            else made = line.made
          }
        }
      }
    } catch {
      // keep the honest error above
    }
    if (made.kind === 'file' || made.kind === 'upload-change') setProgress('Making your file')
    const extra = await makeFile(made, storeId, currentUpload)
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

  const store = sampleStore(storeId)

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
              <Result entry={e} storeId={storeId} onFormat={(name) => send(`Make it as ${name} instead.`)} busy={busy} />
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
