// ── Editing tokens as text ────────────────────────────────────────────────────
// Every token is edited as one line of text in a short, readable format. These
// functions turn a value into that text and parse it back; the parsed value then
// goes through the token's own schema, so an edit can never produce a value an
// extractor wouldn't be allowed to return.

import { parseTokenValue, tokenField, type ParseResult, type ShadowLayer, type TextStyle, type TokenPath } from './tokens'

type Kind = 'color' | 'length' | 'fontStack' | 'textStyle' | 'shadow'

export function tokenKind(path: TokenPath): Kind {
  switch (tokenField(path).group) {
    case 'color':
      return 'color'
    case 'font':
      return 'fontStack'
    case 'type':
      return 'textStyle'
    case 'shadow':
      return 'shadow'
    default:
      return 'length'
  }
}

/** The format, shown as a hint under the field. */
export const FORMAT_HINT: Record<Kind, string> = {
  color: 'Hex, e.g. #1A2B3C (or #1A2B3C80 with alpha)',
  length: 'Pixels, e.g. 16',
  fontStack: 'Comma-separated, ending in a generic family, e.g. Inter, Arial, sans-serif',
  textStyle: 'font size/line-height weight tracking, e.g. body 15/1.5 400 0em',
  shadow: 'x y blur spread color per layer, comma-separated, e.g. 0 1 2 0 #00000014 — or none',
}

const formatShadow = (layers: ShadowLayer[]) =>
  layers.length === 0 ? 'none' : layers.map((l) => `${l.x} ${l.y} ${l.blur} ${l.spread} ${l.color}`).join(', ')

const formatTextStyle = (s: TextStyle) => `${s.font} ${s.size}/${s.lineHeight} ${s.weight} ${s.letterSpacing}em`

/** Text for the editor. A missing value is an empty field, never a placeholder value. */
export function formatTokenValue(path: TokenPath, value: unknown): string {
  if (value === null || value === undefined) return ''
  switch (tokenKind(path)) {
    case 'color':
      return String(value)
    case 'length':
      return String(value)
    case 'fontStack':
      return (value as string[]).join(', ')
    case 'textStyle':
      return formatTextStyle(value as TextStyle)
    case 'shadow':
      return formatShadow(value as ShadowLayer[])
  }
}

const fail = (message: string): ParseResult<never> => ({ ok: false, issues: [message] })
const strictNumber = (s: string) => (/^-?\d+(?:\.\d+)?$/.test(s) ? Number(s) : Number.NaN)

function parseRaw(kind: Kind, text: string): ParseResult<unknown> {
  switch (kind) {
    case 'color':
      return { ok: true, value: text.startsWith('#') ? text.toUpperCase() : text }
    case 'length': {
      const n = strictNumber(text.replace(/px$/i, ''))
      return Number.isNaN(n) ? fail('Enter a number of pixels, e.g. 16') : { ok: true, value: n }
    }
    case 'fontStack':
      return { ok: true, value: text.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean) }
    case 'textStyle': {
      const m = /^(body|heading)\s+(\S+)\/(\S+)\s+(\S+)\s+(\S+?)(?:em)?$/i.exec(text)
      if (!m) return fail(`Use the format: ${FORMAT_HINT.textStyle}`)
      const [size, lineHeight, weight, letterSpacing] = [m[2].replace(/px$/i, ''), m[3], m[4], m[5]].map(strictNumber)
      if ([size, lineHeight, weight, letterSpacing].some(Number.isNaN)) return fail(`Use the format: ${FORMAT_HINT.textStyle}`)
      return { ok: true, value: { font: m[1].toLowerCase(), size, lineHeight, weight, letterSpacing } }
    }
    case 'shadow': {
      if (/^none$/i.test(text)) return { ok: true, value: [] }
      const layers: ShadowLayer[] = []
      for (const part of text.split(',').map((s) => s.trim())) {
        const bits = part.split(/\s+/)
        if (bits.length !== 5) return fail(`Each layer needs x y blur spread color. ${FORMAT_HINT.shadow}`)
        const [x, y, blur, spread] = bits.slice(0, 4).map((b) => strictNumber(b.replace(/px$/i, '')))
        if ([x, y, blur, spread].some(Number.isNaN)) return fail(`Each layer needs x y blur spread color. ${FORMAT_HINT.shadow}`)
        layers.push({ x, y, blur, spread, color: bits[4].toUpperCase() })
      }
      return { ok: true, value: layers }
    }
  }
}

/** Parses editor text into a token value and validates it against the token's schema. */
export function parseTokenInput(path: TokenPath, input: string): ParseResult<unknown> {
  const text = input.trim()
  if (text === '') return fail('Enter a value. A token can’t be left empty.')
  const raw = parseRaw(tokenKind(path), text)
  if (!raw.ok) return raw
  return parseTokenValue(path, raw.value)
}
