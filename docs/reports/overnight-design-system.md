# Overnight report: image-to-design-system pipeline

**Branch:** `feat/image-to-design-system`, off `main` at `7b8d94f3`. It lives in its own worktree at `~/craft-ds`; the `~/craft` checkout stays on `feat/document-quality` for PR #1. Commits are local. **Nothing is pushed, merged or opened as a PR.**
**Decisions:** D-47 to D-64 in [../design-system/image-pipeline-decisions.md](../design-system/image-pipeline-decisions.md). All are *proposed*, because nobody reviewed them overnight.

## The vertical slice works end to end

A design image goes in. A validated token proposal comes out. A person reviews and edits it, then applies it. The chat message document block re-renders from those tokens. It all runs offline: a mock extractor with canned readings for three sample images, and no AI calls.

| Step | Commit | What exists |
|---|---|---|
| 1. Extraction boundary | `f627e55c` | A 29-token schema (zod, strict). A proposal shape that carries, per token, a value or null, a confidence and an assumption. `runExtraction` validates the image going in and the output coming out, and returns five typed errors. A mock extractor recognizes the samples by SHA-256 and refuses every other image. |
| 2. Primitives | `893d14be` | `ThemeScope` writes the tokens as `--ds-*` variables. `Text`, `Button`, `Input`, `Card`, `Badge`, `IconFrame` and `Stack` read only those variables. |
| 3. Output interface | `ad6c9f95` | `ArtifactBlock`: the chat document block (`ArtifactCard`) rebuilt from the primitives, framed in a chat turn (`ThreadPreview`). The production card is untouched. |
| 4. Agentic standards | `f2c3a2a4` | A staged pipeline reducer and the `/design-system-verify` demo. |

## How to see the reskin demo

```bash
cd ~/craft-ds
npx next dev --webpack -p 4011      # webpack: node_modules is a symlink to ~/craft's
# open http://localhost:4011/design-system-verify
```

1. **Pick a sample.** **Night Console** is the most interesting: it has 3 low-confidence tokens and 2 the image can't show.
2. **Watch the stages.** The rail moves Image → Analyzed → Review tokens. The analysis is delayed by 0.9 s so the stage is visible, and it can be cancelled.
3. **Read the review.** Every token shows its value, its confidence and what it assumed. Flagged rows are amber; missing rows are red, with *why* there's no value.
4. **Try Apply too early.** It's refused, and the refusal lists every token that needs you.
5. **Resolve the tokens.**
   - Type `none` into *Card shadow* and press Enter.
   - Give *Raised shadow* a value, e.g. `0 8 24 0 #00000066`.
   - Press **Confirm** on the three flagged tokens.
   - Try `greenish` in any color field to see an edit refused inline.
   - When every value is present, a "Preview — not applied" appears beside the list.
6. **Apply design system.** You'll see a before/after of the same chat turn: today's card (a hand-transcribed approximation) next to the extracted system. "Every primitive in this system" and "Token JSON" sit underneath. **Edit tokens** returns to review with your edits kept.

Screenshots, desktop and phone (375 px), are in [design-system/](design-system/):

| | |
|---|---|
| Choose an image | `01-choose-image.png` |
| Analyzing | `02-analyzing.png` |
| Review (Night Console, full page) | `03-review-night-console.png` |
| Edit refused inline | `04-invalid-edit.png` |
| Ready to apply, with preview | `05-ready-with-preview.png` |
| Applied: Night Console, Soft Bloom, Ledger | `06-…`, `07-…`, `08-…` |
| Phone: applied; review filtered to "needs attention" | `09-…`, `10-…` |

## Tests

111 new or changed tests, all passing. Every step ran typecheck, lint and the suite before committing.

