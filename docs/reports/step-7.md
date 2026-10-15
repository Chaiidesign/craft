# Step 7 report — final checks and report for the whole build

- **Reported:** 2026-10-15 (UTC). Branch `feat/document-quality` on `Chaiidesign/craft`.
- **Spec:** [../souvenir-document-generation-prd.md](../souvenir-document-generation-prd.md). **Decisions:** [../decisions.md](../decisions.md). **Feature README:** [../documents/README.md](../documents/README.md).
- **Status:** Instinct reviewed PR #1 at `874fb039`: ready with conditions (D-45). The conditions are applied below under "Review follow-up". **No merge until Instinct re-reviews.**

## Scope

PRD §12: run the actual checks, inspect actual pixels (phone and desktop previews, every page of every sample export, the opened Word and PowerPoint files where tooling permits), complete the README, and report changed files, commands and results, screenshots, sample export paths and limitations.

## What the build delivers (Steps 1–6)

| Step | Commit(s) | Delivered | Report |
|---|---|---|---|
| 1 | `13265b24` | Typed model, integer money, validation, the 11 fictional fixtures, workbench at `/document-verify` | [step-1.md](step-1.md) |
| 2 | `87b61b53` | Font roles and tokens, type scales, layout primitives, invoice and brief templates | [step-2.md](step-2.md) |
| 3 | `a6e5e0e5` | Font-metric layout, pagination by meaning, brief → deck | [step-3.md](step-3.md) |
| 4 | `cf6c9884`, `0e031c76` | Immutable revisions, bounded edits, proposals, restore, mock approval markers, deck ancestry | [step-4.md](step-4.md) |
| 5 | `8a05e154` | Real PDF, Word and PowerPoint exports of one frozen revision; generated-PDF preview | [step-5.md](step-5.md) |
| 6 | `0cca21d6` | Browser-session storage and recovery, cancel, renderer vs viewer errors, error screens | [step-6.md](step-6.md) |

## Changed files

Against `main` (`7b8d94f3`): **171 files, +15,419 / −12.**
> **Correction (D-45):** that count was taken before this report itself was committed. At the reviewed commit `874fb039` it is **172 files, +15,515 / −12** (the extra file is this report). The review follow-up below adds more.
- **New feature code:** `src/lib/documents/` (70 files: model, money, validation, fixtures, fonts, theme and tokens, layout engine, deck, revisions, session, export renderers, tests), `src/components/documents/` (10: previews, primitives, PDF viewer, browser export resources), `src/app/document-verify/` (13: the workbench, scenarios, tests), `scripts/documents/` (2: sample export and page-render scripts), `public/document-fixtures/halden-rowe-mark.png` (fictional logo).
- **Existing files changed:** `src/proxy.ts` and `src/proxy.test.ts` (the demo route opens without login outside production — D-05), `next.config.ts` (client-only webpack rule for pptxgenjs; `turbopack` always declared — D-37, D-38), `package.json` / `package-lock.json` (`docx` 9.11.0, `pptxgenjs` 4.0.1, devDependency `sharp` 0.34.5). Nothing else outside the feature area changed; no API routes, auth guards, env values or remotes.
- **Docs:** `docs/documents/` (README, samples and page images), `docs/reports/`, `docs/decisions.md`, `docs/progress.md`, `docs/workflow.md`, `docs/ai-build-playbook.md`, the PRD, and the root `CLAUDE.md`.

