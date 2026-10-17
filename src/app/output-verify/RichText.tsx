import { Fragment, type ReactNode } from 'react'

import styles from './outputVerify.module.css'

// A small, safe renderer for chat replies: paragraphs, bulleted and numbered
// lists, headings and **bold**. It builds React elements from text and never
// sets HTML, so a reply can't inject markup. A paragraph line followed
// directly by list lines (no blank line between) still becomes a paragraph and
// a list.

const BULLET = /^\s*[-*•]\s+/
const NUMBER = /^\s*\d+[.)]\s+/

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
  )
}

type Run = { kind: 'p' | 'ul' | 'ol' | 'h'; lines: string[] }

/** Splits text into runs: consecutive bullet lines, numbered lines, headings, or paragraph lines. */
export function toRuns(text: string): Run[] {
  const runs: Run[] = []
  for (const block of text.trim().split(/\n\s*\n/)) {
    let current: Run | null = null
    for (const raw of block.split('\n')) {
      const line = raw.trimEnd()
      if (!line.trim()) continue
      const kind: Run['kind'] = BULLET.test(line) ? 'ul' : NUMBER.test(line) ? 'ol' : /^#{1,4}\s/.test(line) ? 'h' : 'p'
      if (!current || current.kind !== kind || kind === 'h') {
        current = { kind, lines: [] }
        runs.push(current)
      }
      current.lines.push(kind === 'ul' ? line.replace(BULLET, '') : kind === 'ol' ? line.replace(NUMBER, '') : kind === 'h' ? line.replace(/^#{1,4}\s+/, '') : line)
    }
  }
  return runs
}

export function RichText({ text }: { text: string }) {
  return (
    <div className={styles.reply}>
      {toRuns(text).map((run, i) => {
        if (run.kind === 'ul') return <ul key={i}>{run.lines.map((l, j) => <li key={j}>{inline(l)}</li>)}</ul>
        if (run.kind === 'ol') return <ol key={i}>{run.lines.map((l, j) => <li key={j}>{inline(l)}</li>)}</ol>
        if (run.kind === 'h') return <p key={i} className={styles.replyHeading}>{inline(run.lines[0])}</p>
        return <p key={i}>{run.lines.flatMap((l, j) => (j ? [<br key={`b${j}`} />, ...inline(l)] : inline(l)))}</p>
      })}
    </div>
  )
}
