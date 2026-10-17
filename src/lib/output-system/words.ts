// Words that must not reach the person (D-70). Two lists:
// - system words, which describe how Souvenir works inside rather than what
//   the person made (the prompt's "Words on screen" rule);
// - names the concept map rejected for the thing made and its changes
//   (docs/conceptual-model/document-generation.md on chore/doc-gen-baseline).
// The guides are checked in full, since Souvenir reads them and any line may
// end up in a reply. Editor references (tokens.json keys, file paths) are
// allowed: they name where a value lives, not how Souvenir works. "draft" is allowed as a verb or adjective ("draft it", "Draft"
// status, "Draft") but not as a noun for the thing made ("the draft").

// File formats the person names (JSON, CSV) are their words, not system words,
// so they are not listed. "code" and "model" are allowed in store and business
// terms: a discount code, a business model.
export const SYSTEM_WORDS = ['skill', 'sandbox', 'tool', 'template', 'code', 'python', 'prompt', 'model', 'router', 'routing', 'lane', 'engine']

export const REJECTED_NAMES = ['artifact', 'artefact', 'output', 'generated file', 'revision']

export type WordHit = { line: number; word: string; text: string }

const ALLOWED_BEFORE: Record<string, string> = {
  code: 'discount|promo|coupon|gift|voucher|zip|postal|post|country|currency|tracking|qr|bar|hex|colour|color|product|sku|style|referral',
  model: 'business|pricing|revenue|subscription|product|fit',
  engine: 'search',
}
const pattern = (word: string) => {
  const allowed = ALLOWED_BEFORE[word] ? `(?<!(${ALLOWED_BEFORE[word]})[\\s-])` : ''
  return new RegExp(`${allowed}\\b${word.replace(/ /g, '\\s+')}s?\\b`, 'i')
}
// Lower-case only: "Draft" with a capital is the readiness status ("still a Draft").
const DRAFT_NOUN = /\b([Tt]he|[Aa]|[Yy]our|[Tt]his|[Tt]hat|[Nn]ew)\s+drafts?\b(?!\s+(status|state|marker|label))/

/** Lines (1-based) that use a system word or a rejected name. */
export function findForbiddenWords(text: string): WordHit[] {
  const hits: WordHit[] = []
  text.split('\n').forEach((line, i) => {
    for (const word of [...SYSTEM_WORDS, ...REJECTED_NAMES]) {
      if (pattern(word).test(line)) hits.push({ line: i + 1, word, text: line.trim() })
    }
    if (DRAFT_NOUN.test(line)) hits.push({ line: i + 1, word: 'draft (noun)', text: line.trim() })
  })
  return hits
}
