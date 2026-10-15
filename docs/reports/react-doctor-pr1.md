# React Doctor findings on PR #1 — disposition

React Doctor (the repo's advisory CI check, `.github/workflows/react-doctor.yml`) reported **51 new findings** on commit `874fb039`: 1 error and 50 warnings, score 49/100. The check is advisory and passed. This file records what was done with each finding, as Instinct's review asked (D-45, condition 4).

**Summary:** 1 fixed (the error); 1 false positive; 2 recorded as known debt; 47 accepted with the reason given per rule below. None is a correctness or security defect in the demo. Re-scan: CI runs React Doctor again on every push to the PR; this file reflects the scan of `874fb039`.

## Fixed

| Finding | Where | What was done |
|---|---|---|
| **Error:** React Compiler doesn't support this syntax | `DocumentWorkbench.tsx:848` | The scenario runner used `try … catch … finally`. The React Compiler can't compile `finally`, so it skipped optimising that component (no runtime fault). Rewritten without `finally`; behaviour unchanged. |

## False positive

| Finding | Where | Why |
|---|---|---|
| `createObjectURL` without `revokeObjectURL` | `exportResources.ts:13` | The URL is revoked in the same function's `finally` block, right after the chart picture is rasterised. |

## Known debt (recorded, not fixed)

| Finding | Where | Disposition |
|---|---|---|
| `createObjectURL` without `revokeObjectURL` | `ExportPanel.tsx:30` | Real. Generated files' object URLs are never revoked, and their bytes are kept in a module-level map so the PDF preview can read them (the app's security policy blocks fetching `blob:` URLs). Memory grows with each export until the page is closed or reloaded. Recorded as known debt in the feature README with the fix (revoke and drop bytes on Reset, Start again and when a record is replaced) for production. |
| (same mechanism) | `ExportPanel.tsx` `generated` map | Part of the same debt; listed so the two findings aren't counted twice as separate problems. |

## Accepted, by rule

| Rule | Count | Where | Why it stays |
|---|---|---|---|
| `no-array-index-as-key` | 11 | `DeckPreview.tsx:90, 91, 93`; `DocumentPreview.tsx:111`; `DocumentPrimitives.tsx:117, 119, 126, 200, 212, 263, 286` | The lists are laid-out lines, line segments and table cells computed by the layout engine for one frozen snapshot. They are never reordered, filtered or edited in place; a new layout replaces the whole list. Index is the stable identity here, and segments have no other ID. |
| `only-export-components` | 9 | `Editors.tsx:32, 34, 190`; `ExportPanel.tsx:25`; `RevisionPanels.tsx:30, 33`; `DeckPreview.tsx:25`; `DocumentPrimitives.tsx:27, 43` | A fast-refresh hint: files that export helpers alongside components do a full reload instead of a hot update during development. The helpers (`parseQuantity`, `textTargets`, `formatStamp`, `deckChecks`, `type()`) are exported for tests and sibling modules. No production effect. |
| `no-pass-data-to-parent`, `no-pass-live-state-to-parent`, `no-prop-callback-in-effect` | 6 | `DeckPreview.tsx:47` (×3); `DocumentPreview.tsx:39` (×3) | Deliberate: the previews compute layout from fonts that load asynchronously, and report the result (`onState`, `onLayout`) so the workbench can show status and run the deck checks against the layout actually drawn. Lifting the font loading into the parent would duplicate it per caller. |
| `no-high-complexity-react-function` | 3 | `DocumentWorkbench.tsx:365` (DocumentInspector), `:835` (ScenarioInspector), `:925` (DeckScenario) | Workbench-only inspector components with many conditional panels. Splitting them would not change behaviour; left for a later refactor if the workbench outlives the prototype. |
| `prefer-html-dialog` | 2 | `DocumentWorkbench.tsx:305` (Reset confirmation); `ExportPanel.tsx:122` (draft warning) | Both are inline, non-modal confirmations placed next to the action, with `role="alertdialog"`, focus moved to the primary button and Escape to cancel. A modal `<dialog>` would change the approved interaction. |
| `prefer-tag-over-role` | 2 | `DocumentWorkbench.tsx:503, 513` | The field list is a CSS grid of focusable rows (`role="list"` / `"listitem"` on `div`s) so "Go to field" can focus a row. Semantics are equivalent to `ul`/`li`; changing tags would mean restyling the grid. |
| `async-await-in-loop` | 3 | `PdfFilePreview.tsx:50`; `pdfjs.ts:27`; `docx.ts:319` | Sequential on purpose: pdf.js pages are drawn and read one at a time to bound memory and keep page order; the Word renderer rasterises one chart at a time. |
| `js-set-map-lookups`, `js-index-maps` | 7 | `glyphs.ts:71`; `metrics.ts:155`; `revisions.ts:472, 474`; `session.ts:236`; `RevisionPanels.tsx:141, 142` | Lookups over arrays of a handful of items (missing characters, block and field IDs of one document, a revision's comparison). Converting to sets/maps would not be measurable at these sizes. |
| `js-hoist-intl` | 2 | `RevisionPanels.tsx:30, 31` | Date formatters for the history panel, called a few times per render. Hoisting is a micro-optimisation with no visible effect. |
| `no-non-null-assertion-on-maybe-undefined-result` | 2 | `session.ts:236, 237` | The assertion follows a check a few lines earlier in the same function that every revision's `outputId` is in the document map (that check throws first if not). |
| `no-prevent-default` | 1 | `Editors.tsx:61` | The edit forms save through the revision store in the browser; there is no server action to submit to. `preventDefault` stops a page navigation. |

Counts: fixed 1 + false positive 1 + debt 1 + accepted 48 = 51. (The debt table's second row describes the same `ExportPanel.tsx:30` finding, not a separate one.)
