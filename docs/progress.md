# Progress — document-generation build

Updated 2026-10-15. Update this file and push before ending every session.

## Where the work is

- **Repo:** `Chaiidesign/craft` (a fork; never push upstream).
- **Branch:** `feat/document-quality`, pushed to `origin`. Not merged. A draft pull request into the fork's `main` is open for review.
- **Spec:** [souvenir-document-generation-prd.md](souvenir-document-generation-prd.md).
- **Feature docs:** [documents/README.md](documents/README.md) (run commands, design rules, approved wording, limitations).
- **Demo:** `npx next dev -p 4010`, then http://localhost:4010/document-verify.

## What works (Steps 1–7, all committed and pushed)

| Step | Commit | What it delivered |
|---|---|---|
| 1 | `13265b24` | Document model, integer money, validation, fictional fixtures, workbench shell |
| 2 | `87b61b53` | Typography theme, document tokens, layout primitives, invoice and brief templates |
| 3 | `a6e5e0e5` | Layout with real font metrics, pagination by meaning, brief → deck |
| 4 | `cf6c9884`, `0e031c76` | Immutable revisions, bounded edits, proposals, restore, mock approval markers, deck ancestry |
| 5 | `8a05e154` | Real PDF, Word and PowerPoint exports of one frozen revision; per-format status, retry, generated-PDF preview |
| 6 | `0cca21d6` | Browser-session storage and malformed-session recovery, export cancel with late results discarded, renderer vs viewer errors, section error screens, duplicate-filename fixture |
| 7 | see [reports/step-7.md](reports/step-7.md) | Full re-checks, phone and desktop screenshots, page-by-page export inspection, README completion, final report |

Checks at Step 7 (final code): typecheck, lint and production build clean; 1,421 tests pass, 2 skipped. One known failure, `src/lib/theme.test.tsx`, predates this work and is unrelated.

## Unfinished

- **Word and PowerPoint in Microsoft's own apps are unverified.** Neither is installed here. Word files were checked only in Apple Pages and PowerPoint files only in Apple Keynote, which both substitute Helvetica; differences are in the feature README's "Unsupported and unverified".
- **Deck "(continued)" finding** from the Step 7 inspection: repeated headings across a deliberately split section don't say "(continued)". Awaiting a decision (see [reports/step-7.md](reports/step-7.md)).
- **Known limitations:** listed in the feature README.

## Next step

Instinct reviews the draft pull request. Record the verdicts in [decisions.md](decisions.md), apply them (including the "(continued)" decision), commit and push; merge only after approval.

## Blockers

None for saving work. Merge and release wait for Instinct's verdicts.
