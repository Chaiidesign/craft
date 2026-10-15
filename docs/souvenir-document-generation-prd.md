# Souvenir document-generation design system

PRD + Claude Code build prompt | 13 October 2026 | Mock-data prototype

## Build instruction

Build this document-generation design system inside my `Chaiidesign/craft` fork. Focus only on the quality of generated documents: structure, typography, branding, pagination, arithmetic, revision integrity and PDF/DOCX/PPTX fidelity. Do not build a broader chat, output-card, composer, workspace or collaboration experience.

Use fictional deterministic fixtures and local state. No backend, AI calls, auth work, real customer data, production services or external sending. Verify repo identity, branch, remotes, package manager, existing libraries and working tree before editing. All changes stay in craft. Flowting-ai/front-end and souvenir-inc/may-day are read-only references. Do not change remotes, pull/merge upstream, alter existing API routes/auth guards, add secrets or overwrite unrelated edits. Stop if origin is not my fork.

Use an isolated document-quality demo and component gallery following existing repo conventions. An unprotected mock demo must contain no private data or service calls and must not weaken any existing protected route. Auth0 setup is outside this task, regardless of current setup status.

Print your plan, verified reuse map and available checks, then implement in testable steps. Stop before commit, push or deployment; show the diff and results for review. Do not bundle unrelated deployment/maxDuration changes.

## 1. Product goal

One structured document snapshot should produce a readable, issuer-branded and factually consistent PDF, editable DOCX or editable PPTX. Revisions must preserve unaffected content. Exported files must correspond to the exact selected revision, not whatever content happens to be current when rendering finishes.

Success means an operator can inspect the actual document and trust that:
- Its required facts are supplied or visibly missing, never invented.
- Totals, currency, citations and issuer identity agree across formats.
- Pages and slides break by meaning, not arbitrary character count.
- A small revision does not silently rewrite the rest of the document.
- A download is a real file of the stated format, not a success toast or renamed HTML.

## 2. Scope

### Build

- Invoice and evidence-backed brief templates.
- Brief-to-slide-deck adaptation with source-revision ancestry.
- Shared typed content model, validation, brand profile and immutable revisions.
- Document tokens and reusable layout primitives.
- Actual local PDF, editable DOCX and editable PPTX renderers where supported.
- Per-document/per-format capability registry and explicit unsupported states.
- A small document-quality workbench: choose fixture, inspect document, fix fields, make a bounded edit, inspect revisions and compare actual exports. No chat required.
- Fixture/component gallery, tests and visual evidence.

### Exclude

Chat/composer design, output cards, streaming message bubbles, generic AI status UI, real reviewer workflows, comments/collaboration, real approval enforcement, sending/sharing, auth, backend, cloud persistence, production wiring, live Brand kit ingestion, spreadsheets, legal/deal templates and other media.

A stored mock approval marker may test revision integrity, but do not build an ApprovalCard workflow. Generation states refer only to fixture preparation/rendering. Local storage, if used, is demo storage, not durable production persistence.

### Proposed defaults

Page sizes, type scales, field schemas, brand fallback, revision operations and export gates below are prototype requirements to test, not claims that existing Souvenir implements them. Keep defaults configurable and centralized.

## 3. Evidence and design consequences

The Output working spec records two actual invoice PDF tests: arithmetic was correct; omitted facts were not invented; PDFs used Souvenir branding instead of issuer letterhead; missing fields were collected in prose rather than beside affected fields; chat/PDF currency presentation differed. Prompts differed, so layout differences do not prove a model winner or absence of templates.

Consequences: issuer-first deterministic branding, field-level missing states, one typed value model, meaningful pagination and inspection of actual exported bytes. Versions are product state, not filenames. A claimed export must be distinguished from an existing artifact and from a visually verified artifact.

The may-day source audit established layered KDS tokens and reusable frontend components. It did not validate export rendering or production parity. Existing ArtifactCard, StreamingIndicator and StreamingMessageBubble serve the broader output experience and are deliberately excluded from this narrowed build. VersionCard may provide optional history presentation only; it does not supply document identity/persistence. ApprovalCard is a connector-action component and must not be treated as a document approval engine.

## 4. Reuse rules

Inspect actual APIs before editing. Do not copy screenshots and call it reuse. Do not assume may-day components or package versions exist in craft, and do not upgrade craft to match may-day.

