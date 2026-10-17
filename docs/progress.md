# Progress — document-generation build

Updated 2026-10-15. Update this file and push before ending every session.

## Where the work is

- **Repo:** `Chaiidesign/craft` (a fork; never push upstream).
- **Branch:** merged into the fork's `main` as `b1025a93` (PR #1, D-48). `feat/document-quality` is kept on `origin` until the release verdict, then deleted.
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

Checks at Step 7 (final code): typecheck, lint and production build clean; 1,421 tests pass, 2 skipped. After the review follow-up (`06763bb1`): 1,425 pass, 2 skipped. One known failure, `src/lib/theme.test.tsx`, predates this work and is unrelated.

## Unfinished

- **Word and PowerPoint in Microsoft's own apps are unverified.** Neither is installed here. Word files were checked only in Apple Pages and PowerPoint files only in Apple Keynote, which both substitute Helvetica; differences are in the feature README's "Unsupported and unverified".
- **Known limitations and debt:** listed in the feature README (including generated files kept in memory until the page closes).

## In progress: output system Phase 1 (Foundations), branch `feat/output-system-foundations`

Updated 2026-10-17.
- **Plan:** [output-system/plan.md](output-system/plan.md), updated by Chaitanya with the router change (D-72).
- **Report:** [reports/output-system-phase-1.md](reports/output-system-phase-1.md).
- **Decisions:**
  - D-68 to D-70: proposed
  - D-72: router change, approved
  - D-73: guide rules beyond the plan, assumed
  - D-74: prompt version 3, approved
  - D-71 is left for S1.
- **Branch:** stacked on `feat/chat-document-flow` (D-68).

**What works:**
- the system prompt, version 3: the updated plan's draft, with the share-this rule worded by meaning and `export_version` named (D-74)
- `tokens.json`, generated from the engine
- nine guides
- 34 eval requests (the original 30, plus r31 to r34)
- the routing harness: `npx vite-node scripts/output-system/route-eval.ts -- --env-file <path to .env.local>`
- 30 tests in `src/lib/output-system/`

**Scores:**
- **Phase 1 baseline (prompt version 1):** 30, 29 and 29 of 30. The miss was r29.
- **After D-72 (prompt version 2):** 30, 30 and 30 of 30. This is weak evidence, because the share-this rule quotes r29 (see the report).
- **Prompt version 3:** the original 30 scored 30/30 in all three runs. The new four scored 2/4 each time. r33 and r34, the closest-format cases, were labelled as a chat reply rather than a question, but the model did what the rule asks.
- **Gate:** at least 27 of 30, passed in every run.

**Engineering item: progress labels use system words.** The real chat shows the app's own progress events while it works: "Running sandbox command", "Running tool", "Loading skill" (baseline run, `chore/doc-gen-baseline`). These labels don't come from the model, so the prompt can't fix them. Replace them in the app with the person's words, for example "Making your document" or "Checking your store data", before any lane ships.

**Next:**
- Chaitanya adds `evals/heldout.jsonl` (about 20 requests). Run it three times, never tune against it, and change nothing in it except to run it.
- Chaitanya decides on the r33 and r34 fixes in the report, under "Prompt version 3".
- Phase 2 does not start until the held-out set passes.

## In progress: chat → document flow (S1), branch `feat/chat-document-flow`

Plan: prompt in chat → validated document → refine in conversation → export, agent-first (decisions D-49 to D-62). S1 is the invoice end to end with the real model on a hosted preview (D-54).

| S1 step | Commit | What it delivered |
|---|---|---|
| 1–3 | `e8fc8952` | Generation schema, three-layer gate, scripted model, bounded retries; `generate`, `revise`, `export` tools with JSON schemas; D-60 (missing descriptions), D-61 (unbranded documents), D-62 (deterministic PDF) |
| 3b | `528d6e26` | Agent CLI (generate → revise → export with no UI), checked by hand: v1 → v2 → v3 → draft PDF |
| 4 | `528d6e26` | Claude model and `/api/document-model` (tested with stand-in models; not yet run against the real API) |
| 5 | `2c89554e` | `/document-chat` with inline preview, live drafting state, refine, export; report [reports/chat-s1.md](reports/chat-s1.md) |
| 5b | `ac54180d` | Each document's conversation starts at "New document" (D-64); D-63 ("$" = USD) recorded as proposed; hosted-path checks |
| 5c | `64ce87cc` | Model provider switch: Souvenir's OpenRouter key, direct Anthropic API as fallback (D-65) |
| 5d | `4333fa06` | Real-model smoke test through OpenRouter; forced tool use replaced (D-66) |
| 6a | `f3c88efb` | Real model: 10/10 evals pass; done flow in the chat; PDF; "today" is the local date (D-67); last reply kept clear of the composer |
| 6b | | Hosted preview run (D-54): needs `OPENROUTER_API_KEY` in Vercel Preview, then a redeploy |

## Next step

S1 step 6: run the eval set and the done prompt against the real model, then the hosted preview run (D-54), then open the PR and stop. Separately, PR #1's release verdict from Instinct is still open (D-48).

## Blockers

- **S1 step 6b, the hosted run:** needs `OPENROUTER_API_KEY` in Vercel's Preview environment and a redeploy, which only Chaitanya can do. Also confirm the Auth0 variables exist in Preview. The local real-model run is done (10/10 evals). Everything up to step 5 is done and checked against stand-ins.
