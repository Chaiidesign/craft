# Decisions — document-generation build

Every approved decision for this build, numbered in the order it was made, newest first. Dates are UTC, the time zone of the session records.

**Sources.** Chaitanya approved these decisions in the Claude Code build session, either as written replies to each step report or as answers to multiple-choice questions. They are backfilled here from that session's transcript, so each entry states its context in full instead of pointing to the chat. **Applied in** names the commit, and where useful the README section, that carries the decision out. The feature README is [documents/README.md](documents/README.md); the spec is [souvenir-document-generation-prd.md](souvenir-document-generation-prd.md).

Status is **approved** unless marked otherwise. When a later decision replaces an earlier one, the earlier entry is marked **superseded by D-n** and kept.

---

## Review of PR #1

### D-47 · 2026-10-15 · Instinct's re-review of PR #1: approved
Verdict on PR #1 at `06763bb1`: **approved to merge.** Conditions 1–3 of D-45 were verified by direct code inspection at `06763bb1`, with their regression tests present; CI is green (React Doctor 0 errors / 50 warnings; Vercel deployed). Instinct did not independently re-run the test suite or re-inspect the slide images; the approval rests on code inspection and CI.
Non-blocking cleanup, applied: the PR body's test count (1,421 → 1,425) and decision range (D-01 to D-44 → D-01 to D-47); the React Doctor summary's tally (47 accepted / 2 debt → 48 accepted / 1 debt, matching the tables); the Step 7 report's original "(continued)" finding marked superseded by D-46.
Applied in: the commit after `06763bb1`.

### D-46 · 2026-10-15 · "(continued)" is tracked per section
Every slide after the first that repeats a section's heading carries the approved "(continued)", whether the section overflowed onto the next slide or was deliberately split (text, then its chart on its own slide, then more text). In the sample deck, slides 4 (chart) and 5 (text) now read "Evidence: … (continued)". A one-slide continuation may still share a slide with the next short section (D-26); a section that overflowed onto several slides never shares.
Resolves the Step 7 finding. Refines D-28.
Applied in: `src/lib/documents/layout/slides.ts`, deck PDF/PowerPoint samples and page images regenerated.

### D-45 · 2026-10-15 · Instinct's review of PR #1: ready, with conditions
Verdict on draft PR #1 at `874fb039`: ready with conditions, to be applied before merge; **no merge until Instinct re-reviews.**
1. Mark both slide 4 (chart) and slide 5 (text) with "(continued)" via section-level continuation tracking; regenerate the deck PDF/PowerPoint and page images; recheck visually; record the decision (D-46); remove stale "awaiting a decision" entries.
2. Reset during an export: a late completion after Reset or Start again is discarded silently — no late file, status, announcement or preview, and no unhandled rejection — with a held-resource regression test.
3. Malformed-session recovery returns early when the backup can't be written, keeping the raw-data banner and its actions, with a test where `setItem` fails.
4. Document the disposition of the 51 advisory React Doctor findings.
5. Annotate the report inconsistencies: Step 1 "behind login" vs "404" in production; Step 3 "9 slides" vs the sample deck's 6; "171 files" vs 172 at the reviewed commit.
6. Record the export-bytes memory retention as known debt.
- Rerun lint, typecheck, tests and build on the final commit.
Applied in: see [reports/step-7.md](reports/step-7.md), "Review follow-up".

## After Step 6

### D-44 · 2026-10-15 · Push the docs to the public repo
`Chaiidesign/craft` is a public GitHub repo, so pushing makes the PRD and the playbook publicly readable, including the PRD's reference links (a `files.instinct.com` spec link and links into the private `souvenir-inc/may-day` repo). Chaitanya was told this and chose to push as is, without making the repo private or removing the links.
Applied in: `9df0654e`, `1780e9ba`, `51901953`, pushed to `feat/document-quality`.

