// Writes docs/output-system/formats.json: which formats each kind of thing can
// be exported to (D-76).
//
//   npx vite-node scripts/output-system/build-formats.ts
//
// Built exports are read from src/lib/documents/export/capabilities.ts through
// src/lib/output-system/formats.ts; kinds with no code yet are marked planned.

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { outputFormatsJson } from '../../src/lib/output-system/formats'

const path = resolve(import.meta.dirname, '../../docs/output-system/formats.json')
writeFileSync(path, outputFormatsJson())
process.stdout.write(`Wrote ${path}\n`)
