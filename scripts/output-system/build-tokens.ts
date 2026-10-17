// Writes docs/output-system/tokens.json from the document engine's tokens (D-69).
//
//   npx vite-node scripts/output-system/build-tokens.ts
//
// The values come from src/lib/output-system/tokens.ts, which reads
// src/lib/documents/tokens.ts, theme.ts and templates/brand.ts.

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { outputTokensJson } from '../../src/lib/output-system/tokens'

const path = resolve(import.meta.dirname, '../../docs/output-system/tokens.json')
writeFileSync(path, outputTokensJson())
process.stdout.write(`Wrote ${path}\n`)
