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
| Layout primitives (HTML preview) | `src/components/documents/DocumentPrimitives.tsx` |
| Preview sheet + font loading | `src/components/documents/DocumentPreview.tsx`, `useDocumentFonts.ts` |
| Workbench page | `src/app/document-verify/` |

A **document plan** is the renderer-neutral output of a template: an ordered list of primitive nodes with all display text already derived from typed values. The HTML preview renders it now; pagination (Step 3) and the PDF/DOCX/PPTX renderers (Step 5) will read the same plan, so every surface shows the same words, numbers and missing states.

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

`glyphs.ts` reads a TTF's character map with no dependency. `glyphs.test.ts` composes every fixture (recipient and internal views) and takes the plan's text inventory (`collectStyledText`): every string the plan carries, paired with the token style that draws it. It checks each character exists in that exact face (uppercased first where the style is uppercase). A parity test in `DocumentPrimitives.test.tsx` checks that every word the HTML preview draws appears in that inventory, so a label added to a primitive but not to the plan fails the build. Screen-reader-only words and the workbench's break-hint overlay are excluded. ₹, €, £ and $ are covered by both Money cuts, and by every other face too.

**Known gap:** Japanese-locale yen (`ja-JP`) formats with the full-width sign ￥ (U+FFE5), which no placeholder face contains. No fixture uses it. It is recorded by a test as missing and is **never** silently swapped for ¥. Approved handling: export is refused for a face that lacks a character the document needs (enforced in Step 5 export validation).

### Non-Latin scripts

The Noto fallback is **not** committed. Text in scripts outside the placeholder faces' Latin coverage (for example Devanagari) is an explicit unsupported state, not a silent fallback. Complex-script shaping (reordering, conjuncts) depends on each renderer: browsers shape, jsPDF does not, and Word/PowerPoint depend on installed fonts. Any future support must be tested per renderer.

### Renderer caveats *(Step 5)*

- **PDF:** fonts embedded from the same TTFs (jsPDF native text, not page screenshots).
- **DOCX:** families declared by name-table name and embedded where the format allows. Visual fidelity in Word is **unverified** — this machine has no Word/LibreOffice render check.
- **PPTX:** fonts referenced by name, fallback recorded; PowerPoint does not reliably honour embedded fonts across platforms. Visual fidelity **unverified**.
- Identical rendering across operating systems is not claimed.

## Brand

Issuer-first: the letterhead shows the issuer's name, mark and accent colour; no Souvenir branding appears in documents. A missing logo, or one whose file fails to load, shows a dashed neutral box labelled "No logo supplied" / "Logo could not be loaded" — never an invented mark. Fixture logos are local files under `public/document-fixtures/` and are fictional.

## Known caveats of the demo route

- **Auth token request from the app shell.** The shared root layout (`src/app/layout.tsx`) wraps every page in the app's `AuthProvider`, which requests `GET /auth/access-token` on load. On `/document-verify` this returns an error locally (no Auth0 configuration) and is harmless. It is the app shell's session check, not a document service call; the document code makes no network requests other than loading its own font and fixture files. Left as is by decision.
- **Mixpanel on Vercel previews.** The same root layout mounts `MixpanelProvider`. Locally there is no token, so it is a no-op. On a Vercel preview with a Mixpanel token configured, the SDK initialises, but `/document-verify` is not mapped in `src/lib/analytics/screens.ts`, so no `screen_viewed` fires, and the document code tracks nothing. Left as is by decision; if the route is ever mapped, this changes.
- **Pre-existing test failure.** `src/lib/theme.test.tsx` ("theme.css is additive and in sync") failed before this work started and is unrelated.
