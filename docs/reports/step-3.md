# Step 3 report — layout, pagination, brief → deck

- **Reported:** 2026-10-14 (UTC). **Commit:** `a6e5e0e5` (25 files, +3,064 / −634).
- **Decisions:** D-25 to D-29 in [../decisions.md](../decisions.md).
- Backfilled from the Step 3 report given in the build session.

## Scope

PRD §8 (pagination by meaning) and fixture 5 (brief → deck with meaningful slide splits).

## What was built

- **Measured from the real fonts** (`metrics.ts`, `layout/`): line and page breaks come from the committed font files' own character widths, measured the way the PDF exporter measures them. A test confirms the widths match the PDF library's to within 0.001pt. The preview draws those exact lines, so the browser never re-wraps text.
- **Pages break by meaning:**
  - headings stay with their first lines
  - paragraphs keep at least 2 lines each side of a break
  - table headers repeat on every continued page
  - a row taller than a page splits, numbers on the first part, "Continued from previous page" after
  - charts stay with their captions
  - totals never split and stay with at least the last 2 whole rows; if even one row plus the totals can't share a page, the totals start a page and say why
- Every page has "Page n of N" and the document identification; pages 2 onward add a running header.
- "Show page-break reasons" shows why each page started.
- Nothing is clipped or shrunk: anything too big for an empty page shows an explicit error.
- A4 and Letter are both available in the preview.
- **Brief → deck** (`deck.ts`, `layout/slides.ts`): 9 slides at 16:9 *(as reported before D-26)* from the evidence brief. Every fact and all 4 citations carry over, nothing is summarised, the chart gets its own slide, the internal note is left out, and dense sections split across slides instead of shrinking below 18pt (body) or 12pt (captions). The ancestry check showed "Deferred to Step 4".

> **Correction (2026-10-15, Instinct review D-45):** the sample deck has **6 slides**, not 9. The report counted slides before the verdict D-26 (up to two short sections may share a slide), which was applied in the Step 3 commit `a6e5e0e5` itself, so the committed deck — and every later sample — has 6. The "9 slides" in the browser check below is likewise the pre-D-26 count.

## Checks

- 132 document tests pass, checking every sample in A4 and Letter for: every line, row and item appearing exactly once; nothing below the margin; no page ending on a heading; headers on every table continuation; totals kept with their rows. Extra cases force each rule to fire.
- Browser: every drawn line across all 7 documents in both page sizes plus the 9 slides — 1,268 lines — compared with its measured width; none drew more than 0.022px wider and nothing overflowed. No sideways scroll at phone widths.
- Full suite: 1,315 pass; the only failure is the known `theme.test.tsx`. Typecheck, lint and the production build are clean.

## Finding reported

Refusing the yen sign (D-24) effectively refuses the whole `ja-JP` locale: Japanese dates use 年, 月 and 日, which the fonts also lack. A `ja-JP` document shows a clear "characters the fonts can't draw" error. → D-29: accepted as a known limitation.

## Decisions asked, and the verdicts

1. Payment terms stranded alone on page 4 of the long invoice. → D-25: keep them with the totals.
2. Sparse slides. → D-26: up to two short sections may share a slide.
3. Proposed values (2-line minimum, 2 rows with totals, 120pt preferred break, chart heights 128/220pt, `FLOW` spacing). → D-27: approved as recorded values.
4. New document wording. → D-28 approved.

## Known limits at the time

- The long invoice's own tall row fits on one page, so row splitting is proven by a synthetic test row, not that sample.

## New user-facing text

"Continued from previous page"; "(continued)" after repeated slide headings; "Page n of N"; "n / N"; the running header (issuer · document number, plus the draft state); "Show page-break reasons"; "characters the fonts can't draw". Approved in D-28 and D-29.
