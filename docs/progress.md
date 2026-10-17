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

## In progress: output system build loop, branch `feat/output-system-build`

Updated 2026-10-17.
- **Plan:** [output-system/build-loop.md](output-system/build-loop.md).
- **Session report:** [reports/output-system-build-session-0.md](reports/output-system-build-session-0.md).
- **Decisions:** D-77 to D-79. D-71 is still left for S1.

**Session 0 (Verify): done; stopped for the designer.**
- **Phase 1 confirmed again.** Routing with prompt version 4 scored 34/34 in each of three live runs. The results files are linked in the session report.
- **Built:**
  - the sample stores, two of them with 60 products, 200 customers and 500 orders each
  - the aggregates, lane registry, spend ledger, limits and cache keys
  - the `/output-verify` shell and its gallery
  - the rubric
- **Not done: the 390/1280 look check of the shell.** It waits on the proxy line (D-78).

**Spend:**

| | US$ |
|---|---|
| Session 0 | 1.11 |
| Build total, from the ledger | 1.11 of the 75 limit |
| Phase 1, before the ledger existed (estimated, not in the ledger) | about 4 |

**Approved by Chaitanya (2026-10-17):**
- Phase 1.
- The proxy line, development only (D-78).
- The key symlink.

**Look check done:** the shell and gallery at 390 px and 1280 px, with no sideways scrolling. Screenshots are in `docs/output-system/gallery/screens/`. One fix came out of it: kinds that are being built now come before kinds marked "Coming later".

**Dev server:** `npx next dev --webpack -p 4011` in `~/craft-output`, then open http://localhost:4011/output-verify.

**Session 1 (chat and file): done.** Report: [reports/output-system-build-session-1.md](reports/output-system-build-session-1.md). Decisions D-80 to D-86, assumed.

**What works on `/output-verify`:**
- **Chat replies** about the sample stores, with every store number checked against the sample data.
- **Files:** orders, products or customers as Excel, CSV, JSON or PDF, plus changes to an uploaded CSV or Excel file.
- **Inline charts** (built early).
- **The format-not-supported card.**
- **"Coming later" cards** for every other kind.

**Gate runs** (three runs, no cache): chat 23 of 24, charts 12 of 12, files 30 of 30. The app's real loop scored 33 of 34 on the routing requests.

**Misses:**
- **c01:** a chart instead of a chat reply, once in three runs.
- **r25:** answered in chat, because the store has no product-catalog question yet.

**Spend:**

| | US$ |
|---|---|
| Session 1 | 15.66 of 20 (78%) |
| Build total, from the ledger | 16.77 of 75 |
| Phase 1, before the ledger existed (estimate, not in the ledger) | about 4 |

**Open:**
- **Product-catalog store question:** for Session 3.
- **Offers in replies:** replies sometimes offer things that aren't built yet, like a purchase order.
- **Logos:** whether the sample stores get logos for the demo. The designer decides.
- **Total row:** the PDF data export has none yet.
- **Message card:** not built yet.

**Next: Session 2 (strict documents),** in a new conversation. Start with: "Read docs/output-system/build-loop.md and docs/progress.md, then run the next session." Dev server: `OUTPUT_BUILD_SESSION=2 npx next dev --webpack -p 4011` in `~/craft-output`.

## In progress: output system Phase 1 (Foundations), branch `feat/output-system-foundations`

Updated 2026-10-17.
- **Plan:** [output-system/plan.md](output-system/plan.md), updated by Chaitanya with the router change (D-72).
- **Report:** [reports/output-system-phase-1.md](reports/output-system-phase-1.md).
- **Decisions:**
  - D-68 to D-70: proposed
  - D-72: router change, approved
  - D-73: guide rules beyond the plan, assumed
  - D-74: prompt version 3, approved
  - D-75: `system-prompt.md` is the source of truth, approved
  - D-76: prompt version 4, `format_not_supported` and `formats.json`, approved
  - D-71 is left for S1.
- **Branch:** stacked on `feat/chat-document-flow` (D-68).

**What works:**
- the system prompt, version 4, which is the source of truth (D-75); it adds `show_format_options` (D-76)
- `formats.json`: which formats each kind exports, generated from `export/capabilities.ts`, with kinds that have no code marked planned
- `tokens.json`, generated from the engine
- nine guides
- 34 eval requests (the original 30, plus r31 to r34)
- the routing harness: `npx vite-node scripts/output-system/route-eval.ts -- --env-file <path to .env.local>`
- 33 tests in `src/lib/output-system/`

**Scores:**
- **Phase 1 baseline (prompt version 1):** 30, 29 and 29 of 30. The miss was r29.
- **After D-72 (prompt version 2):** 30, 30 and 30 of 30. This is weak evidence, because the share-this rule quotes r29 (see the report).
- **Prompt version 3:** the original 30 scored 30/30 in all three runs. The new four scored 2/4 each time. r33 and r34, the closest-format cases, were labelled as a chat reply rather than a question, but the model did what the rule asks.
- **Prompt version 4:** 34/34 in all three runs. This fixed how r33 and r34 were labelled, not how they were routed. The harness doesn't send `formats.json` (see the report).
- **Gate:** at least 27 of 30, passed in every run.

**Engineering item: progress labels use system words.** The real chat shows the app's own progress events while it works: "Running sandbox command", "Running tool", "Loading skill" (baseline run, `chore/doc-gen-baseline`). These labels don't come from the model, so the prompt can't fix them. Replace them in the app with the person's words, for example "Making your document" or "Checking your store data", before any lane ships.

**Next:**
- Chaitanya adds `evals/heldout.jsonl` (about 20 requests). Run it three times, never tune against it, and change nothing in it except to run it.
- Phase 2: send the guides and `formats.json` with the prompt, and test a borderline format request.
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