- Reuse verified KDS app tokens/controls for the small workbench. Token layers are primitives -> aliases -> component semantics.
- KDS Button is the mandated control for a KDS slice. Audited may-day import: `@/components/Button`, variants default/ghost/outline/secondary/danger and md/sm. Resolve the actual equivalent in craft before importing.
- The separate `src/components/ui/button.tsx` uses Base UI/cva and is not a drop-in equivalent. Do not silently substitute it.
- App typography audited in may-day: Besley / Geist / Geist Mono. This does not settle document typography.
- Audited alias tokens are light-mode only. Build light mode; do not claim a dark theme from a dark Storybook canvas.
- Keep shared/upstream-owned modules intact. Add namespaced document tokens, layout primitives and adapters.
- If KDS source is absent or inaccessible, report the gap and leave a clearly named adapter boundary rather than inventing a package or pretending reuse happened.

## 5. Architecture and contracts

Use an isolated feature area under the repo's conventions: model/validation, fixtures, document-tokens, primitives/templates, revision logic, renderers, quality-workbench and tests. These are module responsibilities, not mandatory path spellings.

Define concrete TypeScript discriminated types for:
- `Document`: outputId, kind (invoice/brief/deck), title, currentRevisionId, revisionIds and optional derivedFrom outputId/revisionId.
- `Revision`: revisionId, outputId, parentRevisionId, timestamp, author, change summary and immutable snapshot.
- `DocumentSnapshot`: schema/template version, stable block/field IDs, typed values, locale/currency, brand profile/version, citations and layout preset.
- `Field`: stable ID, label, typed value, provided/missing/not-applicable status, required flag and validation messages. Not-applicable requires a documented fixture rule; it is not a way to dismiss missing facts.
- `Block`: heading, paragraph, list, field group, table, totals, image, chart, callout or source list with typed payloads.
- `BrandProfile`: issuer display name, supplied logo/letterhead assets, permitted palette, typography choice, asset status and version.
- `ExportRecord`: exportId, outputId, revisionId, format, pending/succeeded/failed/unsupported/expired status, artifact filename/MIME/byteSize/localURL and typed error. `expired` is a record reloaded from demo storage: the record and its file identity are kept, the file itself is not (no localURL).
- Optional mock review marker: reviewer, decision, timestamp and exact revisionId. No blanket document approval.

Use immutable snapshots as renderer inputs. Never regenerate content on export. Separate typed source values from formatted display text. Inject clock/IDs for tests. Own output/revision identity explicitly; never parse it from filenames.

Adapters expose `capabilities`, `validate(snapshot)`, `render(snapshot, options)` and typed success/error. Frontend adapter events may include revisionCreated, revisionRestored, fieldUpdated, exportStarted/Succeeded/Failed. They are not invented production endpoint contracts.

## 6. Document design system

Separate document rules from application chrome. Centralize:
- Typography: title, section, body, caption, numeric and source roles; weight, line height and spacing.
- Page geometry: size/orientation, margins, header/footer clearances, safe area and continuation rules.
- Tables: header/body/totals treatment, padding, borders, alignment and multi-page continuation.
- Brand: logo sizing, letterhead placement, issuer hierarchy, color use and fallback.
- Content: summary, hierarchy, callouts, charts, images/captions and citations.
- Slide geometry: 16:9 preset, safe areas, title/content/chart/closing layouts and minimum readable type.

Required primitives: Letterhead, TitleBlock, Summary, SectionHeading, Paragraph, List, KeyValueField, MissingField, Table, InvoiceLineItems, Totals, Callout, ImageWithCaption, ChartWithDataSummary, Citation, SourceList, PageFooter and PageBreakHint. Keep them reusable rather than bespoke markup per fixture.

Choose and document a proposed coherent type scale and spacing scale. Use a verified embeddable/available font; record licensing and renderer substitutions. Do not claim identical font rendering across operating systems without testing. App KDS fonts are inputs, not compulsory document fonts. Use tabular numerals where available for financial values.

Default branding: supplied fictional issuer identity, restrained palette, no Souvenir marketing header/footer. Missing assets use a labelled neutral fallback, not an invented logo. Keep the same issuer profile and layout preset across revisions and formats unless the edit explicitly changes them. Treat fallback and generator attribution as prototype choices awaiting product acceptance.

Internal notes stay out of recipient-facing exports by default. Draft/incomplete marks identify document readiness, not fake sender branding. Sources belong beside supported claims and in an exported source list.