### D-43 · 2026-10-15 · Save work at every checkpoint; approval gates merge and release
The standing protocol is saved as [workflow.md](workflow.md). Its rule 3 was changed from "stop and wait for Instinct's verdicts, then commit and push" to: commit and push checked work to the feature branch at every meaningful checkpoint; Instinct's verdicts gate merge and release, not saving work. The repo is the single source of truth: specs, decisions (this file), step reports (`docs/reports/`) and progress ([progress.md](progress.md)) are committed files, and nothing exists only on a Mac or in Messages. A root `CLAUDE.md` imports the protocol and points to the PRD and the progress file. The reasoning is in [ai-build-playbook.md](ai-build-playbook.md).
Supersedes D-03's "no commit or push until the report is approved".
Applied in: `1780e9ba`, `51901953`.

### D-42 · 2026-10-15 · The PRD lives in the repo
The PRD was only a Messages attachment. It is now `docs/souvenir-document-generation-prd.md`, byte-for-byte the attachment as amended by D-40, and checked against the copy on GitHub. The Drive/Messages copy can be deleted once it's confirmed on the branch.
Applied in: `9df0654e`.

### D-41 · 2026-10-15 · Delete the `step-4-revisions` branch
It held Step 4 only (head `0e031c76`), which is already part of `feat/document-quality`. Deleted from the fork after confirming that commit is an ancestor of the feature branch.

## Step 6 — session storage, recovery, cancel, errors (commit `0cca21d6`)

### D-40 · 2026-10-15 · Step 6 verdicts
1. **Cancel only during loading.** Cancel takes effect only while an export loads its fonts and images; once a renderer starts, the page can't respond until it finishes, and the late result is discarded. No artificial slow render is built to widen the window. Recorded as a known limitation.
2. **Banner line.** Edits made while the malformed-session banner shows aren't saved (saving is paused so the unreadable data isn't overwritten). The banner says so: "Changes won't be saved while this banner is showing." The workbench is not made read-only, because that would need a whole state machine for an edge case.
3. **`expired` export status.** `ExportRecord` has five statuses: pending, succeeded, failed, unsupported, expired. The PRD was incomplete; its section 5 was updated.
4. **Reset backs up a malformed session first.** Reset on a malformed session saves a backup copy before clearing, as "Start again" does.
5. **Hydration fix (Step 4 bug).** Revision IDs used `Date.now()` from the first render, so server and client HTML differed. The first render now uses fixed `fx` IDs; IDs created after mount carry a prefix unique to the page load, so they never collide with saved IDs.
6. **Generated malformed sessions.** The Step 1 hand-written list of broken sessions is replaced by `malformedSessions()`, which breaks one thing in a valid session per kind.
7. **Two tabs: last write wins.** Accepted as a known limitation; no cross-tab sync.
8. **One message on a viewer error.** The Step 5 status "The PDF could not be shown." is removed while the viewer-error alert shows, so a screen reader announces one message.
- **Text approved:** "Export again"; "Forced viewer failure (scenario 11 only)"; "Forced renderer failure (scenario 11 only)" and "Forced failure (scenario 11 only)"; the download name `souvenir-doc-workbench-unreadable.json`; the announcements "Restored the saved workbench session.", "Started again from the sample fixtures." and "Workbench reset to the sample fixtures."; and the detail text in "fails validation: {message}".
- Checking export rows at 320px by measurement rather than screenshot is accepted.
Applied in: `0cca21d6`; README "Session, recovery and errors" and "Known limitations"; PRD section 5.

