# Decisions: image-to-design-system pipeline

Decisions made while building the first vertical slice of the image-to-design-system pipeline on branch `feat/image-to-design-system` (off `main`). They are numbered, dated (UTC) and listed newest first.

**Status.** The build ran overnight without a reviewer. Its brief said: "Uncovered choice: pick the senior-engineer option, record it, keep going." So every entry here is **proposed**: the builder's choice, recorded for Chaitanya and Instinct to approve or overturn. None is approved yet. Once a later decision replaces an earlier one, the earlier entry is marked **superseded by D-n** and kept.

**Numbering.** PR #1 (`feat/document-quality`) keeps its own log in `docs/decisions.md`, which runs to D-46 and isn't on `main` yet. This log starts at D-47 so the two never share a number. It lives in its own file so merging both branches can't conflict on the log.

---

## Step 3: the output interface

### D-58 · 2026-10-15 · The reskin test compares what a person would see
`reskin.test.tsx` renders `ArtifactBlock` under three token sets: Ledger, Soft Bloom, and Night Console with its two missing shadows filled in as "no shadow", as a reviewer would. For each one it resolves every `var()` to its token value and compares the properties a person notices: card background, corner radius, shadow, border, title font and title color.
- Ledger and Soft Bloom differ on **every** one of them.
- The flat system renders the card with `box-shadow: none`.
- All three are pairwise distinct.
- The whole chat turn (`ThreadPreview`) passes the tokens-only audit from D-55.
Applied in: `src/components/design-system/reskin.test.tsx`.

### D-57 · 2026-10-15 · What the rebuild drops or renames, and why
`ArtifactBlock` keeps the original's content: icon, title, meta, the "Draft v{N}" badge, "See history" and the arrow when the card is clickable. These differences are deliberate:
- **`onOpen: () => void` replaces `onClick: MouseEventHandler<HTMLButtonElement>`.** The open action is no longer the outer element, so a mouse event no longer describes it.
- **No tap-scale animation.** The original uses framer-motion `whileTap`. The token set has no motion tokens, and a hardcoded `0.98` scale or `0.1s` duration would break "tokens only". Adding motion tokens is a follow-up.
- **The icon slot is a token-sized frame.** The default glyph is an outline document drawn with the border-width token, replacing the `@strange-huge/icons` file icon, whose size and color were literals.
- **Title weight.** The title uses the body style with the label style's weight (`Text emphasis`), because the token set has no "body strong" style. This mirrors the original's medium-weight title without inventing a weight.
Applied in: `src/components/design-system/ArtifactBlock.tsx`, `primitives.tsx`.

### D-56 · 2026-10-15 · The clickable card uses a stretched title button, not a button around everything
The production `ArtifactCard` wraps the whole card in a `<button>` and puts the "See history" `<button>` inside it. Nested interactive elements are invalid HTML and confuse screen readers.
- In `ArtifactBlock`, the **title** is the button (`.ds-stretched`). Its `::after` covers the card, so the whole card is still the click target, and the focus ring is drawn on that overlay around the whole card.
- "See history" is a sibling, raised above the overlay.
- The `<article>` is named by its title.
- Tests assert that no button is ever nested and that the card has exactly two buttons.
Applied in: `src/components/design-system/ArtifactBlock.tsx`, `PRIMITIVE_STATE_CSS`.

## Step 2: token application (primitives)

### D-55 · 2026-10-15 · "Tokens only" is proven by an audit with a control, not by comparing snapshots
`tokens-only.test.tsx` renders every primitive in every variant (`PrimitiveGallery`) with a **sentinel** token set, in which every value is unique (`#010101`, `21px`, weight 100…). It then parses every inline `style`, the pseudo-state stylesheet and the SVG presentation attributes. Every value has to be one of two things:
- a `var(--ds-*)` that the token set defines, with no fallback;
- a structural keyword from a short allowlist (`flex`, `none`, `0`, `100%`, `solid`, `pointer`…).

A control test plants a hex color, a px length, a `var()` with a fallback and an undefined variable, and checks that the audit catches all four.

The swap tests add:
- two sample token sets render different markup (both snapshotted);
- with the scope's variable values removed, the two renders are **identical**, so every visual difference comes from tokens;
- editing one token changes exactly one variable.

Two tokens are defined but not yet used by any primitive, `radius.sm` and `space.xl`. They are kept because the extractor reads them and a later surface will need them.
Applied in: `src/components/design-system/tokens-only.test.tsx`, `style-audit.ts`, `PrimitiveGallery.tsx`.

### D-54 · 2026-10-15 · Border and focus-ring widths are tokens
A `1px` border or a `2px` focus outline in a primitive would be a hardcoded value, so `size.border` and `size.focusRing` were added to the registry. The icon's stroke uses `size.border` (non-scaling). Since no sample shows a focused element, every sample reports `size.focusRing` at medium confidence and states the assumption.

There is no hover color, because no token describes one and inventing a darker primary would be an invented value. Disabled buttons use the border and muted-text colors.
Applied in: `tokens.ts`, `mock-extractor.ts`, `primitives.tsx`.

### D-53 · 2026-10-15 · Primitives read CSS variables written by one scope
`ThemeScope` turns a token set into `--ds-*` custom properties (`tokensToCssVars`) on a wrapper `div`. The primitives, `Text`, `Button`, `Input`, `Card`, `Badge`, `IconFrame` and `Stack`, reference those variables by typed name (`dsVar('color-primary')`) and never hold a value.
- **Why variables, not a React context of resolved values.** One token edit updates the whole subtree without re-rendering it, and a scope can be nested or placed side by side to compare systems.
- **Pseudo-states.** Focus-visible, placeholder and disabled can't be inline styles. They live in one stylesheet, `PRIMITIVE_STATE_CSS`, scoped to `[data-ds-scope]` and deduped by React 19's `<style precedence>`.
- **Isolation.** The app's own `globals.css` and `theme.css` aren't touched.
Applied in: `src/lib/design-system/css-vars.ts`, `src/components/design-system/primitives.tsx`.

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
`TOKEN_GROUPS` in `tokens.ts` names all 31 tokens (29 at first; D-54 added two):
- 8 colors: background, surface, text, muted text, primary, text on primary, border, focus.
- 2 font stacks: body and heading.
- 4 text styles: caption, body, label, title.
- 5 spacing steps.
- 4 radii.
- 2 shadows: card and raised.
- 4 sizes: icon, control height, border width and focus-ring width.

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
