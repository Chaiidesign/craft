// ── The extraction boundary ───────────────────────────────────────────────────
// An extractor turns a design image into a token proposal. Whatever sits behind
// the interface (today a mock, later a model), its output is treated as
// untrusted: runExtraction validates the image going in and the proposal coming
// out, and malformed output never reaches the review step.

import { parseProposal, type TokenProposal } from './proposal'

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const
export type ImageType = (typeof IMAGE_TYPES)[number]

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export interface DesignImage {
  name: string
  type: string
  bytes: Uint8Array
}

export interface TokenExtractor {
  readonly id: string
  /** Returns raw output. The caller validates it; an extractor is never trusted to. */
  extract(image: DesignImage, options?: { signal?: AbortSignal }): Promise<unknown>
}

export type ExtractionError =
  | { kind: 'invalid-image'; message: string }
  | { kind: 'unrecognized-image'; message: string }
  | { kind: 'extractor-failed'; message: string }
  | { kind: 'malformed-output'; message: string; issues: string[] }
  | { kind: 'cancelled'; message: string }

export type ExtractionResult = { ok: true; proposal: TokenProposal } | { ok: false; error: ExtractionError }

/** Thrown by an extractor that ran fine but has no reading for this image. */
export class UnrecognizedImageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnrecognizedImageError'
  }
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((b, i) => bytes[offset + i] === b)
}

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0))

/** Checks the declared type against the file's own signature, so a renamed
 *  file can't pass as an image. */
function contentMatchesType(bytes: Uint8Array, type: ImageType): boolean {
  switch (type) {
    case 'image/png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case 'image/jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff])
    case 'image/webp':
      return startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)
    case 'image/svg+xml': {
      const head = new TextDecoder().decode(bytes.subarray(0, 1024)).trimStart()
      return /^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)
    }
  }
}

export function validateImage(image: DesignImage): ExtractionError | null {
  if (!(IMAGE_TYPES as readonly string[]).includes(image.type)) {
    return { kind: 'invalid-image', message: `Unsupported file type "${image.type || 'unknown'}". Use PNG, JPEG, WebP or SVG.` }
  }
  if (image.bytes.byteLength === 0) {
    return { kind: 'invalid-image', message: 'The file is empty.' }
  }
  if (image.bytes.byteLength > MAX_IMAGE_BYTES) {
    return { kind: 'invalid-image', message: 'The file is larger than 10 MB.' }
  }
  if (!contentMatchesType(image.bytes, image.type as ImageType)) {
    return { kind: 'invalid-image', message: `The file's contents don't match its type (${image.type}).` }
  }
  return null
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export async function runExtraction(
  extractor: TokenExtractor,
  image: DesignImage,
  options: { signal?: AbortSignal } = {},
): Promise<ExtractionResult> {
  const invalid = validateImage(image)
  if (invalid) return { ok: false, error: invalid }

  let raw: unknown
  try {
    raw = await extractor.extract(image, options)
  } catch (error) {
    if (isAbort(error) || options.signal?.aborted) {
      return { ok: false, error: { kind: 'cancelled', message: 'Analysis cancelled.' } }
    }
    if (error instanceof UnrecognizedImageError) {
      return { ok: false, error: { kind: 'unrecognized-image', message: error.message } }
    }
    return {
      ok: false,
      error: { kind: 'extractor-failed', message: error instanceof Error ? error.message : 'The extractor failed.' },
    }
  }
  if (options.signal?.aborted) {
    return { ok: false, error: { kind: 'cancelled', message: 'Analysis cancelled.' } }
  }

  const parsed = parseProposal(raw)
  if (!parsed.ok) {
    return {
      ok: false,
      error: { kind: 'malformed-output', message: 'The extractor returned tokens that fail the schema.', issues: parsed.issues },
    }
  }
  return { ok: true, proposal: parsed.value }
}
