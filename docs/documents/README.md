# Document-quality prototype

Mock-data prototype of Souvenir's document design system: invoice and brief templates, document tokens and layout primitives, pagination, revisions, real PDF, Word and PowerPoint exports, and browser-session storage with recovery. Fixtures are fictional. Nothing here calls a backend, AI service, auth provider or sending channel.

- **Workbench:** `/document-verify` — run `npx next dev -p 4010`, open http://localhost:4010/document-verify. Available in development and on Vercel preview deployments; 404 in production.
- **Tests:** `npx vitest run src/lib/documents src/components/documents src/app/document-verify`
- **Sample exports:** `npx vite-node scripts/documents/export-samples.ts`, then `scripts/documents/render-sample-pages.sh` for page images (see [Exports](#exports-step-5)).
- **Checks:** typecheck `npx tsc --noEmit -p .`; lint `npx eslint src/lib/documents src/components/documents src/app/document-verify scripts/documents next.config.ts`; full suite `npx vitest run`; build `npx next build --webpack`. Use `npx next …` directly: the repo's `npm run dev` / `npm run build` first load secrets from AWS, which fails without credentials.
- **Before you rely on it:** read [Unsupported and unverified](#unsupported-and-unverified) — in particular, Word and PowerPoint files were checked only in Apple's Pages and Keynote, which substitute Helvetica for the document fonts.
- **Build record:** spec [../souvenir-document-generation-prd.md](../souvenir-document-generation-prd.md), decisions [../decisions.md](../decisions.md), step reports [../reports/](../reports/).

This README grows with each build step; a section heading names the step that built it.

## Where things live

| Responsibility | Path |
|---|---|
| Typed model, money, validation | `src/lib/documents/model.ts`, `money.ts`, `invoice.ts`, `validation.ts` |
| Fixtures (PRD §11) | `src/lib/documents/fixtures/` |
| Font theme (the only file naming font families) | `src/lib/documents/theme.ts` |
| Committed fonts and licences | `src/lib/documents/fonts/` |
| Design tokens (type, spacing, page, table, brand, slide) | `src/lib/documents/tokens.ts` |
| Templates: snapshot → document plan | `src/lib/documents/compose.ts` |
| Font metrics (TTF advances, no dependency) | `src/lib/documents/metrics.ts` |
| Layout engine: line breaking, blocks, pagination, slides | `src/lib/documents/layout/` |
| Brief → deck adaptation | `src/lib/documents/deck.ts` |
| Revisions: store, bounded edits, proposals, restore, approval markers, deck ancestry | `src/lib/documents/revisions.ts` |
| Revision sample data (proposals, reviewer) | `src/lib/documents/fixtures/revisions.ts` |
| Workbench editors, history, scenario runners | `src/app/document-verify/Editors.tsx`, `RevisionPanels.tsx`, `scenarios.ts` |
| Layout primitives (HTML preview) | `src/components/documents/DocumentPrimitives.tsx` |
| Paged preview, deck preview, font loading | `src/components/documents/DocumentPreview.tsx`, `DeckPreview.tsx`, `useDocumentFonts.ts` |
| Exports: capabilities, filenames, adapters, jobs, PDF / Word / PowerPoint renderers | `src/lib/documents/export/` |
| Glyph outlines (chart picture in Word files) | `src/lib/documents/outlines.ts` |
| Export panel, generated-PDF preview, browser export resources | `src/app/document-verify/ExportPanel.tsx`, `src/components/documents/PdfFilePreview.tsx`, `exportResources.ts`, `pdfjs.ts` |
| Sample exports and their page images | `docs/documents/samples/`, `scripts/documents/` |
| Browser session: save, load checks, recovery; session fixtures | `src/lib/documents/session.ts`, `src/lib/documents/fixtures/sessions.ts` |
| Export runner, section error screen, viewer opening | `src/app/document-verify/exportRunner.ts`, `SectionBoundary.tsx`, `src/components/documents/viewerOpen.ts` |
| Workbench page | `src/app/document-verify/` |

A **document plan** is the renderer-neutral output of a template: an ordered list of primitive nodes with all display text already derived from typed values. The **layout engine** turns a plan into pages: it breaks lines with the theme's real font metrics and places blocks by meaning. The HTML preview draws the engine's lines at the engine's positions, and the PDF renderer draws the same lines at the same positions, so the preview and the PDF wrap and break pages identically. Word and PowerPoint lay text out themselves; see [Exports](#exports-step-5).

## Layout and pagination

### How text is measured

`metrics.ts` reads each committed TTF's character map and advance widths. Width = advance × size ÷ units-per-em, plus letter-spacing per character, with **no kerning** — exactly how jsPDF measures embedded TrueType text (`metrics.test.ts` checks this against jsPDF to within 0.001pt). The preview turns kerning and ligatures off and draws each engine line as one unbreakable line, so the browser cannot re-wrap. In the browser, the same font bytes are registered with `FontFace` and parsed for metrics: layout only runs once they have loaded, and never with a fallback face.

Line breaking (`layout/text.ts`) breaks at spaces, after hyphens, dashes and slashes, and at explicit newlines; never at a no-break space and never between touching pieces in different styles, so a citation marker always stays with its claim. A word wider than its column breaks between characters rather than overflowing. A character the face cannot draw stops layout with an explicit error.

### Pagination rules (PRD §8)

| Rule | How it is applied |
|---|---|
| Headings stay with their content | A heading moves to the next page unless it fits with the first lines (or the whole unsplittable block) that follow it. |
| Widows and orphans | Paragraphs and list items keep at least 2 lines at the foot and 2 at the head of a page; a 3-line paragraph never splits. |
| Tables | Split between rows; the header row repeats on every continuation (`Line items (continued)`). |
| Row taller than a page | Splits by description lines. Numbers appear on its first part; later parts carry "Continued from previous page". |
| Totals | Never split, and share a page with the end of the last line-item row plus at least the last 2 whole rows, moving rows forward if needed. If 2 rows and the totals cannot fit on any page, as many as can (1) go; if not even the last row can, the totals start a page and say why. |
| Payment terms | Always directly after the totals, on the same page — never alone on a page. On the long invoice the last page carries the last rows, the totals and the terms. |
| Kept together | Letterhead, title block, field groups, summaries, callouts, a chart with its title, units and data summary, an image with its caption, each source entry. |
| Preferred breaks | Before each section of a brief, start a new page when under 120pt remains. |
| Every page | "Page n of N" and the document identification in the footer (shortened by measured width with an ellipsis when long); pages 2+ carry a running header with the identification and draft state. |
| Too big to fit | Anything that cannot fit an empty page is an explicit layout error. Nothing is clipped, shrunk or substituted. |

Every page records **why** it began (shown with "Show page-break reasons" in the workbench). Spacing between blocks lives in `FLOW` and the rules in `KEEP` in `tokens.ts`. The Word renderer maps them to Word's keep-with-next, widow-control, can't-split-row and repeat-header settings (see Exports).

### Tests

`layout/paginate.test.ts` lays out every fixture in A4 and Letter and checks: every line, row and item appears exactly once in order; nothing extends below the content area; no page ends on a heading; split paragraphs keep the 2-line minimums; every table fragment has its header; totals share a page with their last rows; every page has its footer and (after page 1) running header. Sweeps over row counts and filler lengths force each rule to fire, a synthetic row taller than a page proves row splitting, an oversized field group proves the explicit error, and a `ja-JP` invoice proves glyph refusal.

In the browser (desktop width, the page's own zoom accounted for), every drawn line was compared with the engine's measured width for all seven document fixtures in A4 and in Letter, and for the deck slides: 1,268 lines in all. No line drew more than 0.022px wider than measured (the largest difference either way was 0.5px), and no fragment's content extended past its engine height. Re-checked after the shared-slide and payment-terms changes (now 6 slides and a 4-page long invoice): same result. Phone widths (390px and 320px) scale the pages down with no horizontal scroll.

### Fixture notes

- The long invoice (fixture 3) runs to four pages. The tall row `li-18` fits on one page, so row splitting is proven by a synthetic test row, not the fixture. Its totals land with 16 rows; the "rows moved with totals" rule is proven by the row-count sweep, and the degraded cases by a sweep with a near-page-tall last row.
- On the long invoice, the last page carries the last rows, the totals and the payment terms (approved: terms never strand alone).

## Brief → deck *(fixture 5)*

`deriveDeck(brief, { outputId, revisionId })` adapts a brief into a 16:9 deck and records the exact source it was given. In the workbench, decks are stored as revisions (`deriveDeckRevision`) and the recorded source is verified against real brief revisions (`checkAncestry`; see Revisions).

- Hierarchy changes, facts do not: every recipient block keeps its words, numbers and citations. Nothing is summarised, so no slide sets `summaryOf`. The internal note is left out.
- Slides: a title slide (the brief's own field labels and values), content slides per section, the chart on its own slide with its units and data summary, and a closing sources slide.
- At most two short consecutive sections share a slide, each keeping its own heading (a heading gap apart). Sections are only combined when each fits a slide alone and both fit together; split sections and chart slides never share.
- Dense content splits across slides by block, then list item, then sentence; continuation slides repeat the heading with "(continued)". Text never goes below 18pt (body) or 12pt (captions, citations, chart summaries). One sentence too large for an empty slide is an explicit error.
- Slides use the same font metrics and line breaking as print.
- In the workbench, scenario 5 derives the deck from the workbench's own brief and checks its ancestry against real revisions: current, stale after the brief is edited, or a failed check.

## Typography

### Roles and placeholder families

All four placeholders are SIL OFL 1.1 and committed **unmodified** as static TTFs, each with its own licence file. No variable fonts: exports embed exactly these cuts.

| Role | Used for | Placeholder | Committed cuts | Source |
|---|---|---|---|---|
| **Voice** | Body, section headings, pull quotes, emphasis, prose numerals | Newsreader, 16pt optical master | Regular 400, Italic 400, SemiBold 600 | productiontype/Newsreader `fonts/static/ttf` |
| **Display** | Document title, issuer name | Archivo SemiCondensed | SemiBold 600 | Omnibus-Type/Archivo `fonts/ttf` |
| **Function** | Labels, captions, dates, table text, footer, draft marker, citations | IBM Plex Sans | Regular 400, Medium 500 | IBM/plex release `@ibm/plex-sans@1.1.0` |
| **Money** | Every amount, quantity, ID and reference number (tabular — the face is monospaced) | IBM Plex Mono | Regular 400, Medium 500 | IBM/plex release `@ibm/plex-mono@2.5.0` |

- **Why the 16pt Newsreader master:** Newsreader ships static cuts at 6pt, 16pt and 72pt. 16pt is the text master and the nearest to the 10.5–14pt sizes Voice is used at; the 72pt display cut would look thin at a 13pt heading, and Display owns the large sizes anyway.
- **Licences:** `Newsreader-OFL.txt`, `Archivo-OFL.txt`, `IBMPlexSans-OFL.txt`, `IBMPlexMono-OFL.txt`. IBM Plex carries the Reserved Font Name "Plex"; the files are unmodified, so that is satisfied. All faces allow embedding (OS/2 fsType 0).
- **Name-table strings** for each face are recorded in `theme.ts` and verified against the TTFs by test. DOCX and PPTX must reference fonts by exactly these names. Note the static cuts carry legacy family names such as "Newsreader 16pt SemiBold" and "IBM Plex Mono Medm".

### Swapping a font

The final pick is **deferred**. It will be made by rendering the same fixture document in candidate themes and comparing them side by side (an A/B render comparison), not by this placeholder choice.

To trial a candidate: drop the TTFs and licence into `src/lib/documents/fonts/`, add a theme to `THEMES` in `theme.ts` (one face entry per committed cut, with its literal `new URL('./fonts/…', import.meta.url)`), and point a brand profile's `themeId` at it. No other file changes. `theme.test.ts` then checks the name tables, static-ness, embedding permission and licences, and fails if a family name leaks into any other file under `src/`.

### Type scale (points)

| Token | Role, weight | Size / leading | Tracking |
|---|---|---|---|
| `title` | Display 600 | 28 / 1.15 | −0.01em |
| `issuerName` | Display 600 | 18 / 1.2 ¹ | 0 |
| `sectionHeading` | Voice 600 | 13 / 1.3 | 0 |
| `body` | Voice 400 | 10.5 / 1.5 | 0 |
| `emphasis` | Voice 400 italic | 10.5 / 1.5 | 0 |
| `pullQuote` | Voice 400 italic | 14 / 1.45 | 0 |
| `tableHeader` | Function 500 | 9.5 / 1.35 | 0 |
| `tableText` | Function 400 | 9.5 / 1.35 | 0 |
| `amount` | Money 400 | 9.5 / 1.35 | 0 |
| `reference` (invoice number, IDs) | Money 400 | 9.5 / 1.35 | 0 |
| `grandTotal` | Money 500 | 12 / 1.3 ¹ | 0 |
| `label` (labels, captions, dates) | Function 400 | 8.5 / 1.4 | +0.02em |
| `fieldValue` ² | Function 400 | 9.5 / 1.4 | 0 |
| `citation` (markers, source list) | Function 400 | 8 / 1.4 | 0 |
| `footer` (footer, page numbers) | Function 400 | 8 / 1.4 | 0 |
| `draftMarker` | Function 500, uppercase | 8.5 / 1.4 | +0.08em |

Slides: title Display 32/1.1, heading Display 24/1.2, body Voice 18/1.4, caption Function 12/1.35. Floors: **18pt** for slide body content, **12pt** for captions, citations and chart data summaries. Dense slides split; text never shrinks below a floor.

¹ Not given in the spec; proposed and approved (issuer name 1.2, grand total 1.3).
² Not named in the spec: values in key/value groups (party names, addresses, payment terms). Function 9.5/1.4 to match table text — proposed and approved.

### Rules enforced in code

- Money, quantity, ID and reference numerals use Money; numerals in prose use Voice. Approved applications: currency codes are Money; rates inside totals labels ("Tax (8.25%)") and chart values are Function; the invoice number repeated in the footer is Function 8.
- Emphasis is the real italic cut. The preview sets `font-synthesis: none`, so a missing cut can't be faked; there are no underlines.
- Letter-spacing is 0 except the title, labels/captions and the draft marker (tested).
- Only named weights: every token resolves to a committed face (tested).
- The preview reads typography only through `--doc-*` CSS variables generated from `tokens.ts`. A test fails on literal font sizes or families in the document CSS or primitives.

### Glyph coverage

`glyphs.ts` reads a TTF's character map with no dependency. Coverage is enforced in two places:

- **Layout refuses missing glyphs.** The layout engine measures every string it places with the exact face that will draw it; a character that face lacks stops layout with an explicit error naming the character and face. Nothing is drawn with an empty box or a substituted face.
- **The preview draws only measured lines.** `DocumentPrimitives.test.tsx` renders every fixture and checks that every line of text in the HTML is a line the engine measured (screen-reader-only text excluded; chart labels inside the SVG are measured separately).

`glyphs.test.ts` also checks every character in each fixture's plan against its face, and that both Money cuts carry every fixture currency symbol: ₹, €, £ and $ are covered by every face.

**Known gap:** Japanese-locale yen (`ja-JP`) formats with the full-width sign ￥ (U+FFE5), which no placeholder face contains. No fixture uses it. It is recorded by a test as missing and is **never** silently swapped for ¥. Approved handling: the layout engine refuses the document with an explicit error, in the preview and in every export (`font-missing-glyph`). In practice the whole `ja-JP` locale is refused: its dates use 年, 月 and 日, which the placeholder faces also lack.

### Non-Latin scripts

The Noto fallback is **not** committed. Text in scripts outside the placeholder faces' Latin coverage (for example Devanagari) is an explicit unsupported state, not a silent fallback. Complex-script shaping (reordering, conjuncts) depends on each renderer: browsers shape, jsPDF does not, and Word/PowerPoint depend on installed fonts. Any future support must be tested per renderer.

### Renderer caveats

See [Exports](#exports-step-5): the PDF embeds the TTFs; Word files name and embed them; PowerPoint files name them only. Identical rendering across operating systems is not claimed.

## Revisions *(Step 4)*

Every document in the workbench lives in an **in-memory revision store** (`revisions.ts`), saved to this browser's storage after every change (see [Session, recovery and errors](#session-recovery-and-errors-step-6)).

- **Identity.** A document record has an output ID, a current revision and an ordered list of revisions; a revision has its own ID, its parent, a timestamp, an author, a change summary, the operation that made it and a snapshot. "v1, v2…" are display labels in creation order; the revision ID is the identity, so two documents (or a brief and its deck) with the same title never get confused.
- **Immutability.** Snapshots, revisions and records are deep-frozen when created: changing saved content throws. Every operation returns a new store; earlier stores are untouched.
- **Bounded edits.** One field value, one line item's description, quantity or unit price, or the text of one sentence or list item (citations stay attached). No adding or removing blocks or rows. An edit must start from the current revision; Save creates the next revision, Cancel changes nothing. Unchanged blocks, fields and the brand stay the very same objects, which is how "only this changed" is proven; totals are derived, so they follow. Invalid, blank, unchanged or out-of-scope edits are refused with a specific message and create no revision.
- **Issuer name is not editable.** Issuer identity comes from the brand profile (letterhead, footer, running header); editing the Issuer field alone would put two issuer names in one document, so the edit is refused with that reason, in the workbench and in the engine (`BRAND_OWNED_FIELDS`). Brand editing is outside Step 4.
- **Decks are derived artifacts.** They are not edited directly — a direct deck edit is refused; edit the brief and derive again.
- **Store-level validation.** Whatever the UI does, the store refuses dates that aren't real calendar dates, amounts that aren't non-negative whole minor units or aren't in the invoice's currency (or when the invoice currency isn't set), and percentages outside 0–100%. Text is trimmed before saving (a sentence keeps its own joining spaces), so whitespace-only differences are "no change".
- **No-op refusals.** Restoring content identical to the current revision, and deriving a deck again from the brief revision it already came from, are refused with a specific message; no revision is created.
- **Record titles follow content.** When a revision changes a brief's title or an invoice's number, the document record's title is recomputed, so history, ancestry and "Derived from {brief title} v{n}" use the current title. The issuer address stays an editable document field; only the issuer name is brand-locked.
- **Approval on older revisions** stays available: approving a specific past version is legitimate.
- **Filling a missing field** is an edit: validation updates, and an unknown amount stays unknown until the fact that decides it is supplied.
- **Proposals** are fictional sample edits written against an exact revision, shown as before and after. Accept creates a revision ("Accepted proposal: …"); Reject changes nothing. A proposal whose base is no longer current can't be accepted.
- **Restore** creates a new current revision from an earlier one's content. Later revisions stay in history, and approval is not carried over.
- **Mock approval** is a marker on one exact revision: "Approved (sample) by … — applies to v{n} only". Every other revision reads "Not approved". Exports target an explicitly selected revision (see Exports); approval is not export success.
- **Deck ancestry.** A deck revision records the brief revision it was derived from. `checkAncestry` verifies that revision exists, belongs to that brief, is a brief, and that the deck is exactly what it derives. When the brief moves on, the deck keeps pointing at its source and says so; deriving again creates a new deck revision. A failed check reads "Ancestry check failed: {reason}".
- **Authors.** "Sample operator (fictional)" for edits and accepted proposals; "System" for creation from sample data, derivations and restores. Fixture 7's reviewer is "Sample reviewer (fictional)".

Scenarios 5–8 run in the workbench: 6, 7 and 8 on a fresh deterministic store with the real revision functions; 5 against the workbench's own brief, so editing that brief makes the deck stale.

## Exports *(Step 5)*

The workbench exports the revision being viewed: invoices and briefs as **PDF** and **Word**, derived decks as **PowerPoint** and **PDF**. Anything else is shown disabled with its reason ("Invoices and briefs have no slide format." / "Decks export as PowerPoint or PDF.") — there is no invoice-to-slides or deck-to-Word conversion. Everything runs in the browser; nothing is uploaded or sent.

**Rules (`export/jobs.ts`, `export/adapters.ts`).**
- One export = one frozen revision, chosen when it starts. The snapshot is taken from the revision store at that moment, so later edits never retarget it. Fixture 7 exports v1 while v2 is current and reads the PDF back to prove it is v1.
- Each adapter has `capabilities`, `validate(snapshot)` and `render(snapshot, options)` with a typed result. Records are `pending`, `succeeded` (filename, MIME type, byte size, local URL), `failed`, `unsupported` or `expired` (reloaded from browser storage: the record is kept, the file is not), with a typed error where one applies (`unsupported-format`, `validation-blocked`, `renderer-failed`, `font-missing-glyph`, `cancelled`). Events: `exportStarted`, `exportSucceeded`, `exportFailed`, `exportCancelled`.
- Formats succeed or fail independently; there is no blanket success. A second export of the same revision and format is refused while one is pending. A retry is a new record (`retryOf`) with the same revision and format. Approval is not export success, and export is not sending.
- A revision with missing required facts exports only after the draft warning ("This revision is a draft: {n} required facts are missing. The file will carry the draft marker." — "Export draft" / "Cancel"); the file carries "Draft — incomplete" in the title block and running header. An **invalid** revision is refused with its validation messages; the **empty** document is refused ("This invoice has no fields and no content blocks, so there is nothing to export."). Layout refusals (missing glyphs, a block taller than a page) refuse the export with the engine's message.
- Exports always use the recipient view (internal notes left out) and the snapshot's own page size, never the preview's A4/Letter or audience toggles.
- **Filenames:** `{issuer}_{document number or title}_v{n}_{short revision ID}.{ext}`, each name part capped at 40 characters (cut at a hyphen where possible); the short ID is the low four hex digits of FNV-1a over the revision ID. The name is for people; the revision ID in the record is the identity. A brief and its deck share issuer and title, so their PDFs differ only by short ID and, for decks, by being slides — the duplicate-filename fixture is Step 6.
- **Fixture 9** forces the Word renderer to fail at its render step — only in that scenario, labelled "Forced failure (scenario 9 only)", error "Forced renderer failure (scenario 9 only)" — while PDF succeeds and PowerPoint is unsupported; the retry keeps the original revision.

**PDF (jsPDF 4.2.1, native text).** Draws `paginate()` pages and slide layouts line by line at the engine's coordinates, every segment placed from its engine width (no re-measuring, no kerning), so line breaks, page breaks, totals, citations and the letterhead match the preview. Each face the document uses is embedded from the committed TTF as its own font, named by its PostScript name, so jsPDF maps no weights or styles. jsPDF subsets each face to the glyphs drawn (about 20–34 KB per face against 120–200 KB TTFs; it does not add the usual six-letter subset prefix, so `pdffonts` reports `sub no`). Sample PDFs are 60–85 KB. Charts are vector shapes. Baselines follow the browser's line-box rule with exact hhea metrics; the preview snaps to whole pixels, so the two differ by under 1px (≤ 0.7pt) per line. Tests check: PDF signature, page count = engine pages, every engine line on its own page in order (pdf.js text), the embedded faces equal the faces used, metadata.

**Word (docx 9.11.0).** Native paragraphs, runs and tables built from the same plan, with the engine's column widths and totals box. Fonts are named exactly as their TTF name tables (weights are separate families, so bold is never set and never faked) and **all eight faces are embedded** (`w:embedTrueTypeFonts`; a test de-obfuscates each `.odttf` back to the committed bytes). Page-break rules become Word settings: keep-with-next on headings, the last two line-item rows and the totals (so payment terms stay with them); widow control; rows that can't split (except a row taller than a page); repeating header rows; `PAGE` / `NUMPAGES` footer fields; a different first page so page 1 has no running header. The chart appears **twice, as approved**: a picture (SVG with every label drawn as glyph outlines, plus a PNG fallback) and an editable data table, with the title, axes line and data summary as text. Differences from the PDF, recorded:
- Word lays pages out itself: page breaks can differ from the PDF (the long invoice is 4 pages in the PDF and 5 in Pages).
- Word has one top margin for every page, so the running header sits in the top margin (24pt from the edge) and pages 2+ start higher than in the PDF; page 1 matches.
- Missing values are shaded runs with a dashed run border; some readers (Pages) show the shading but not the border.
- **Pages and long tables:** Pages will not start a table that is taller than the space left on a page partway down that page; it moves the whole table to the next page (tested with every keep rule, can't-split flag and repeating header removed — same result). Because the "Amounts in INR" caption keeps with its table, in Pages the long invoice's caption sits alone on page 2 and the table starts on page 3. Word normally splits such a table where it starts; unverified here. **Decision (approved):** this is recorded as a Pages limitation; Word's page-break rules (the caption's keep-with-next, can't-split rows, repeating headers) are kept as they are and not weakened to suit Pages.

**PowerPoint (pptxgenjs 4.0.1).** One native text box per engine item at the engine's position and size, holding real paragraphs and runs in the theme's named fonts; the chart is a **native, editable bar chart** with the source values, with its title, axes line and data summary kept as text on the slide. pptxgenjs cannot embed fonts: a viewer without them substitutes, and since PowerPoint wraps text itself, lines can then wrap differently and overflow their boxes.

**What was verified, and how.** Sample files are in `docs/documents/samples/` (made by `npx vite-node scripts/documents/export-samples.ts`); page images in `samples/pages/` and Apple renders in `samples/apple/` (made by `scripts/documents/render-sample-pages.sh`).
- **PDF:** every page of every sample rasterised with `pdftoppm` and inspected, including all four pages of the long invoice.
- **Word:** opened in **Pages** (Apple) and exported to PDF, every page inspected. Pages ignores embedded fonts and substitutes Helvetica; content, tables, Missing states, draft marker, chart picture, data table and page numbers all come through. **Microsoft Word itself is unverified** (not installed).
- **PowerPoint:** opened in **Keynote** (Apple) and exported to PDF, every slide inspected. Keynote substitutes Helvetica (wider than the condensed display face, so a long heading wraps to two lines and runs into the text below), and **Keynote 14.1 drops pptxgenjs charts entirely** — confirmed with a minimal one-chart file — so the chart slide shows its title, axes line and data summary but no bars. **Microsoft PowerPoint itself is unverified** (not installed); the chart XML is checked by tests.
- **Determinism:** files carry the time they were made (PDF creation date; Office core properties; jsPDF's random file ID), so reruns are not byte-identical. Content is deterministic.
- In the browser, the "PDF preview (generated file, v{n})" panel draws the exported bytes with pdf.js (page count, fit width / 100% / 150%, download); the paged preview above it is labelled "HTML preview (not the PDF)".

**Dependencies.** Runtime: `jspdf` 4.2.1, `docx` 9.11.0, `pptxgenjs` 4.0.1; `pdfjs-dist` 5.7.284 for the generated-PDF preview (its worker is `public/pdf.worker.min.mjs`, identical to the installed build). Dev only: `sharp` 0.34.5 (declared as a devDependency, the same version `next` brings) rasterises the Word chart picture's PNG fallback in Node for tests and the sample script. Page images need `pdftoppm` (poppler) and, for the Word/PowerPoint renders, Pages and Keynote with permission for the terminal to control them. Word files are about 625 KB because all eight faces are embedded.

**Build note.** pptxgenjs 4 contains `import('node:fs')` / `import('node:https')` for when it runs under Node; webpack can't bundle the `node:` scheme for browsers. `next.config.ts` therefore has a client-only `webpack` hook that maps exactly those two to empty modules, and now always declares `turbopack` (empty unless the design-system sibling is present) because Next 16 refuses to start Turbopack dev when a `webpack` hook exists without one.

## Session, recovery and errors *(Step 6)*

**What is kept.** One key, `souvenir-doc-workbench:v1`, holds the revision store (documents, revisions, approval markers), the export records and events, and which document is the derived deck, with `schemaVersion: 1`. It is written after every change and read once after the page mounts (so the server and first client render agree). This is demo storage in one browser, not production persistence. **Export files are never stored**: they would fill browser storage quickly (Word files are about 625 KB) and their download links die with the page. On reload a finished export comes back as "{format} of v{n} — file not kept after reload. Export again to download." with an **Export again** button (same revision, format and draft confirmation; a new export, not a retry), and an export that was still running comes back as "{format} of v{n} cancelled — the page was reloaded before it finished", so it can never block a new export.

**Loading checks everything first.** Shape, version, and references: every document's revisions exist and belong to it, the current revision is in its history, parents exist, a deck's source brief revision exists, approvals point at real revisions, export records point at real revisions, and every snapshot can be read by validation (including money as whole minor units). Fixture documents that are incomplete or invalid by design still load; only data validation can't read is refused. Loaded revisions are deep-frozen again.

**A malformed session is never silently replaced.** The banner says "The saved workbench session couldn’t be loaded: {reason}. Nothing has been changed yet. Changes won’t be saved while this banner is showing." with **Download the unreadable data** and **Start again from the sample fixtures**. Until one is chosen nothing is written, so the bad data stays where it was. Start again first copies it to `souvenir-doc-workbench:v1:backup`; if that copy fails, nothing is cleared and the save-failure warning shows instead. Reasons, one per kind, each with a test that forces it (`fixtures/sessions.ts` breaks one thing in a valid session per kind):

| Kind | Reason |
|---|---|
| Not JSON | it isn’t valid JSON |
| Unknown version | it was saved by an unknown version ({version}) |
| Wrong structure | its structure is wrong at {path} |
| Current revision not in history | {document}’s current revision isn’t in its history |
| Missing parent | revision {id}’s parent {parent} is missing |
| Missing deck source | deck {id} comes from brief revision {rev}, which is missing |
| Approval of a missing revision | an approval refers to revision {id}, which is missing |
| Snapshot validation can't read | revision {id} fails validation: {message} |

**Saving can fail.** If storage is full or blocked (some private modes throw on access), the workbench keeps working and says "Changes can’t be saved in this browser ({reason}). They will be lost on reload.", where the reason is the browser's own message.

**Reset.** **Reset workbench** (header) asks first: "This clears the saved session and reloads the sample fixtures. Exports and revisions you made will be lost." **Reset** clears the saved session and reloads the fixtures; **Cancel** (or Escape) leaves everything as it was. Focus returns to the Reset workbench button. If the saved session is malformed, Reset backs it up first, as Start again does. The backup key is never cleared by the workbench.

**Cancelling an export.** A running export shows **Cancel**. The PDF, Word and PowerPoint renderers run in the page and can't be stopped partway, so Cancel marks the record "{format} of v{n} cancelled — the result will be discarded when it arrives" (error code `cancelled`, event `exportCancelled`), and when the result arrives it is thrown away: no file, no object URL, no success event, no "ready" announcement, no preview switch. Announcements and the preview switch now follow the stored record after settling, not the render outcome (`exportRunner.ts`), which fixes a Step 5 path where a discarded result could still announce "ready". A cancelled export can be retried for the same revision. **Limit (accepted; see Known limitations):** Cancel can only take effect while an export is loading its fonts and images; once the renderer itself starts it runs to the end on the page's main thread, and no click is handled until it finishes (the result is then discarded). A warm export here takes about 0.1 s in all (Word 105 ms, PDF 83 ms, measured in the browser), so Cancel is hard to hit by hand; the tests and fixture 11 cancel while resource loading is held, then let the render finish late.

**Renderer vs viewer errors.** A renderer error is a failed export record with **Retry**; the document and its revisions are untouched. A viewer error means the file was made but the PDF viewer couldn't show it: "The PDF was generated ({size}) but the viewer couldn’t show it: {reason}. The download still works." with **Try the viewer again** and **Show the HTML preview**. A file no longer in memory is a viewer error too. While the alert shows, the Step 5 status line ("The PDF could not be shown.") is removed, so a screen reader announces one message.

**Section error screens.** The fixture inspector, the HTML preview and each export panel sit behind an error screen: "This section hit an error: {message}. Your revisions are unchanged." with **Try again**. The revision store lives above every screen, so a crash in a section can't lose it.

**Fixture 11** runs all of this with the real functions (16 checks): forced renderer error and retry, forced viewer error and re-open, cancel with a late result after the document moved to v2, duplicate filenames (the same revision exported twice gives the same filename and two records; a brief and its deck share a filename base and differ only in the short ID — identity always comes from the record, never the filename), a reload round trip, each malformed kind, Start again's backup and a failing save. "Try it by hand" exports the complete invoice with two scenario-only checkboxes, "Force a renderer failure (scenario 11 only)" and "Force a viewer failure (scenario 11 only)".

**Hydration fix.** IDs used `Date.now()` from the first render, so server and client HTML differed on revision IDs (a Step 4 hydration warning in dev). The first render now uses fixed `fx` IDs; from mount on, new IDs carry a prefix unique to the page load, so they never collide with IDs in a saved session.

## Approved working agreements

Recorded values (approved as recorded values, not spec changes):

| Value | Where |
|---|---|
| 2-line minimum on each side of a paragraph or list-item break | `KEEP.orphans`, `KEEP.widows` |
| 2 line-item rows kept with the totals | `KEEP.rowsWithTotals` |
| Preferred section break when under 120pt remains | `KEEP.preferredBreakMinSpacePt` |
| Chart plot height 128pt in print, 220pt on slides | `CHART.plotHeightPt`, `SLIDE_FLOW.chartPlotHeightPt` |
| Block spacing | `FLOW` (print), `SLIDE_FLOW` (slides) |
| Issuer name leading 1.2, grand total leading 1.3, field values Function 9.5/1.4 | `PRINT_TYPE` |

Approved Step 4 wording: history labels "v{n} · Current" and "Viewing v{n} — not the current revision"; change summaries "Created", "Edited {field label}", "Edited line {n}: {quantity / unit price / description}", "Edited text in {section heading}", "Accepted proposal: {proposal title}", "Restored from v{n}", "Derived from {brief title} v{n}"; "Approved (sample) by {reviewer} on {date} — applies to v{n} only" and "Not approved"; "Derived from brief v{n} — current", "Derived from brief v{n} — the brief now has v{m}. This deck does not update by itself; derive again to update." and "Ancestry check failed: {reason}"; authors "Sample operator (fictional)", "System" and reviewer "Sample reviewer (fictional)"; proposal titles "Clearer payment terms" and "Tighter evidence sentence". Workbench text (buttons, refusal messages, notes) approved as written. Em dashes (—) are used throughout, consistent with "Draft — incomplete".

Approved document wording: "Continued from previous page" (a row carried over a page break), "(continued)" after a repeated slide heading, "Page n of N" (pages) and "n / N" (slides), and a running header of issuer · document number plus the draft state on pages 2 onward. Payment terms never stand alone on a page. Up to two short consecutive sections may share a slide.

Approved Step 5 wording: the filename pattern; the draft warning, "Export draft" and "Cancel"; the unavailable reasons; the status labels "Preparing {format} of v{n}…", "{format} of v{n} ready ({size})", "{format} failed: {reason}" and "Retry {format} of v{n}"; the preview labels "HTML preview (not the PDF)" and "PDF preview (generated file, v{n})". Approved Step 5 choices: Pages/Keynote renders for the Word/PowerPoint check, the scenario-only forced Word failure, the built-in zip reader for tests, committed samples and page images, embedded fonts in Word, the chart as picture plus data table in Word, refusing invalid and empty revisions, the 40-character filename part cap, and the client-only webpack rule for pptxgenjs.

Approved Step 5 values and text: `WORD_HEADER_FROM_EDGE_PT = 24` (Word's running header 24pt from the top edge, inside the top margin); always declaring `turbopack` in `next.config.ts`; short revision IDs in filenames as the last four hex digits of the revision ID's FNV-1a hash; the Word chart order (title, picture, axes line, data table, summary); and the workbench text — the export panel note "Files are made in this browser from the revision you are viewing (v{n}), fixed when the export starts. Approval is not export, and export is not sending."; buttons "Export {format}", "Preview", "Fit width", "100%", "150%", "Download {filename}"; "Forced failure (scenario 9 only)", the error "Forced renderer failure (scenario 9 only)", the checkbox "Force a Word renderer failure (scenario 9 only)" and the scenario 9 "Try it by hand" note; the refusal "An export of this revision to {format} is already in progress ({export ID})."; and the HTML-preview note's added sentence.

Approved Step 6 decisions and text: the storage split (one versioned key for revisions and approvals; files never stored; records reload expired; running exports reload cancelled), malformed-session handling (banner, never silently replaced, backup key, one forced test per kind), cancel-and-discard with the stored-record fix, the renderer/viewer split with section error screens, the scenario 11 checkboxes, identity from the export record never the filename, and all the text quoted in [Session, recovery and errors](#session-recovery-and-errors-step-6).

Approved Step 6 follow-ups: the `expired` export status (PRD §5 updated to five statuses), Reset backing up a malformed session first, the hydration fix, generated malformed sessions in place of the Step 1 list, two-tab last-write-wins as a known limitation, and one announcement on a viewer error. Also approved, text added while building: the button "Export again" on an expired record; the error "Forced viewer failure (scenario 11 only)" and the renderer error for scenario 11, "Forced renderer failure (scenario 11 only)" (the scenario 9 one with its number changed), with the pill "Forced failure (scenario 11 only)"; the download filename `souvenir-doc-workbench-unreadable.json`; the announcements "Restored the saved workbench session.", "Started again from the sample fixtures." and "Workbench reset to the sample fixtures."; and the detail text inside "fails validation: {message}" (for example "line item “li-1” has a unit price that is not whole minor units").

New values and new document wording are proposed for approval before they are used.

## Proposed defaults

These are prototype requirements to test (PRD §2), not claims about what Souvenir already does. Each lives in one place and can be changed there.

| Default | Value | Where |
|---|---|---|
| Page sizes | A4 portrait (595.28 × 841.89pt) for the fixtures; Letter portrait (612 × 792pt) available | `PAGE_SIZES` in `tokens.ts`; each snapshot's `layoutPreset` |
| Page margins | 51pt (18mm) all round; footer clearance 24pt; running-header clearance 20pt | `PAGE` in `tokens.ts` |
| Slides | 16:9, 960 × 540pt, safe area and type floors (18pt body, 12pt captions) | `SLIDE`, `SLIDE_TYPE`, `SLIDE_FLOORS` in `tokens.ts` |
| Type scales and font roles | Print and slide scales; Voice / Display / Function / Money roles with placeholder families | `tokens.ts`, `theme.ts` (see [Typography](#typography)) |
| Rounding | Half-up away from zero, per line; discount and tax once on the summed amounts | `DOCUMENT_DEFAULTS` in `defaults.ts` |
| Currencies | USD, EUR, GBP, INR, JPY with their minor-unit digits | `CURRENCIES` in `defaults.ts` |
| Field schemas | Invoice and brief field IDs, labels and which are required | `INVOICE_FIELDS` (`invoice.ts`), `BRIEF_FIELDS` (`brief.ts`), `TEMPLATE_CORE_FIELDS` (`validation.ts`) |
| Brand fallback | No logo or a broken logo → labelled dashed box; logo at most 140 × 40pt; 2pt accent rule | `BRAND` in `tokens.ts`; [Brand](#brand) |
| Pagination | 2-line minimum each side of a break; 2 rows kept with the totals; preferred section break under 120pt | `KEEP`, `FLOW` in `tokens.ts` |
| Revision operations | Bounded edit (one field, one line item property, one sentence or list item), accept/reject proposal, restore as a new revision, derive deck; no deleting history | `revisions.ts` |
| Export gates | Supported format for the kind; not invalid; not empty; drafts need the warning confirmed; every character drawable; no block taller than a page; one pending job per revision and format | `export/capabilities.ts`, `export/adapters.ts`, `export/jobs.ts` |
| Demo storage | One browser-storage key, `souvenir-doc-workbench:v1`, plus a backup key; files never stored | `session.ts` |

## Unsupported and unverified

**Not supported (honest disabled or refused states, never a substitute format):**
- PowerPoint for invoices and briefs ("Invoices and briefs have no slide format."), and Word for decks ("Decks export as PowerPoint or PDF.").
- The `ja-JP` locale and other non-Latin scripts: refused with "characters the fonts can't draw"; no Noto fallback is committed.
- Fonts in PowerPoint files: named, not embedded (pptxgenjs can't embed fonts), so any viewer without them substitutes.
- Native Word charts: the `docx` library can't make them. Word files carry the chart as a picture plus an editable data table; the picture is image-based and is identified as such.
- Tagged / accessible PDF: the PDFs are not tagged, and no accessibility claim is made for exported files. The workbench's structured view is the screen-reader-readable view.
- Cancelling a renderer once it has started (see [Known limitations](#known-limitations)).

**Unverified:**
- **Microsoft Word and Microsoft PowerPoint have never opened these files** — neither is installed on the build machine.
- **Word files were checked only in Apple Pages, and PowerPoint files only in Apple Keynote. Both substitute Helvetica for the document fonts** (Pages ignores the fonts embedded in the Word file; PowerPoint files don't embed them). So the Pages and Keynote renders show the right content but not the intended typography, and their line and page breaks differ from the PDF.
- What Pages and Keynote got wrong, beyond the font: Pages won't start a long table partway down a page, so the long invoice's "Amounts in INR" caption sits alone on page 2 and its table starts on page 3; Pages drew one line-item row (row 11 of the long invoice, whose text wraps right at the cell edge) one line short, hiding its last word "11" — the Word file holds the full text; Keynote 14.1 drops every pptxgenjs chart, so the chart slide shows its title, axes line and data summary but no bars; and with Helvetica, long slide headings wrap to two lines and crowd the text below, and on slide 5 a wrapped list item runs into the callout. Whether Word and PowerPoint share any of these is unverified.

## Known limitations

- **`ja-JP` locale is unsupported** by the placeholder fonts: its dates use 年, 月 and 日 and its currency the full-width ￥, which no committed face can draw. Layout stops with a clear "characters the fonts can't draw" error; nothing is substituted. (Approved behaviour.)
- Other non-Latin scripts are likewise refused until a face that covers them is added to a theme.
- **Two tabs overwrite each other.** Each tab writes the whole session; the last write wins, so one tab's revisions can replace another's. No cross-tab syncing is built.
- **Edits while the malformed-session banner shows are not saved** (saving is paused so the unreadable data isn't overwritten); the banner says so: "Changes won’t be saved while this banner is showing." The workbench is deliberately not made read-only.
- **Deck headings repeated across a split section don't say "(continued)".** The deck gives a section's chart its own slide, so the evidence section spans slides 3–5 of the sample deck; slides 4 and 5 repeat its heading without "(continued)", which is only added when one slide's content overflows onto the next. Found in the Step 7 inspection; awaiting a decision.
- **Cancel only works while fonts and images load.** Once the renderer starts it can't respond until it finishes; its result is then discarded. No artificial slow render is built to widen the window.

## Brand

Issuer-first: the letterhead shows the issuer's name, mark and accent colour; no Souvenir branding appears in documents. A missing logo, or one whose file fails to load, shows a dashed neutral box labelled "No logo supplied" / "Logo could not be loaded" — never an invented mark. Fixture logos are local files under `public/document-fixtures/` and are fictional.

## Known caveats of the demo route

- **Auth token request from the app shell.** The shared root layout (`src/app/layout.tsx`) wraps every page in the app's `AuthProvider`, which requests `GET /auth/access-token` on load. On `/document-verify` this returns an error locally (no Auth0 configuration) and is harmless. It is the app shell's session check, not a document service call; the document code makes no network requests other than loading its own font and fixture files. Left as is by decision.
- **Mixpanel on Vercel previews.** The same root layout mounts `MixpanelProvider`. Locally there is no token, so it is a no-op. On a Vercel preview with a Mixpanel token configured, the SDK initialises, but `/document-verify` is not mapped in `src/lib/analytics/screens.ts`, so no `screen_viewed` fires, and the document code tracks nothing. Left as is by decision; if the route is ever mapped, this changes.
- **Pre-existing test failure.** `src/lib/theme.test.tsx` ("theme.css is additive and in sync") failed before this work started and is unrelated.
