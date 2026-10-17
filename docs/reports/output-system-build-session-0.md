# Output system build loop: Session 0 (Verify)

**Date:** 2026-10-17
**Branch:** `feat/output-system-build`, from `feat/output-system-foundations` (`de730736`).
**Plan:** [../output-system/build-loop.md](../output-system/build-loop.md).
**Decisions:** D-77 to D-79.

**Status: stopped for the designer.**
- **Phase 1 approval.** Session 1 can't start until the designer approves Phase 1 (build-loop.md §6).
- **Two other items need approval.** They are listed under "Waiting on the designer" below.

## 1. Phase 1 confirmed: routing, prompt version 4, all 34 requests, three live runs

| Run | Right | Results file |
|---|---|---|
| 1 | 34 / 34 | [`2026-10-17T10-25-20-s0-verify1.md`](../output-system/evals/results/2026-10-17T10-25-20-s0-verify1.md) |
| 2 | 34 / 34 | [`2026-10-17T10-25-47-s0-verify2.md`](../output-system/evals/results/2026-10-17T10-25-47-s0-verify2.md) |
| 3 | 34 / 34 | [`2026-10-17T10-26-17-s0-verify3.md`](../output-system/evals/results/2026-10-17T10-26-17-s0-verify3.md) (also [`latest.md`](../output-system/evals/results/latest.md)) |

**Setup:**
- Model: requested `anthropic/claude-opus-5.5` through OpenRouter, and the replies came from `anthropic/claude-opus-5.5`.
- Prompt `f368cc732b1b` (version 4), test instruction `59dd7b3f2ce6`.
- Each results file has the full per-request table: what was expected, what was chosen, and the reason the model gave. Each matching `.json` file has the raw replies.

**Cost:** US$1.11 for the three runs (US$0.37, 0.37, 0.37), with 102 calls recorded in the ledger.

## 2. What was built

| Part | Where | Checked by |
|---|---|---|
| **Sample stores.** Two fictional stores: Saffron Loom Textiles (INR) and Fernhill Goods Co. (USD). Each has 60 products, 200 customers and 500 orders over 12 months, from a fixed seed and date. | `src/lib/output-system/fixtures/stores.ts` | `fixtures.test.ts` checks:<br>• the counts and the 12-month spread<br>• integer money, with every order adding up<br>• the monthly totals adding up to the year<br>• a fixed fingerprint<br>• only `example.com` addresses |
| **Aggregates.** Sales summary, sales by month, top products and low stock, all derived from the orders. | `fixtures/aggregates.ts` | same tests |
| **Lane registry.** One entry per kind, built on `LANES`, with each kind's action, guide, templates, scope and status. | `src/lib/output-system/registry.ts` | `fixtures.test.ts`: four launch kinds, the rest marked "Coming later" |
| **Spend tracking.** A ledger, limits read from build-loop.md, a warning at 80%, a stop at 100%, and an estimate when the provider reports no cost. | `src/lib/output-system/spend.ts`, `scripts/output-system/route-eval.ts` | `output-system.test.ts` |
| **Cache keys.** Built from request, prompt version and guide version. | `src/lib/output-system/cache.ts` | `output-system.test.ts` |
| **The `/output-verify` shell and `/output-verify/gallery`.** The request box is disabled for now. The page lists the sample stores and every kind with its state. | `src/app/output-verify/` | `outputVerify.test.tsx`: renders the page and checks the labels, the states and that no system words appear |
| **The rubric.** Six dimensions, each scored 1 to 5, marked advisory. | `docs/output-system/evals/rubric.md` | n/a |

**Checks:**
- Typecheck, lint and build are clean.
- The full test suite passes except the known `src/lib/theme.test.tsx` failure.

**Not done: the look check (390 px and 1280 px).** The page can't be opened in a browser until the proxy line is approved (D-78). So the shell has been checked by its render test only, not looked at. It will be screenshotted at both widths as the first step after approval.

## 3. Reuse map: what each existing part gives this build