## Commands and results (run 2026-10-15, final code)

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit -p .` | Clean |
| Lint | `npx eslint src/lib/documents src/components/documents src/app/document-verify scripts/documents next.config.ts` | Clean |
| Tests | `npx vitest run` | 1,421 passed, 2 skipped, **1 failed**: `src/lib/theme.test.tsx` ("theme.css is additive and in sync"), which failed before this build started and is unrelated |
| Build | `npx next build --webpack` | Succeeds; only the existing Auth0 "Critical dependency" warnings |
| Preview build | `VERCEL_ENV=preview npx next build --webpack` then `next start -p 4011` | Succeeds; `/document-verify` served under the production security policy; only the known Auth0 configuration errors in the server log |
| Sample exports | `npx vite-node scripts/documents/export-samples.ts` | Regenerated from the final code and compared with the committed samples: PDFs have identical text and page counts; Word and PowerPoint files are identical part for part except creation timestamps and Word's random per-file font-obfuscation keys. The committed samples therefore are the final code's output and were kept. |

## Screenshots

Taken from the production preview build, in [step-7/](step-7/). No sideways scroll at any width (page `scrollWidth` equals the viewport at 390 and 320px).

| File | Shows |
|---|---|
| `desktop-1-invoice.png` | 1280px: complete invoice, readiness, revision and approval labels, HTML preview |
| `desktop-2-pdf-export.png` | Export panel with a finished PDF and the generated-PDF preview |
| `desktop-3-empty-document.png` | Empty state: "Nothing to lay out yet." with the reason, and the issues list |
| `desktop-4-scenario-11.png` | Fixture 11 run: all 16 checks pass |
| `desktop-5-viewer-error.png` | Forced viewer failure: one alert, download intact, "Try the viewer again" / "Show the HTML preview" |
| `desktop-6-malformed-session.png` | Malformed saved session banner |
| `phone-390-1-malformed-session.png` | The banner at 390px |
| `phone-390-2-invoice.png` | Top of the workbench at 390px |
| `phone-390-3-html-preview.png` | HTML preview at 390px (the page scales to fit; zoom is in the PDF preview) |
| `phone-390-4-pdf-export.png` | Finished PDF and its preview at 390px |
| `phone-320-1-expired-export.png` | An export after reload ("file not kept after reload", Export again) at 320px |
| `phone-320-2-fields.png` | The structured field list at 320px, readable without zoom |

## Page-by-page export inspection

Sample files are in [../documents/samples/](../documents/samples/); page images in `samples/pages/`; Apple renders in `samples/apple/`. All 30 page images were looked at one by one.

| Sample | Our PDF | Word in Pages / PowerPoint in Keynote |
|---|---|---|
| Complete invoice (Halden & Rowe, USD) | 1 page: logo, letterhead, all fields, 3 rows, totals $7,514.82, terms, "Page 1 of 1" | 1 page in Helvetica; content and totals correct |
| Draft invoice (Marrow & Finch, EUR) | 1 page: "DRAFT — INCOMPLETE", missing due date, billing address and tax shown as Missing, total "Incomplete — not a final amount" | 1 page; same states, Helvetica |
| Long invoice (Saffron Loom, INR) | 4 pages: rows 1–10, 11–26, 27–40, 41–42 (all 42); header repeats on pages 2–4; the tall bespoke row intact; last 2 rows with the totals ₹31,69,979.72; terms follow; running header and "Page n of 4" | 5 pages: "Amounts in INR" alone on page 2, table from page 3 (Pages won't start a long table mid-page); **row 11 drawn one line short, hiding "11"** (the Word file has the full text); totals and terms together on page 5 |
| Evidence brief (Brightwater) | 2 pages: summary with citations, goals, constraints, evidence, chart as vector shapes with axis line and data summary, pull quote, recommendations, callout, 4 sources | 3 pages; chart picture and editable data table both present; sources on page 3 |
| Deck from the brief | 6 slides: title, summary + goals, constraints + evidence, chart, evidence + recommendations + callout, sources; "n / 6" footers | 6 slides in Helvetica; **chart has no bars** (Keynote drops pptxgenjs charts); headings wrap to two lines and crowd the text below; on slide 5 a wrapped list item runs into the callout |

## Findings from this inspection

1. **Deck "(continued)" — resolved by D-46 (see Review follow-up).** The deck gives the evidence section's chart its own slide, so the section spans slides 3–5, and slides 4 and 5 repeat its heading **without** the approved "(continued)" (D-28). "(continued)" is only added when one slide's content overflows onto the next, not when a section is deliberately split into text, chart and text slides. This has been true since Step 3. Fixing it changes the deck's output, samples and tests, so it is recorded, not changed. Options: add "(continued)" to every repeated section heading after the first; or keep the chart slide's heading unmarked as a deliberate split and mark only the text continuation (slide 5).
2. **Pages clips a row** that wraps exactly at the cell edge (long invoice row 11). The Word file is correct; recorded as a Pages limitation; Word unverified.
3. **Scenario checkboxes render in uppercase** ("FORCE A VIEWER FAILURE (SCENARIO 11 ONLY)") because they use the workbench's label style, as scenario 9's did. The approved wording is unchanged; only its display case differs. Mentioned for awareness; no change made.

## Limitations, stated plainly

- **Word and PowerPoint files have never been opened in Microsoft Word or Microsoft PowerPoint**; neither is installed. They were checked only in **Apple Pages (Word files) and Apple Keynote (PowerPoint files), which both replace the document fonts with Helvetica.** Pages ignores the fonts embedded in the Word files; PowerPoint files can't embed fonts at all. Those renders confirm content, not typography, and their line and page breaks differ from the PDF.
- Keynote shows no bars in the chart slide; Pages moves long tables to a fresh page and clipped one row. Whether Word or PowerPoint do the same is unverified.
- Exported PDFs are not tagged for accessibility, and no such claim is made.
- `ja-JP` and other non-Latin scripts are refused (no fallback font committed).
- Cancel only takes effect while an export is loading fonts and images.
- Two open tabs overwrite each other's saved session (last write wins).
- Edits made while the malformed-session banner shows are not saved; the banner says so.
- Demo storage is one browser's local storage, not production persistence.
- The full list, with sources, is in the README's "Unsupported and unverified" and "Known limitations" sections.

## New user-facing text in Step 7

None. The README and reports are documentation; no workbench or document wording changed.

## Decisions needed

- Merge and release of `feat/document-quality`, after Instinct re-reviews the follow-up.

## Review follow-up (Instinct, D-45)

Instinct reviewed draft PR #1 at `874fb039`: **ready with conditions.** Each condition and what was done:

1. **"(continued)" on slides 4 and 5 — done (D-46).** `layout/slides.ts` now tracks continuation per section: a section heading already shown on an earlier slide is marked "(continued)" wherever it repeats, whether the section overflowed or was split around its chart. The deck PDF and PowerPoint samples and their page images were regenerated; only slides 4 and 5 changed (the other slide images are byte-identical). Rechecked visually: in the PDF, slide 4 reads "Evidence: … (continued)" over the chart and slide 5 the same over the text and Recommendations, the heading wraps to two lines and nothing reaches the footer; in Keynote the same headings, with the already-recorded Helvetica overlap on slide 5 (a wrapped list item runs into the callout). New test: every repeat of the Evidence heading after the first ends "(continued)" and no other heading does. The Step 3 rule "split sections never share a slide" is restated precisely: a section that overflowed onto several slides never shares; a one-slide continuation may share (as slide 5 always has, under D-26). Stale "awaiting a decision" entries removed from the README, progress and this report.
2. **Reset during an export — done.** `settleExport` now discards a job whose record no longer exists (Reset or Start again replaced the records) exactly as it discards a cancelled one: no file, no object URL, no event. `runExport` returns `{ discarded: true }` without announcing or switching the preview, and nothing throws. Tests: a held-resource test (the render is held, Reset replaces the records, the render is released) asserting no late file, record, event, announcement or preview and that the promise resolves; and a `settleExport` test against an emptied state.
3. **Malformed-session recovery — done.** Start again (and Reset, which takes the same path on a malformed session) now returns early when the backup copy can't be written: the unreadable data, its banner and both actions stay, the workbench isn't replaced, saving stays paused, and the save-failure warning gives the browser's reason. Test: `setItem` throws a quota error; the banner and both buttons remain, the stored session is unchanged, no backup was written, the fixture view is unchanged, and Reset changes nothing either.
4. **React Doctor — done.** Disposition of all 51 findings in [react-doctor-pr1.md](react-doctor-pr1.md): the one error (a `try … finally` the React Compiler can't compile) is fixed; one false positive; one known debt (item 6); 48 accepted with a reason per rule. CI re-scans on each push.
5. **Report inconsistencies — annotated** where they appear: [step-1.md](step-1.md) (login and 404 are both true in production), [step-3.md](step-3.md) (6 slides; 9 was the pre-D-26 count), and this report's file count (172 at `874fb039`).
6. **Export-bytes memory — recorded as known debt** in the README's Known limitations: generated files' bytes stay in memory and their object URLs are never revoked until the page closes; Reset doesn't release them.

**Checks on the follow-up's final commit:** see the commit message and PR comment for the exact results of typecheck, lint, tests and build.