## 7. Template and correctness rules

Invoice prototype schema: issuer/buyer identity, invoice number/date, currency, line items, quantities, unit prices, tax/discount applicability, subtotal/total and payment terms. Mark required versus optional per fixture; this is not a universal legal/tax standard.

- Calculate in integer minor units with explicit currency precision and configured rounding. Never calculate from formatted strings.
- Unknown tax is not zero. If an unresolved field affects total, show an incomplete total rather than a false final amount.
- Derived values update when source values change; unrelated content stays unchanged.
- Currency symbols, decimal formatting, totals and negative values must agree in model, preview and exports.

Brief prototype schema: title, intended audience, summary, goals, constraints, recommendations, evidence and sources. Never invent a supporting source. Fixture citations are visibly fictional, with no fake real-world URLs.

Deck adaptation references the originating brief revision. Preserve mandatory facts and citations while adapting hierarchy to slides. Do not place document-page screenshots on slides or truncate meaning to fit. Identify any deliberate summary and retain source content in the model.

## 8. Pagination by meaning

Proposed presets: A4 portrait and optional Letter for invoice/brief; 16:9 for deck.

- Keep a heading with its first content. Avoid stranded headings and widows/orphans where supported.
- Repeat table headers on continuation pages. Keep rows together when they fit; define continued-row behavior for a row taller than a page.
- Keep totals together with identifying invoice context. No cropped cells or content lost below margins.
- Keep chart/image, caption and source together where possible.
- Use semantic break hints and available page space, not fixed character counts.
- Continuation pages carry page numbers and document identification.
- Split dense slide content meaningfully. Never shrink text to unreadable size to force a single slide.
- Charts include units, labels and a data summary. Color is not the sole encoding.

## 9. Quality-state inventory and acceptance

Every state needs a fixture and a test where applicable.

| State | Acceptance criterion |
| --- | --- |
| Fixture/input validation | Unsupported/invalid values have specific messages. No invented replacement facts. |
| Preparing/rendering | Exact revision/format shown; cancellable where supported; no false complete/approved label. |
| Partial content | Clearly partial; cannot become a final export silently. Late cancelled events cannot overwrite a newer snapshot. |
| Structured preview | All fields, missing values, sources and totals inspectable; labelled HTML/document view, not called PDF. |
| Actual PDF preview | Uses generated PDF bytes; page count, fit/zoom and download refer to selected revision. |
| Preview error | Draft/model survives; identify renderer versus viewer failure and offer retry/structured view. |
| Missing fields | Shown beside affected fields plus navigable summary; filling a field updates validation. Never use zero as unknown. |
| Direct/bounded edit | Selected block/field is explicit. Save creates revision; cancel leaves accepted snapshot untouched. Unrelated blocks/brand remain unchanged. |
| Proposed edit | Before/after view; accept creates revision, reject changes nothing. Proposal is not applied content. |
| Revision history | Current versus viewed revision labelled; change summary and ancestry preserved. Duplicate filenames cannot confuse identity. |
| Restore | Creates a new revision from old content without deleting later history or inheriting old approval. |
| Approved old snapshot/new edit | Mock marker stays on old revision; new revision is unapproved. Export targets selected snapshot explicitly. |
| Draft/incomplete export | Explicit warning and visible draft marker. Missing required fields never masquerade as final readiness. |
| Export pending | Format/revision fixed; duplicate job blocked or idempotent. Subsequent edits do not retarget the job. |
| Export succeeded | Nonempty real artifact, correct MIME/extension and revision record; download works. Visual fidelity separately checked. |
| Export failed/partial success | Errors per format; successful formats remain usable; retry retains original target unless explicitly changed. |
| Unsupported format | Honest disabled action and reason, no renamed PDF/HTML/image passed off as DOCX/PPTX. |
| Empty/error/reset | Useful explanation and recovery; no unexplained blank canvas, crash or silent data loss. |

## 10. Export fidelity

Target capabilities: invoice/brief -> PDF and DOCX; derived deck -> PPTX and PDF where supported. Do not invent invoice-to-slide semantics to fill a menu.