### D-39 · 2026-10-15 · Step 6 design
1. **Storage split.** Revisions, approval markers and export records are saved in this browser under one versioned key, `souvenir-doc-workbench:v1`. Export files are never stored. On reload, a finished export becomes "expired" with an Export again action, and a running one comes back cancelled, so it can never block a new export. This is demo storage, not production persistence.
2. **Broken saved sessions.** Never silently replaced. A banner names the reason and offers "Download the unreadable data" and "Start again from the sample fixtures". Nothing is written until one is chosen; Start again first copies the data to a backup key (`souvenir-doc-workbench:v1:backup`). Each kind of breakage has a test that forces it: not JSON, unknown version, wrong structure, current revision not in history, missing parent, missing deck source, approval of a missing revision, and a snapshot validation can't read. Save failures (storage full or blocked) show a warning.
3. **Cancel.** Marks the record cancelled (error code `cancelled`) and discards the late result, with honest screen text. Fixes a Step 5 bug: the "ready" announcement and the PDF-preview switch now follow the stored record, not the render outcome, with a test.
4. **Renderer vs viewer errors.** A renderer error is a failed export with Retry. A viewer error means the file was made but couldn't be shown: the download still works, with "Try the viewer again" and "Show the HTML preview". Sections have error screens, and a failing HTML preview is covered by them. Scenario 11 has two scenario-only checkboxes: "Force a renderer failure (scenario 11 only)" and "Force a viewer failure (scenario 11 only)".
5. **Duplicate filenames.** An export's identity comes from its record, never its filename.
- **Text approved as written:** the cancel button and labels, the expired and reload-cancelled labels, the malformed-session banner and its eight reasons, the save-failure warning, the Reset button and confirmation, the viewer-error text and buttons, the section error screen, and the scenario 11 checkboxes. Exact wording is in the README's "Session, recovery and errors" section.
Applied in: `0cca21d6`.

## Step 5 — real exports (commit `8a05e154`)

