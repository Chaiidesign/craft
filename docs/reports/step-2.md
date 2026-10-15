# Step 2 report — typography, tokens, templates

- **Reported:** 2026-10-14 (UTC). **Commit:** `87b61b53` (28 files, +2,770 / −9).
- **Decisions:** D-09 to D-24 in [../decisions.md](../decisions.md).
- Backfilled from the Step 2 report given in the build session.

## Scope

PRD §6 (document design system) with the approved typography system (D-09 to D-17): fonts as tokens, the print and slide type scales, layout primitives, and the invoice and brief templates. The preview draws each sample as an A4 page. No page breaks yet (Step 3).

## What was built

- **Fonts** (`src/lib/documents/fonts/`): the four placeholder families, one licence file each, font files unchanged — Newsreader (Voice), Archivo SemiCondensed (Display), IBM Plex Sans (Function), IBM Plex Mono (Money). Plex Mono includes ₹, so the D-14 stop didn't trigger.
- **One file names fonts:** `src/lib/documents/theme.ts`. Swapping a font is a one-file change; a test fails if a family name appears anywhere else in the code.
- **Tokens** (`tokens.ts`): the print and slide scales value by value, plus spacing, page size, table, logo and chart measurements.
- **Templates** (`compose.ts`): invoice and brief templates turn a snapshot into a plan of the 18 PRD building blocks. The preview draws it now; pagination and every exporter read the same plan, so every format shows the same words and numbers.
- **Preview states:**
  - missing facts in yellow beside their field
  - unfinished invoices marked "Draft — incomplete", with the total reading "Incomplete — not a final amount"
  - internal notes left out unless "Include internal notes" is on
  - missing or broken logos shown as a dashed box labelled "No logo supplied" or "Logo could not be loaded", never an invented mark
  - the empty document explains there's nothing to lay out instead of drawing a blank page
- **README** (`docs/documents/README.md`): roles, placeholder fonts, the deferred A/B font pick, and caveats including the auth-token and Mixpanel notes. `/document-verify` isn't mapped in the analytics screen list, so no page view fires even on a preview.

## Checks

- 99 document and proxy tests pass, including:
  - font files match their recorded internal names, are static, and allow embedding
  - every character each sample draws exists in the exact font that draws it
  - the type scale equals the spec
  - the preview uses no hard-coded sizes or fonts
- Full suite: 1,272 passed; the only failure is the known `theme.test.tsx`.
- Typecheck and lint clean. `npx next build --webpack` succeeds with all eight fonts included.
- Browser at 1280px: every visible piece of document text uses one of the four document fonts, and table rows line up.

## Decisions asked, and the verdicts

1. The hosted typography spec needed a phone sign-in; built from the spec as given. → D-21: no update needed.
2. Values not in the spec: issuer name leading 1.2, grand total leading 1.3, field values Function 9.5/1.4. → D-22 approved.
3. Which numbers use which font (rates in totals labels, chart values, currency codes, footer invoice ID). → D-23 approved.
4. The full-width ￥ is in no font: recorded as missing, exporters refuse it. → D-24 approved.

## Known limits at the time

- On phones the page scales down whole (about 39% at 390px): no sideways scroll, but pinch-zoom is needed to read it.
- No page breaks yet; the footer said "Unpaginated preview" until Step 3.
- PDF/Word font embedding checks and the `docx` and `pptxgenjs` installs were deferred to Step 5.

## New user-facing text

"Draft — incomplete", "Incomplete — not a final amount", "Include internal notes", "No logo supplied", "Logo could not be loaded". Approved as part of the Step 2 verdicts.