- **The schema rejects malformed tokens** (`extraction.test.ts`). It is run against 21 kinds of malformed output, among them three-digit hex, a named color, NaN, Infinity, `"16px"` strings, a font stack without a generic family, a font name that tries to break out of CSS, a weight of 450, extra or missing keys, a null value claimed as high confidence and an empty assumption. A control test checks that the unmodified proposal still passes. It also checks image validation (type, empty, over 10 MB, bytes that contradict the declared type), cancellation, and the cross-token rules: spacing grows, radii don't shrink, caption ≤ body ≤ title.
- **Primitives render from tokens only** (`tokens-only.test.tsx`). Everything is rendered with *sentinel* tokens, in which every value is unique. Every inline style, the pseudo-state stylesheet and the SVG attributes must then be a defined `var(--ds-*)` with no fallback, or a structural keyword. A planted-violation control checks that the audit catches all four kinds of violation.
- **Swapping tokens restyles everything** (same file). The two snapshots differ. With the variable values stripped, the markup is identical, so every difference comes from tokens. Editing one token changes exactly one variable.
- **The reskin test** (`reskin.test.tsx`). It resolves every `var()` and compares what a person would see: Ledger and Soft Bloom differ in card background, radius, shadow, border, title font and title color. The flat system renders `box-shadow: none`, and all three systems are pairwise distinct. It also checks that the block never nests a button inside a button.
- **The review flow** (`review.test.ts`). Nulls stay null and nothing is filled in. Apply is refused while tokens are flagged or missing. A blank can't be confirmed. A bad edit keeps the old value. Results that arrive late are dropped. Every proposed value round-trips through the edit format. Contrast warns but doesn't block.
- **Proxy** (`proxy.test.ts`). The demo route skips login outside production, and in production it redirects to login.

**The existing suite:** 1,284 passed, 2 skipped, and 1 failed. The failure is `src/lib/theme.test.tsx`, "theme.css is additive and in sync". It fails on `main` before this branch too, so this build didn't cause it. It is the same known failure noted in PR #1.

**Build:** `npx next build --webpack` passes, and the route appears in the build output.

**Production 404, unverified at runtime.** In production the page calls `notFound()`, and the proxy test checks the production redirect to login. But `next start` in this worktree returns 500 for *every* route, including `/` and `/reasoning-verify`, because Auth0 env vars aren't set here. So the production 404 itself wasn't observed.

## What the browser checks caught

Every one of these passed the unit tests and was only visible in a real browser. All are fixed and recorded in D-64:

- **Focus hidden under the apply bar.** The bar that sticks to the bottom of the review panel covered the row that keyboard focus had scrolled to (WCAG 2.4.11). Rows now carry a bottom scroll margin, and a hit-test confirms every Confirm button is reachable.
- **A stale error after Escape.** The field reverted but its error message stayed.
- **Demo-page CSS leaking into the themed preview.** The page's `h3 { text-transform: uppercase }` turned the card title into "Q3 LETTER TO PARTNERS". The page's element selectors now stop at `[data-ds-scope]`.
- **A stale "Not applied" announcement** stayed next to "Ready to apply". Review actions now clear it.
- **Grammar:** "1 token still need attention" now reads "still needs".

## Decisions to look at first

- **D-48: which surface.** The chat document block, rebuilt next to the production card rather than replacing it. The document preview card belongs to PR #1, which isn't on `main`.
- **D-50 and D-59: no invented values.** `null` means "couldn't read it". Low confidence is flagged and blocks Apply until confirmed. A missing token can only be resolved by typing a value. Nothing is auto-applied, including high-confidence tokens.
- **D-54: two extra tokens.** `size.border` and `size.focusRing` were added so primitives hold no literals. There is no hover color, because inventing one would break the rule.
- **D-57: what the rebuild drops.** framer-motion tap-scale, since there are no motion tokens yet. `onClick` becomes `onOpen`. A "body strong" style is approximated with the label weight.
- **D-63: the merge conflict.** PR #1 edits the same proxy allowlist line, which gives a one-line conflict: keep every path. Also, unlike PR #1's D-05, this route does not open on Vercel previews.

## Not done

- **The addendum.** The brief refers to "agentic standards from the addendum", but no addendum is in the repo. The standards listed in the brief were used as the spec (D-47). If the addendum adds more, they still need to be applied.
- **A real extractor.** `TokenExtractor` is the seam where a model-backed one plugs in; nothing downstream would change.
- **Fonts.** Font loading isn't done. Families are matched against fonts installed on the viewer's machine, with a guaranteed generic fallback (D-49).
- **Richer token editors.** There is no color picker, stepper or shadow builder yet; every token is one text field with a format hint (D-60).
- **Persistence.** A refresh loses the session.
- **Unused tokens.** `radius.sm` and `space.xl` aren't used by any primitive yet.
- **Production rendering.** The `ArtifactBlock` isn't wired into the real chat. The production `ArtifactCard` is unchanged.
- **New user-facing text** lives in `DesignSystemWorkbench.tsx`, `ThreadPreview.tsx` and the canned assumptions in `mock-extractor.ts`. It needs approval before merge, as in PR #1's process (rule 5).

## Housekeeping

- `~/craft-ds` is a git worktree; remove it with `git worktree remove ~/craft-ds` from `~/craft`.
- Its `node_modules` is a symlink to `~/craft/node_modules`.
- The dev server on port 4011 has been stopped.
