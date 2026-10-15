# Decisions: image-to-design-system pipeline

Decisions made while building the first vertical slice of the image-to-design-system pipeline on branch `feat/image-to-design-system` (off `main`). They are numbered, dated (UTC) and listed newest first.

**Status.** The build ran overnight without a reviewer. Its brief said: "Uncovered choice: pick the senior-engineer option, record it, keep going." So every entry here is **proposed**: the builder's choice, recorded for Chaitanya and Instinct to approve or overturn. None is approved yet. Once a later decision replaces an earlier one, the earlier entry is marked **superseded by D-n** and kept.

**Numbering.** PR #1 (`feat/document-quality`) keeps its own log in `docs/decisions.md`, which runs to D-46 and isn't on `main` yet. This log starts at D-47 so the two never share a number. It lives in its own file so merging both branches can't conflict on the log.

---

## Step 1: the token-extraction boundary

### D-52 · 2026-10-15 · The offline mock recognizes images by content hash and never invents a reading
`createMockExtractor()` identifies the three committed sample images (`public/design-system-samples/*.svg`) by the SHA-256 of their bytes, so re-uploading a sample works the same as choosing it. For any other image it reports "unrecognized" and returns no tokens. Each canned reading includes low-confidence and missing tokens, so the flagging path runs on real data:
- **Night Console** has no card or raised shadow (on a dark, flat design a shadow can't be read) and a low-confidence body font.
- **Ledger** and **Soft Bloom** each extrapolate a raised shadow with low confidence.

The samples' `.gitattributes` turns off line-ending conversion, so a Windows checkout keeps the bytes and the hashes stay valid. A test fails if a sample file changes without its hash.
Applied in: `src/lib/design-system/mock-extractor.ts`, `public/design-system-samples/`.

### D-51 · 2026-10-15 · Extractor output is untrusted, even from the mock
`TokenExtractor.extract()` returns `unknown`. `runExtraction()` is the only way in:
1. It checks the image: PNG, JPEG, WebP or SVG; not empty; at most 10 MB; and the bytes must match the declared type (a renamed text file is refused).
2. It runs the extractor.
3. It validates the output against the proposal schema.

It returns one of five typed errors: `invalid-image`, `unrecognized-image`, `extractor-failed`, `malformed-output` (with the schema issues) or `cancelled` (an `AbortSignal` is honoured). Malformed output never reaches review. A model-backed extractor can replace the mock without touching anything downstream.
Applied in: `src/lib/design-system/extractor.ts`.

### D-50 · 2026-10-15 · A proposal is a different shape from applied tokens
- **A proposal** carries, for every token, `{ value | null, confidence: high | medium | low, assumption }`, plus a summary of the image and image-wide assumptions such as "1 image pixel = 1 CSS pixel". The rules:
  - Every token key must be present. A missing key is malformed output; `null` is the honest "couldn't read it".
  - `null` is only allowed with `low` confidence.
  - Every token states what it assumed.
- **Applied tokens** (`DesignTokens`) are complete, with no nulls, and must pass cross-field rules:
  - Spacing grows strictly from XS to XL.
  - Radii never shrink from S to pill.
  - Type sizes run caption ≤ body ≤ title.

Converting a proposal into applied tokens is the review step's job (Step 4). Nothing has a default.
Applied in: `src/lib/design-system/proposal.ts`, `tokens.ts`.

### D-49 · 2026-10-15 · Token schema: one registry, strict and canonical
`TOKEN_GROUPS` in `tokens.ts` names all 29 tokens:
- 8 colors: background, surface, text, muted text, primary, text on primary, border, focus.
- 2 font stacks: body and heading.
- 4 text styles: caption, body, label, title.
- 5 spacing steps.
- 4 radii.
- 2 shadows: card and raised.
- 2 sizes: icon and control height.

The proposal schema, applied schema, review list and CSS variables all derive from that registry. The rules:
- All objects are strict, so unknown keys are rejected.
- Colors are `#RRGGBB` or `#RRGGBBAA` only.
- Lengths are finite, non-negative numbers in px with an upper bound, never CSS strings.
- Shadows are structured layers `{x, y, blur, spread, color}`, never CSS strings. An empty list means a deliberately flat design.
- Font weights are 100–900 in steps of 100.
- A font stack must end in a generic family. Family names allow only letters, digits, spaces and hyphens, so a value can't inject CSS.

Font loading is out of scope. Families are matched against fonts already on the viewer's machine, with the generic family as the guaranteed fallback.
Applied in: `src/lib/design-system/tokens.ts`.

### D-48 · 2026-10-15 · The output surface is the chat artifact card, rebuilt alongside the original
Of the two surfaces offered, the build uses the chat message document block: `ArtifactCard` (`src/components/chat/ArtifactCard.tsx`), the inline card for a document a turn produced. The document preview card belongs to PR #1's document engine, which isn't on `main`.

The card is rebuilt as a new component inside the design-system module. The production `ArtifactCard` is left untouched, because live chat uses it and this slice is a demo.
Applied in: Step 3.

### D-47 · 2026-10-15 · Where the work lives
- **Location.** Branch `feat/image-to-design-system` off `main` at `7b8d94f3`, in a separate git worktree at `~/craft-ds`. The `~/craft` checkout stays on `feat/document-quality` for PR #1. `node_modules` is symlinked from `~/craft`.
- **Saving.** Commits are local. Nothing is pushed and no PR is opened; the brief said not to, and the fork is public (D-44).
- **The addendum.** The brief refers to "agentic standards from the addendum", but no addendum is in the repo. The standards as listed in the brief are treated as the spec: visible stages; every extraction shows what it assumed; edits happen before application; nothing is invented; low confidence is flagged.
