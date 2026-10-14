# Document-quality prototype

Mock-data prototype of Souvenir's document design system: invoice and brief templates, document tokens and layout primitives, and (in later steps) pagination, revisions and real PDF/DOCX/PPTX exports. Fixtures are fictional. Nothing here calls a backend, AI service, auth provider or sending channel.

- **Workbench:** `/document-verify` — run `npx next dev -p 4010`, open http://localhost:4010/document-verify. Available in development and on Vercel preview deployments; 404 in production.
- **Tests:** `npx vitest run src/lib/documents src/components/documents`

This README grows with each build step. Sections marked *(Step N)* describe work not built yet.

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
| Workbench page | `src/app/document-verify/` |

A **document plan** is the renderer-neutral output of a template: an ordered list of primitive nodes with all display text already derived from typed values. The **layout engine** turns a plan into pages: it breaks lines with the theme's real font metrics and places blocks by meaning. The HTML preview draws the engine's lines at the engine's positions, and the PDF renderer (Step 5) will draw the same lines, so every surface wraps and breaks pages identically.

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

Every page records **why** it began (shown with "Show page-break reasons" in the workbench). Spacing between blocks lives in `FLOW` and the rules in `KEEP` in `tokens.ts`. These rules are written so the DOCX writer (Step 5) can map them to Word's keep-with-next, keep-lines-together, can't-split-row and repeat-header settings.

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

**Known gap:** Japanese-locale yen (`ja-JP`) formats with the full-width sign ￥ (U+FFE5), which no placeholder face contains. No fixture uses it. It is recorded by a test as missing and is **never** silently swapped for ¥. Approved handling: the layout engine refuses the document with an explicit error (preview now; export validation in Step 5). In practice the whole `ja-JP` locale is refused: its dates use 年, 月 and 日, which the placeholder faces also lack.

### Non-Latin scripts

The Noto fallback is **not** committed. Text in scripts outside the placeholder faces' Latin coverage (for example Devanagari) is an explicit unsupported state, not a silent fallback. Complex-script shaping (reordering, conjuncts) depends on each renderer: browsers shape, jsPDF does not, and Word/PowerPoint depend on installed fonts. Any future support must be tested per renderer.

### Renderer caveats *(Step 5)*

- **PDF:** fonts embedded from the same TTFs (jsPDF native text, not page screenshots).
- **DOCX:** families declared by name-table name and embedded where the format allows. Visual fidelity in Word is **unverified** — this machine has no Word/LibreOffice render check.
- **PPTX:** fonts referenced by name, fallback recorded; PowerPoint does not reliably honour embedded fonts across platforms. Visual fidelity **unverified**.
- Identical rendering across operating systems is not claimed.

## Revisions *(Step 4)*

Every document in the workbench lives in an **in-memory revision store** (`revisions.ts`). Reloading the page resets it; browser storage and broken-session recovery are Step 6.

- **Identity.** A document record has an output ID, a current revision and an ordered list of revisions; a revision has its own ID, its parent, a timestamp, an author, a change summary, the operation that made it and a snapshot. "v1, v2…" are display labels in creation order; the revision ID is the identity, so two documents (or a brief and its deck) with the same title never get confused.
- **Immutability.** Snapshots, revisions and records are deep-frozen when created: changing saved content throws. Every operation returns a new store; earlier stores are untouched.
- **Bounded edits.** One field value, one line item's description, quantity or unit price, or the text of one sentence or list item (citations stay attached). No adding or removing blocks or rows. An edit must start from the current revision; Save creates the next revision, Cancel changes nothing. Unchanged blocks, fields and the brand stay the very same objects, which is how "only this changed" is proven; totals are derived, so they follow. Invalid, blank, unchanged or out-of-scope edits are refused with a specific message and create no revision.
- **Issuer name is not editable.** Issuer identity comes from the brand profile (letterhead, footer, running header); editing the Issuer field alone would put two issuer names in one document, so the edit is refused with that reason, in the workbench and in the engine (`BRAND_OWNED_FIELDS`). Brand editing is outside Step 4.
- **Decks are derived artifacts.** They are not edited directly — a direct deck edit is refused; edit the brief and derive again.
- **Filling a missing field** is an edit: validation updates, and an unknown amount stays unknown until the fact that decides it is supplied.
- **Proposals** are fictional sample edits written against an exact revision, shown as before and after. Accept creates a revision ("Accepted proposal: …"); Reject changes nothing. A proposal whose base is no longer current can't be accepted.
- **Restore** creates a new current revision from an earlier one's content. Later revisions stay in history, and approval is not carried over.
- **Mock approval** is a marker on one exact revision: "Approved (sample) by … — applies to v{n} only". Every other revision reads "Not approved". Exports will target an explicitly selected revision (Step 5).
- **Deck ancestry.** A deck revision records the brief revision it was derived from. `checkAncestry` verifies that revision exists, belongs to that brief, is a brief, and that the deck is exactly what it derives. When the brief moves on, the deck keeps pointing at its source and says so; deriving again creates a new deck revision. A failed check reads "Ancestry check failed: {reason}".
- **Authors.** "Sample operator (fictional)" for edits and accepted proposals; "System" for creation from sample data, derivations and restores. Fixture 7's reviewer is "Sample reviewer (fictional)".

Scenarios 5–8 run in the workbench: 6, 7 and 8 on a fresh deterministic store with the real revision functions; 5 against the workbench's own brief, so editing that brief makes the deck stale.

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

New values and new document wording are proposed for approval before they are used.

## Known limitations

- **`ja-JP` locale is unsupported** by the placeholder fonts: its dates use 年, 月 and 日 and its currency the full-width ￥, which no committed face can draw. Layout stops with a clear "characters the fonts can't draw" error; nothing is substituted. (Approved behaviour.)
- Other non-Latin scripts are likewise refused until a face that covers them is added to a theme.

## Brand

Issuer-first: the letterhead shows the issuer's name, mark and accent colour; no Souvenir branding appears in documents. A missing logo, or one whose file fails to load, shows a dashed neutral box labelled "No logo supplied" / "Logo could not be loaded" — never an invented mark. Fixture logos are local files under `public/document-fixtures/` and are fictional.

## Known caveats of the demo route

- **Auth token request from the app shell.** The shared root layout (`src/app/layout.tsx`) wraps every page in the app's `AuthProvider`, which requests `GET /auth/access-token` on load. On `/document-verify` this returns an error locally (no Auth0 configuration) and is harmless. It is the app shell's session check, not a document service call; the document code makes no network requests other than loading its own font and fixture files. Left as is by decision.
- **Mixpanel on Vercel previews.** The same root layout mounts `MixpanelProvider`. Locally there is no token, so it is a no-op. On a Vercel preview with a Mixpanel token configured, the SDK initialises, but `/document-verify` is not mapped in `src/lib/analytics/screens.ts`, so no `screen_viewed` fires, and the document code tracks nothing. Left as is by decision; if the route is ever mapped, this changes.
- **Pre-existing test failure.** `src/lib/theme.test.tsx` ("theme.css is additive and in sync") failed before this work started and is unrelated.
