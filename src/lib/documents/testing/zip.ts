// Test-only: a minimal zip reader for .docx/.pptx files (central directory +
// stored/deflated entries via node:zlib). No new dependency.

import { inflateRawSync } from 'node:zlib'

export function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('Not a zip file: no end-of-central-directory record')
  const count = view.getUint16(eocd + 10, true)
  let at = view.getUint32(eocd + 16, true)
  const out = new Map<string, Uint8Array>()
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('Bad central directory entry')
    const method = view.getUint16(at + 10, true)
    const compressed = view.getUint32(at + 20, true)
    const nameLen = view.getUint16(at + 28, true), extraLen = view.getUint16(at + 30, true), commentLen = view.getUint16(at + 32, true)
    const local = view.getUint32(at + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen))
    const dataAt = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const data = bytes.subarray(dataAt, dataAt + compressed)
    if (method === 0) out.set(name, data.slice())
    else if (method === 8) out.set(name, new Uint8Array(inflateRawSync(data)))
    else throw new Error(`Unsupported zip method ${method} for ${name}`)
    at += 46 + nameLen + extraLen + commentLen
  }
  return out
}

export const zipText = (zip: Map<string, Uint8Array>, name: string): string => {
  const entry = zip.get(name)
  if (!entry) throw new Error(`No ${name} in archive`)
  return new TextDecoder().decode(entry)
}
