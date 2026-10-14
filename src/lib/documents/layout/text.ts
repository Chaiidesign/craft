// Line breaking with real font metrics. Breaks at spaces, after hyphens,
// dashes and slashes, and at explicit newlines; never at a no-break space and
// never between differently styled pieces that touch (a citation marker stays
// with its word). A word wider than the line is broken between characters
// rather than allowed to overflow. Output lines are rendered verbatim by every
// renderer, so all of them wrap identically.

import { measureWidth, type FontSet } from '../metrics'
import type { TextStyle } from '../tokens'

export interface Span {
  text: string
  style: TextStyle
}

export interface Segment {
  text: string
  style: TextStyle
  /** Points, letter-spacing included. */
  width: number
}

export interface Line {
  segments: readonly Segment[]
  width: number
}

type Piece = { text: string; style: TextStyle }
type Token = { kind: 'word'; pieces: Piece[] } | { kind: 'space'; style: TextStyle } | { kind: 'newline' }

const BREAK_AFTER = /[-‐–—/]/

/** Words are glued runs of pieces between break opportunities. */
function tokenize(spans: readonly Span[]): Token[] {
  const tokens: Token[] = []
  let word: Piece[] = []
  const endWord = () => { if (word.length) { tokens.push({ kind: 'word', pieces: word }); word = [] } }
  const addChar = (ch: string, style: TextStyle) => {
    const last = word[word.length - 1]
    if (last && last.style === style) last.text += ch
    else word.push({ text: ch, style })
  }
  for (const span of spans) {
    for (const ch of span.text) {
      if (ch === '\n') { endWord(); tokens.push({ kind: 'newline' }); continue }
      if (ch === ' ' || ch === '\t') { endWord(); tokens.push({ kind: 'space', style: span.style }); continue }
      const hadText = word.some((p) => p.text.length > 0)
      addChar(ch, span.style)
      if (BREAK_AFTER.test(ch) && hadText) endWord()
    }
  }
  endWord()
  return tokens
}

export function measure(fonts: FontSet, text: string, style: TextStyle): number {
  if (!text) return 0
  const { metrics } = fonts.face(style.role, style.weight, style.style)
  return measureWidth(style.uppercase ? text.toUpperCase() : text, metrics, style.sizePt, style.letterSpacingEm)
}

function push(line: Segment[], text: string, style: TextStyle, width: number) {
  const last = line[line.length - 1]
  if (last && last.style === style) line[line.length - 1] = { text: last.text + text, style, width: last.width + width }
  else line.push({ text, style, width })
}

const lineOf = (segments: Segment[]): Line => ({ segments, width: segments.reduce((w, s) => w + s.width, 0) })

/**
 * Break spans into lines no wider than `maxWidth` (pt). Throws MissingGlyphError
 * when a face cannot draw a character. Empty input yields no lines. A space is
 * only committed when the following word lands on the same line, so no line
 * carries leading or trailing spaces.
 */
export function breakLines(fonts: FontSet, spans: readonly Span[], maxWidth: number): Line[] {
  const limit = maxWidth + 1e-6
  const lines: Line[] = []
  let current: Segment[] = []
  let width = 0
  let pending: Segment | null = null
  const newLine = () => { lines.push(lineOf(current)); current = []; width = 0; pending = null }

  for (const token of tokenize(spans)) {
    if (token.kind === 'newline') { newLine(); continue }
    if (token.kind === 'space') {
      if (current.length && !pending) pending = { text: ' ', style: token.style, width: measure(fonts, ' ', token.style) }
      continue
    }
    const pieces = token.pieces.map((p) => ({ ...p, width: measure(fonts, p.text, p.style) }))
    const w = pieces.reduce((sum, p) => sum + p.width, 0)
    const space: Segment | null = current.length ? pending : null
    if (width + (space?.width ?? 0) + w <= limit) {
      if (space) push(current, ' ', space.style, space.width)
      for (const p of pieces) push(current, p.text, p.style, p.width)
      width += (space?.width ?? 0) + w
      pending = null
      continue
    }
    if (current.length) newLine()
    if (w <= limit) {
      for (const p of pieces) push(current, p.text, p.style, p.width)
      width = w
      continue
    }
    // The word alone is wider than a line: break it between characters.
    for (const p of pieces) {
      for (const ch of p.text) {
        const cw = measure(fonts, ch, p.style)
        if (current.length && width + cw > limit) newLine()
        push(current, ch, p.style, cw)
        width += cw
      }
    }
  }
  if (current.length) lines.push(lineOf(current))
  return lines
}

/** Widest unbroken line, for sizing columns to content. */
export function naturalWidth(fonts: FontSet, spans: readonly Span[]): number {
  return Math.max(0, ...breakLines(fonts, spans, Number.POSITIVE_INFINITY).map((l) => l.width))
}