### D-38 · 2026-10-14 · Step 5 approval
1. `next.config.ts` always declares `turbopack` (empty unless the design-system sibling exists), because Next 16 refuses to start Turbopack dev when a `webpack` hook exists without one.
2. Word's running header sits 24pt from the top edge (`WORD_HEADER_FROM_EDGE_PT = 24`).
3. All new workbench text as listed in the README's Step 5 section.
4. The short revision ID in filenames is the last four hex digits of the revision ID's FNV-1a hash.
5. The Word chart order is: title, picture, axes line, data table, summary.
6. `sharp` 0.34.5 is declared as a devDependency (it rasterises the chart picture's PNG fallback in Node).
7. The Pages long-table limitation is documented, and Word's page-break rules are not weakened to suit Pages.
Applied in: `8a05e154`; README "Exports".

### D-37 · 2026-10-14 · Build fix for pptxgenjs: a scoped webpack rule
pptxgenjs 4.0.1 contains `import('node:fs')` and `import('node:https')`, which webpack refuses in client bundles. Fix: a client-only webpack rule mapping exactly those two imports to empty modules.
Applied in: `8a05e154` (`next.config.ts`).

### D-36 · 2026-10-14 · Word chart, invalid revisions, filename length
- **Word chart:** the `docx` library can't make native Word charts. The chart appears both as a picture and as an editable data table.
- **Invalid or empty revisions:** export is refused with the reason. The empty document's message is "This {kind} has no fields and no content blocks, so there is nothing to export."
- **Filenames:** each filename part is capped at 40 characters.
Applied in: `8a05e154`.

### D-35 · 2026-10-14 · Step 5 plan
1. Word and PowerPoint files are checked by opening them in Pages and Keynote through AppleScript, exporting to PDF and inspecting the pixels. Microsoft Word and PowerPoint themselves remain unverified (not installed).
2. A deliberately triggered Word failure for scenario 9, scenario-only and clearly labelled.
3. Tests use a built-in zip reader, with no new dependency.
4. Sample files and page images are committed (`docs/documents/samples/`).
5. **Text approved:** the filename pattern `{issuer}_{document number or title}_v{n}_{short revision ID}.{ext}`; the draft warning, "Export draft" and "Cancel"; the unavailable reasons; the status labels "Preparing {format} of v{n}…", "{format} of v{n} ready ({size})", "{format} failed: {reason}" and "Retry {format} of v{n}"; the preview labels "HTML preview (not the PDF)" and "PDF preview (generated file, v{n})".
6. Fonts are embedded in Word files. Pages ignores them and uses Helvetica; this is recorded.
Applied in: `8a05e154`.

## Step 4 — revisions (commits `cf6c9884`, `0e031c76`)

### D-34 · 2026-10-14 · Issuer address stays editable
A correction to the Step 4 review: only the issuer name is brand-locked. The issuer address is an ordinary document field and stays editable.
Supersedes the address part of D-33.
Applied in: `0e031c76`.

### D-33 · 2026-10-14 · Step 4 review fixes
1. The document record's title is recomputed when a brief's title or an invoice's number changes; derived-deck summaries use the current title.
2. Bounded edits are validated at the store: real calendar dates, money as non-negative whole minor units in the invoice's currency, percentages in range, text trimmed.
3. A restore identical to the current revision, and deriving a deck again from the same brief revision, are refused with specific messages.
4. Approving an older revision stays allowed; approving a specific past version is legitimate.
5. ~~Issuer address joins the brand-locked fields~~ — **superseded by D-34**.
6. Tests: a render test that the issuer name has no Edit control, and a test that a proposal touching the issuer name is refused.
Applied in: `0e031c76`.

### D-32 · 2026-10-14 · Push Step 4 to a review branch
Step 4 was pushed to a new branch, `step-4-revisions`, for review. That branch was later deleted by D-41.

### D-31 · 2026-10-14 · Step 4 refinements
1. Edits to the issuer name are refused with an explicit reason: issuer identity comes from the brand profile, and brand editing is outside this build. Two issuer names in one document is worse than a refused edit.
2. **Text approved:** "Created", "Ancestry check failed: {reason}", "Sample reviewer (fictional)", both proposal titles ("Clearer payment terms", "Tighter evidence sentence"), and "v2 · Current".
3. Em dashes stay, matching the already-approved "Draft — incomplete".
4. Decks are derived documents: you edit the brief and derive again. A direct deck edit is refused with an explicit message.
5. Workbench text approved as written.
Applied in: `cf6c9884`.

### D-30 · 2026-10-14 · Step 4 scope and wording
- Scope confirmed: all ten parts, nothing added. The deferred deck-ancestry check runs against real revisions.
1. The revision store lives in memory for Step 4; browser storage and broken-session recovery wait for Step 6 (built in D-39). Superseded by D-39 for storage.
2. **Bounded edit:** one field value, one line item's description, quantity or unit price, or the text of one sentence or list item. No adding or removing whole blocks or rows.
3. "v1", "v2"… are display labels in creation order; revision IDs remain the true identity. Authors: "Sample operator (fictional)" for edits, "System" for derivations and restores.
4. **Text approved:** history labels "Current" and "Viewing v{n} — not the current revision"; change summaries "Edited {field label}", "Edited line {n}: {quantity / unit price / description}", "Edited text in {section heading}", "Accepted proposal: {proposal title}", "Restored from v{n}", "Derived from {brief title} v{n}"; approval marker "Approved (sample) by {reviewer} on {date} — applies to v{n} only" and "Not approved"; deck ancestry "Derived from brief v{n} — current" and "Derived from brief v{n} — the brief now has v{m}. This deck does not update by itself; derive again to update."
5. Two fictional proposals: a payment-terms wording change in the invoice and one tightened evidence sentence in the brief. Before and after are shown; no AI.
- Working agreements: new values and new document wording are proposed and approved before use; explicit errors, never silent fallbacks; a test for every rule, including cases forced to fire; full suite, typecheck, lint and build clean before reporting.
Applied in: `cf6c9884`.

## Step 3 — layout and pagination (commit `a6e5e0e5`)

### D-29 · 2026-10-14 · `ja-JP` refusal is a known limitation
The placeholder fonts can't draw `ja-JP` dates (年, 月, 日) or the full-width ￥. Layout stops with a clear "characters the fonts can't draw" error; nothing is substituted.
Applied in: README "Known limitations".

### D-28 · 2026-10-14 · Pagination wording
**Text approved:** "Continued from previous page" (a row carried over a page break), "(continued)" after a repeated slide heading, "Page n of N" (pages), "n / N" (slides), and a running header of issuer · document number plus the draft state on pages 2 onward.
Applied in: `a6e5e0e5`.

### D-27 · 2026-10-14 · Pagination values (recorded values, not spec changes)
At least 2 lines on each side of a paragraph or list-item break (`KEEP.orphans`, `KEEP.widows`); 2 line-item rows kept with the totals (`KEEP.rowsWithTotals`); prefer a section break when under 120pt remains (`KEEP.preferredBreakMinSpacePt`); chart plot height 128pt in print and 220pt on slides; block spacing as in `FLOW` and `SLIDE_FLOW` in `tokens.ts`.
Applied in: `a6e5e0e5`.

### D-26 · 2026-10-14 · Up to two short sections may share a slide
At most two short consecutive sections may share a slide, each keeping its own heading.
Applied in: `a6e5e0e5`.

### D-25 · 2026-10-14 · Payment terms stay with the totals
Payment terms are kept with the totals and never stand alone on a page. In the long invoice, the last page carries the last rows, the totals and the terms.
Applied in: `a6e5e0e5`.

## Step 2 — typography, tokens, templates (commit `87b61b53`)

### D-24 · 2026-10-14 · Yen is refused, never substituted
The Money face can't draw the yen sign. It is recorded as missing, and export is refused for documents that need it. Never substitute silently.
Applied in: `87b61b53`.

### D-23 · 2026-10-14 · Font roles for details
Rates inside totals labels use Function; chart values use Function; currency codes use Money; the footer invoice ID uses Function 8pt.
Applied in: `87b61b53`.

### D-22 · 2026-10-14 · Leading values
Issuer name leading 1.2; grand total leading 1.3; field values Function 9.5/1.4.
Applied in: `87b61b53`.

### D-21 · 2026-10-14 · The hosted typography spec needs no update
Building from the typography spec as given in the session is fine; the hosted spec matches it.

### D-20 · 2026-10-14 · App-shell requests are documented, not changed
The shared root layout's `AuthProvider` requests `/auth/access-token` on every page, including the demo. This is the app shell's session check, not a document service call: leave it and note it in the README. Same for Mixpanel on Vercel previews.
Applied in: README "Known caveats of the demo route".

### D-19 · 2026-10-14 · Checkpoint each step locally
Commit each step locally with a clear message before starting the next.
Superseded by D-43, which adds pushing at every checkpoint.

### D-18 · 2026-10-14 · Typography spec is the source of truth
The typography spec at `https://files.instinct.com/rnub2313fscd-souvenir-typography-spec` is the reference for roles, scales, rules and acceptance tests.

### D-17 · 2026-10-14 · Size floors on slides
18pt minimum for slide body content; 12pt minimum for captions, citations and chart data summaries.
Applied in: `87b61b53`.

### D-16 · 2026-10-14 · Newsreader optical size
All Voice files use Newsreader's text optical size. At 13pt a display cut would look thin, and Archivo already covers the large sizes.
Applied in: `87b61b53`.

### D-15 · 2026-10-14 · Static font files
Archivo SemiCondensed 600; Newsreader at one optical size (see D-16). Only those files are committed.
Applied in: `87b61b53`.

### D-14 · 2026-10-14 · Stop if a face lacks ₹
If IBM Plex Mono lacks ₹, stop and ask; no silent substitution.

### D-13 · 2026-10-14 · Slide scale
Title Display 32/1.1; slide heading Display 24/1.2; body Voice 18/1.4 minimum; captions Function 12/1.35.
Applied in: `87b61b53`.

### D-12 · 2026-10-14 · Table rows unified at 9.5pt
Table text and amounts are both 9.5pt, tuned optically; sizes are not mixed within a row.
Applied in: `87b61b53`.

### D-11 · 2026-10-14 · Styles for remaining text
Grand total Money Medium 12pt; table header Function Medium at table-text size; invoice number and reference IDs Money Regular 9.5pt; dates Function 8.5pt caption style; issuer name in the letterhead Display 18pt; citations and source list Function 8pt; draft marker Function Medium 8.5pt, uppercase, tracking +0.08em.
Applied in: `87b61b53`.

### D-10 · 2026-10-14 · Weights per role
Voice: Regular, Italic, SemiBold. Display: one weight (600). Function: Regular and Medium. Money: Regular and Medium. No other weights.
Applied in: `87b61b53`.

### D-09 · 2026-10-14 · Typography system
- **Architecture:** document fonts are tokens. `src/lib/documents/theme.ts` is the only file that names font families; `tokens.ts` reads it, and every renderer reads tokens. Placeholders can be swapped with a one-file edit; the final choice is made later by rendering the same fixture in candidate themes.
- **Roles and placeholders** (all SIL OFL, committed as TTF with their licences): Voice = Newsreader (body, section headings, pull quotes); Display = Archivo (title, headline moments, condensed); Function = IBM Plex Sans (labels, captions, metadata, tables, footer); Money = IBM Plex Mono with tabular figures (every amount, ID, reference number and table numeral). Noto is not committed; non-Latin scripts are an explicit unsupported state.
- **Print scale (pt):** title Display 28/1.15, −0.01em; section heading Voice SemiBold 13/1.3; body Voice 10.5/1.5; pull quote Voice Italic 14/1.45; labels and captions Function 8.5/1.4, +0.02em; footer and page numbers Function 8/1.4.
- **Rules:** numerals carrying money, quantity, ID or reference meaning use Money; prose numerals may use Voice. Emphasis is Voice Italic, never synthetic slant or underline. Letter-spacing is 0 except labels, captions, the title and the draft marker. Only the named weights.
- **Tests:** each committed TTF covers every fixture currency symbol; tokens expose every scale value and renderers use tokens, not literals; PDF and Word show the same fonts.
Applied in: `87b61b53`.

## Step 1 — foundations (commit `13265b24`)

### D-08 · 2026-10-14 · Build plan approved
Step 1 foundations (model, money, validation, fixtures, workbench shell); Step 2 tokens, primitives, templates and typography; Step 3 pagination and deck slide splits; Step 4 revisions; Step 5 renderers (jsPDF native text, not html2canvas; docx; pptxgenjs; capability registry; committed samples; Word and PowerPoint visual fidelity reported unverified where tooling is missing); Step 6 workbench states (PRD §9); Step 7 checks, README and report.

### D-07 · 2026-10-14 · Dependencies approved
`docx`, `pptxgenjs`, OFL document fonts committed as TTF, and `jsdom` + Testing Library for tests. As built, the UI tests use React's own test utilities in per-file jsdom environments, so `vitest.config.ts` is unchanged.

### D-06 · 2026-10-14 · "Preview sorted" means a Vercel preview link
"Preview sorted" means a Vercel preview deployment of the feature branch, plus the local demo at http://localhost:4010/document-verify.

### D-05 · 2026-10-14 · The demo route opens without a login, outside production only
`/document-verify` is added to `src/proxy.ts` so it opens without a login in development and on Vercel preview deployments, and returns 404 in production. This doesn't weaken any existing route.
Applied in: `13265b24`.

### D-04 · 2026-10-14 · Where the work lives
`~/craft`, a fresh clone of the fork `Chaiidesign/craft`, on a new branch `feat/document-quality`. The only remote is `origin`, the fork.

### D-03 · 2026-10-14 · How each step runs
Plan first and get approval before building. After each step, explain in plain language what exists and how to see it. If the PRD is ambiguous or conflicts with the repo, stop and ask instead of guessing. No commit or push until the report is approved — **superseded by D-43**.

### D-02 · 2026-10-14 · Mock data only
Mock and local data only: no backend calls, no auth work, no invented environment values. Fixtures are fictional and labelled as sample data.

### D-01 · 2026-10-14 · All work stays in the fork
All work stays in `Chaiidesign/craft`, never upstream. `Flowting-ai/front-end` and `souvenir-inc/may-day` are read-only references. Don't change remotes, pull or merge upstream, add secrets or overwrite unrelated edits.