| Source | What it gives | Used in |
|---|---|---|
| `docs/output-system/system-prompt.md` (version 4) | Routing: which kind each request becomes, and the action names | Session 1 model route; the routing check stays at 34/34 |
| `docs/output-system/guides/` | Layout rules, tone, examples and formats for each kind | Sent with the request for the chosen kind, from Session 1 (build-loop.md §5) |
| `tokens.json`, `formats.json` | Sizes and colours, and which formats each kind exports | Renderers; the format-not-supported card's buttons |
| `docs/documents/README.md` | Approved type roles, type scale, pagination rules, revisions, exports, and their wording | All document output. Approved wording is reused as written. |
| `src/lib/documents/model.ts`, `money.ts`, `validation.ts`, `invoice.ts`, `brief.ts` | Typed snapshots, integer money, required fields, Missing states, invoice and brief schemas | Strict and composed documents (Sessions 2–3); sample-store money |
| `src/lib/documents/compose.ts`, `layout/` | Document plans and real-metric pagination, so the preview and PDF break identically | Every document render |
| `src/lib/documents/revisions.ts` | Immutable versions, bounded edits, proposals, restore, version labels | "Changes only what was asked", and the visible history |
| `src/lib/documents/export/` (`capabilities`, `adapters`, `jobs`, `pdf`, `docx`, `pptx`) | PDF and Word exports of one fixed version; capability table; filenames; export states | Strict and composed exports; the File lane's PDF; `formats.json` |
| `src/lib/documents/generation/` (`claude.ts`, `ops.ts`, `gate.ts`, `loop.ts`, `tools.ts`) | Provider and key handling (D-65), Opus 5.5 tool rules (D-66), local "today" (D-67), the three-layer gate, bounded retries, generate/revise/export tools | The model route; filling strict documents; the retry-once-then-honest-error rule |
| `src/components/documents/` (`DocumentPreview`, `DocumentPrimitives`, `PdfFilePreview`, `useDocumentFonts`) | The HTML preview at engine positions, the generated-PDF preview, font loading | Showing documents on `/output-verify` |
| `src/app/document-chat/` (`DocumentChat`, `DocumentCard`) | The chat-with-a-document-card pattern, and session storage | Starting point for the `/output-verify` conversation (Session 1) |
| `src/lib/documents/fixtures/brands.ts` | `SAFFRON_LOOM` brand profile | The INR sample store |
| `docs/documents/samples/` | The current quality bar for invoices, briefs and decks, with page images | What gallery items are compared against |
| `docs/design-system/1-component-copy-guide.md`, `2-master-concept-map.md` | App copy rules, and the component and phase map | App chrome text on `/output-verify` |
| `fe system design/principles-tldr.md` | Rendering choices: server components by default, client leaves only where interactive | The shell is a server component. Session 1 adds a client leaf for the conversation. |
| `docs/decisions.md`, `progress.md`, `workflow.md`, `CLAUDE.md` | Numbering, the check commands, the commit and push protocol | Every session |

## 4. New user-facing text, for approval

All of it is on `/output-verify` and `/output-verify/gallery`:

- **Page titles:**
  - "Make something"
  - "Gallery"
- **Links:**
  - "Gallery"
  - "Back to Make something"
- **Sample-data label:** "Sample data: fictional stores, customers and orders"
- **Section headings:**
  - "Your request"
  - "Sample stores"
  - "What Souvenir can make"
- **The request box:**
  - Placeholder: "For example: Invoice Bloom & Co for 40 ceramic planters at $18 each."
  - Note: "Not ready yet. Making things from a request comes next."
- **Store lines:**
  - "{currency} · {n} products · {n} customers · {n} orders"
  - "Sales in the last 12 months: {amount}"
- **States:** "Being built", "Coming later", "Ready"
- **One line per kind:**
  - "Answers and short copy, right in the conversation."
  - "Store data as Excel, CSV, JSON or PDF, and changes to files you upload."
  - "Invoices, quotes, purchase orders and receipts, with exact totals."
  - "Reports, plans and spec sheets to keep or share."
  - "Emails and replies to customers and suppliers, ready to copy."
  - "A quick chart of your numbers."
  - "Ads, social posts, mockups and slides."
  - "Numbers you check every week."
  - "Calculators, size guides and quizzes at a private link."
  - "When a format won’t work, the closest formats to choose from."
- **Empty gallery:** "No examples yet. The best example of each document and file appears here as it’s built, with the two weakest results beside them."

## 5. Spend

| | US$ |
|---|---|
| Session 0 (ledger) | 1.11 |
| Build total (ledger) | 1.11 of 75 |
| Before the ledger existed: Phase 1 runs (versions 1 to 4, 12 runs) and one probe. **Estimated, not in the ledger.** | about 4 |

## 6. Waiting on the designer

1. **Approve Phase 1** from the results files above. Session 1 doesn't start without this.
2. **Approve the `/output-verify` proxy line.** The exact diff is in D-78: development only, following the `/reasoning-verify` pattern. Should `/output-verify` also open on Vercel previews, like `/document-verify`? I've assumed no.
3. **Choose where the worktree's dev server gets the model key.** `next dev` in `~/craft-output` reads only `~/craft-output/.env.local`, which doesn't exist. Two options, both Chai's call:
   - **(a)** A symlink, `ln -s ~/craft/.env.local ~/craft-output/.env.local`. It makes no second copy of the key, and the link is git-ignored.
   - **(b)** Chai creates the file themselves.
