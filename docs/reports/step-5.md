# Step 5 report — real exports

- **Reported:** 2026-10-14 (UTC). **Commit:** `8a05e154` (79 files, +3,050 / −48, including the sample files and page images).
- **Decisions:** D-35 to D-38 in [../decisions.md](../decisions.md).
- Backfilled from the Step 5 report given in the build session.

## Scope

PRD §10 (export fidelity), the export rows of §9, and fixtures 7 and 9: real PDF, Word and PowerPoint files of one explicitly chosen, frozen revision, with per-format capability, status and retry, and a preview of the generated PDF itself.

## What was built

- **One fixed revision per export.** The export uses the revision being viewed, frozen when it starts; later edits can't change it. Fixture 7 exports v1 while v2 is current, then reads the PDF's own text back to prove it is v1.
- **Formats:** invoices and briefs export as PDF and Word; decks as PowerPoint and PDF. Other buttons are disabled and show the approved reason.
- **Each format succeeds or fails on its own.** A second export of the same revision and format is blocked while one runs. A retry keeps the original revision.
- **Refusals:** drafts go through the approved warning and the file carries the draft marker. Invalid and empty revisions, characters the fonts can't draw, and blocks taller than a page are refused, each with a test that forces it.
- **PDF (jsPDF 4.2.1):** drawn line by line from the same layout as the preview; tests confirm the same pages and the same lines in order. Fonts embedded (jsPDF subsets to the characters used); the chart is drawn as shapes. Files 60–85 KB.
- **Word (docx 9.11.0):** native editable paragraphs and tables, all eight fonts embedded (a test confirms each embedded font matches the committed file byte for byte). Page-break rules become Word's own settings. The chart appears as a picture and as an editable data table, in the order title, picture, axes line, data table, summary. Files about 625 KB.
- **PowerPoint (pptxgenjs 4.0.1):** native text boxes and a native, editable bar chart. Fonts are named but can't be embedded.
- **Previews:** the generated PDF is shown with page count, fit/zoom and download, labelled "PDF preview (generated file, v{n})"; the layout preview is labelled "HTML preview (not the PDF)".
- **Samples** in `docs/documents/samples/` (5.1 MB): complete, long and draft invoices (PDF and Word), the brief (PDF and Word), the deck (PowerPoint and PDF), page images in `pages/`, and Pages/Keynote renders in `apple/`.

## Checks

- Typecheck and lint clean; `npx next build --webpack` passes (only the existing Auth0 warnings).
- Tests: 1,388 pass; the only failure is the known `theme.test.tsx`; 2 skipped.
- Browser, on the dev server and on a production preview build under the production security policy: PDF, its preview, Word and the deck's PowerPoint export all work; scenarios 7 and 9 pass every check; the forced Word failure followed by a retry works by hand.

## Visual inspection

- **PDF:** every page inspected, including all 4 of the long invoice — all 42 rows present, the table header repeats on each page, the last 2 rows sit with the totals, payment terms follow, every page has "Page n of N".
- **Word, opened in Pages:** Pages ignores the embedded fonts and uses Helvetica. Content, missing fields, draft marker, both chart forms and page numbers are correct. Pages won't start a table that doesn't fit in the space left on a page — confirmed even with every page-break rule removed — so in the long invoice the "Amounts in INR" caption sits alone on page 2 and the table starts on page 3.
- **PowerPoint, opened in Keynote:** Keynote 14.1 drops every pptxgenjs chart, even a minimal one, so the chart slide has its text but no bars. Helvetica makes one long heading wrap onto the text below it.
- **Microsoft Word and PowerPoint:** not installed; unverified.
- Fixes made after seeing the Pages renders: a blank trailing page in Word, a missing paragraph in the first-page header, and the running-header spacing.

## Decisions asked, and the verdicts (D-38)

1. `next.config.ts` always declares `turbopack` (needed once the webpack rule exists). → approved.
2. Word's running header 24pt from the top edge. → approved.
3. `sharp` undeclared. → declare as a devDependency.
4. New workbench text. → approved.
5. Short revision IDs as the last four hex digits of a hash. → approved.
- Also: the Word chart order confirmed; the Pages limitation documented without weakening Word's page-break rules.

## New user-facing text

The filename pattern; the draft warning, "Export draft", "Cancel"; the unavailable reasons; "Preparing {format} of v{n}…", "{format} of v{n} ready ({size})", "{format} failed: {reason}", "Retry {format} of v{n}"; "HTML preview (not the PDF)", "PDF preview (generated file, v{n})"; the export panel note; "Export {format}", "Preview", "Fit width", "100%", "150%", "Download {filename}"; the scenario 9 labels and checkbox; the duplicate-export refusal. Approved in D-35 and D-38.