- PDF: actual PDF bytes; inspect typography, pages, totals, currency, margins, table headers, branding and citations.
- DOCX: editable native text/tables and styles, not screenshots. Open the actual document; record pagination/font differences from PDF.
- PPTX: editable native slide content where supported. Identify image-based charts explicitly and retain data summary; do not claim every chart is editable.
- Export exactly one frozen revision. Approval is not export success, and export is not sending.
- A format button is a capability claim. Show it only when supported; failure/unsupported states must remain honest.
- Use verified installed renderers first. Explain required dependency additions; no paid services, new backend endpoints or guessed libraries.
- Same snapshot yields stable content/layout/brand. Byte-for-byte determinism is not required when library metadata includes timestamps; document that difference.

If a format cannot be implemented locally, complete its interface and failure/unsupported UI and report it incomplete. Never substitute a different format silently. Download success is not proof of visual fidelity.

## 11. Fixtures and tests

All fixtures are fictional and labelled sample data:
1. Complete branded invoice with exact expected integer arithmetic.
2. Missing address/due date/tax applicability; incomplete total where needed.
3. Long invoice: 40+ rows, long descriptions, tall row and totals at page boundary.
4. Evidence-backed brief with citations, long headings, chart and source list.
5. Brief-to-deck with ancestry and meaningful slide splits.
6. One-line-item/one-sentence edit; unchanged-block comparison.
7. Approved v1 -> unapproved v2; selected-version export.
8. Restore v1 after v3 -> new v4 with ancestry.
9. PDF success, DOCX failure, unsupported capability; no blanket success.
10. Missing/broken logo, long issuer name and stable neutral fallback.
11. Empty, renderer/viewer error, cancellation, duplicate filenames and malformed local-session recovery.

Required assertions: typed arithmetic/rounding, no invented missing values, revision immutability, unchanged blocks on bounded edits, brand stability, revision-specific approval marker/export, restore ancestry, per-format capability and partial success.

Use semantic, labelled workbench controls, visible keyboard focus, sensible dialog focus/return, meaningful live announcements and reduced motion. Provide a screen-reader-readable structured document view. Do not claim tagged/accessible exported PDF unless generated and checked.

At 320/390px, workbench labels and controls fit without page-level overflow. A page canvas may have clearly labelled zoom/fit controls; the structured content must remain readable without pinch zoom. Inspect desktop too.

## 12. Implementation and completion

Sequence: repo/reuse check -> types/fixtures/validation -> tokens/primitives/templates -> revision rules -> real renderers -> small quality workbench -> assertions/visual checks.

Deliver the isolated demo/gallery, shared model/tokens/primitives, renderer registry, real sample files for supported formats, tests and README. README states run command, demo route, proposed defaults, dependencies, font substitutions, reset behavior and every unsupported capability.

Run actual available typecheck/build/test scripts and report exact commands/results. KDS source checks were not proof of passing interaction/a11y tests; new work needs its own checks.

Inspect actual pixels: phone/desktop document previews, all long-invoice PDF pages, opened DOCX and PPTX where tooling permits. Check clipped content, hierarchy, meaningful breaks, totals, letterhead and citations. Extraction or ZIP validation is not visual inspection. If native-file visual inspection is unavailable, report it as unverified, not passed.

Final report: changed files, commands/results, screenshots, sample export paths and limitations. Stop before commit/push/deploy. A frontend prototype with honest format limitations can be reviewed, but unsupported formats remain incomplete. Engineering later supplies production persistence, auth, endpoints and release acceptance.

## Reference evidence

Private links may need access. This document is self-contained; references are evidence, not runtime dependencies or authority to widen scope.

- Output working spec, generation 18 at preparation: https://files.instinct.com/suiqsztgggc4-souvenir-output-spec-v0
- Package declarations: https://github.com/souvenir-inc/may-day/blob/7ca68386813eb4e26755b94a77af47bcd3b87c37/package.json
- KDS extension-fork context: https://github.com/souvenir-inc/may-day/blob/7ca68386813eb4e26755b94a77af47bcd3b87c37/apps/may-day/README.md
- Light-mode aliases: https://github.com/souvenir-inc/may-day/blob/7ca68386813eb4e26755b94a77af47bcd3b87c37/src/styles/tokens/aliases.css
- History base: https://github.com/souvenir-inc/may-day/blob/7ca68386813eb4e26755b94a77af47bcd3b87c37/src/components/VersionCard/index.tsx
- Connector approval base (not a document engine): https://github.com/souvenir-inc/may-day/blob/7ca68386813eb4e26755b94a77af47bcd3b87c37/src/components/ApprovalCard/index.tsx
