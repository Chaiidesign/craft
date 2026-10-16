# Report: chat → document, slice S1 (invoice end to end)

Branch `feat/chat-document-flow` (step 5 at `2c89554e`), off `main` at `6e2d2978`. The plan is in [decisions.md](../decisions.md) (D-49 to D-62). This report covers S1 steps 1–5. Step 6, the hosted run with the real model, waits on the Anthropic key; see "What's left for S1".

## What it does

A person types "invoice for Acme, $2,400" in the demo chat (`/document-chat`):
1. **Drafting.** A card appears straight away. It shows a page skeleton, then the invoice filling in as the model's operations stream in.
2. **Saving v1.** The gate checks the finished proposal, and the invoice is saved as v1. Bill to is Acme, the currency USD, and there is one line of $2,400.00 whose description is missing. Every other fact is shown as missing, and none is invented. The reply asks "What does the $2,400 cover?".
3. **Refining.** "add a line item: design review, $600" saves v2, and "due in 30 days" saves v3. Each reply says what changed, and older versions collapse to one line.
4. **Downloading.** Any version's card downloads that exact revision as PDF or Word. An incomplete invoice exports marked as a draft.

The same pipeline is callable without the chat:
- **As TypeScript:** `generateDocument`, `reviseDocument` and `exportDocument` in `src/lib/documents/generation/tools.ts`, with `toolSchemas()` for LLM tool definitions.
- **From a terminal:** the CLI in `scripts/documents/agent.ts`.

## How it's built

| Piece | File | What it does |
|---|---|---|
| Generation schema | `generation/ops.ts` | An exhaustive zod union of operations (`setField`, `markUnknown`, `setNotApplicable`, `addLineItem`, `updateLineItem`, `removeLineItem`), exported as JSON Schema. Values are decimal strings; the host converts them to integer units. |
| Gate | `generation/gate.ts`, `apply.ts` | Three layers: (1) the schema; (2) structural checks: targets exist, digests match, values convert, every prompt-derived value quotes the request and its numbers appear in the quote; (3) `validateSnapshot` plus the check that line items add up to the stated amount. Only an invalid result is refused. Errors are `{code, path, target, message, retryable}`. |
| Retry loop | `generation/loop.ts` | At most 2 retries, each given the previous errors. Stops at once when no error is retryable (for example, an unsupported document type). |
| Models | `generation/model.ts`, `claude.ts`, `remote.ts` | `ScriptedModel` for tests. `ClaudeModel`: `submit_proposal` tool offered with `tool_choice: auto` (D-66; Opus 5.5 rejects forced tool use), eager input streaming, `claude-opus-5-5` by default, `DOCUMENT_MODEL` can override it. `RemoteModel`: the browser client for the route. A missing key returns `model-unavailable`; nothing is ever substituted. |
| Model route | `src/app/api/document-model/route.ts`, `generation/modelRoute.ts` | 404 in production; open in dev and on previews. Schema-checked body, 256 KB cap, 40 requests per 10 minutes per address, NDJSON events. Never logs content. |
| Live draft | `generation/draft.ts` | Applies each complete streamed operation to a display-only copy, using the same checks as the gate. |
| Tools | `generation/tools.ts` | The three tools. The store is passed in and returned; results are plain JSON. |
| Chat | `src/app/document-chat/` | Thread, inline cards, drafting card, composer with Stop, downloads, browser storage with backup of an unreadable save. |
| CLI | `scripts/documents/agent.ts` | `schemas`, `generate`, `revise`, `export`, `show`. The store file uses the workbench session format. |

Engine changes:
- **D-60:** a line description may be `null`, meaning missing.
- **D-61:** an unbranded profile for documents with no stated issuer: no letterhead, and the issuer is an ordinary field.
- **D-62:** the PDF file ID is derived from the document, so PDF exports are byte-identical.
- **Invoice skeleton:** moved to `templates/invoice.ts`.
- **Revisions:** `saveGenerated` plus a `generate` revision operation.
- **Snapshots:** an optional `provenance` map.

Other changes outside the feature folders:
- **`src/proxy.ts`:** opens `/document-chat` under the same rule as `/document-verify`, with tests.
- **`package.json`:** adds `@anthropic-ai/sdk` 0.131.0 (pinned exactly; the newest release over two weeks old).
- **`scripts/documents/mock-anthropic.ts`:** a local stand-in for the Anthropic API, used only for checking by hand. It is described below.

## Commands and results (at the commit that adds this report)

| Check | Result |
|---|---|
| `npx tsc --noEmit -p .` | clean |
| `npx eslint src/lib/documents src/components/documents src/app/document-verify src/app/document-chat src/app/api/document-model scripts/documents next.config.ts src/proxy.ts` | clean |
| `npx vitest run` | 1,477 passed, 2 skipped, 1 failed: the known `src/lib/theme.test.tsx`, which predates this work |
| `npx next build --webpack` | succeeds; `/document-chat` is built like `/document-verify`, and `/api/document-model` is dynamic |

New tests:
- **`generation/generation.test.ts`:** the done prompt; every gate refusal (sum mismatch, wrong type, schema, unquoted value, number not in the quote, unknown target, caller provenance from a model, contradiction, out-of-range, bounded retries); retry with errors fed back; `model-unavailable` with no retry; two refinements keeping every untouched ID and digest; stale or missing digest; not current; no change; direct callers; tool schemas; PDF byte-identical and Word content-identical; export failures; unsupported type; unbranded issuer.
- **`generation/model.test.ts`:** the route (streaming, no key, too large, bad JSON, off-schema, rate limit, 404 in production, open on preview); `RemoteModel`; `ClaudeModel` against a stand-in client.
- **`generation/draft.test.ts`:** the live draft.
- **`document-chat/chat-ui.test.tsx`:** the chat's three-version flow, reload, gate refusal, unsupported type, unavailable model, unreadable save, failed download.
- **D-60 rule:** covered in `validation.test.ts`.
- **Proxy rules:** `src/proxy.test.ts` now covers both demo routes.

## Checked by hand

- **CLI, with no UI and no model:** generate gave v1 (subtotal 2400.00, total unknown). Two revisions gave v2 (subtotal 3000.00) and v3 (payment terms). Exporting v3 wrote a draft PDF of 54,834 bytes. A stale base gave `not-current`, a prompt with no key gave `model-unavailable`, and a bad target gave `unknown-target`, each as structured JSON. The PDF's page image is `chat-s1/cli-v3-pdf.png`.
- **Chat in a browser at 1280, 390 and 320 px**, against the local Anthropic stand-in.
  - **Setup:** `scripts/documents/mock-anthropic.ts` speaks the real streaming protocol, so the real SDK and `ClaudeModel` parsed it. Its answers are scripted from the request, **not model output**.
  - **What was seen:** the empty state, the drafting card filling in, v1 → v2 → v3 with the replies above, and a PDF download (`issuer_invoice_v3_d836.pdf`, `application/pdf`, 54,834 bytes, starting `%PDF-1.3`). There is no sideways scroll at 390 or 320.
  - **Auth0 placeholders:** for this local run only, the dev server was given obviously fake Auth0 placeholder values. Every `/api/*` request passes through the existing Auth0 middleware, which throws locally without settings; on Vercel the settings exist. No proxy rule was changed (D-56).
- **Screenshots** are in [chat-s1/](chat-s1/): `1280-empty`, `1280-drafting`, `1280-v3-full`, `390-thread`, `320-latest`.

Fixed after looking:
- The card offered "Download PowerPoint" for an invoice.
- The missing-count chip disagreed with the list.
- Older versions stayed expanded.
- Replies said "line 2" instead of "added line 2".
- At 320 px the header's fade let the thread show through.
- A resources failure during export was an unhandled rejection; it is now `export-failed`.

## Not verified, stated plainly

- **The real model has not been run.** Nothing in this report is Claude's output. The prompt, schema and streaming are tested against stand-ins only. The eval set in [../documents/evals/s1-invoice.md](../documents/evals/s1-invoice.md) is ready to run once the OpenRouter key is in `.env.local` (D-65).
- **The schema has not been tried with `strict: true` tool use** (structured outputs). It is off until the real model has been tried, and the gate validates everything regardless.
- **Word export is content-identical, not byte-identical (D-62).**
- **Number quotes in European format fail the check.** "€1.200" is not read as 1200, so such a price would be left unknown rather than guessed (eval #3).
- **The rate limit is per server instance**, so it is best effort on serverless.
- **The preview is a full A4 page scaled to the card.** At 320 px it is small, and there is no zoom yet.

## Real model through OpenRouter: smoke test (2026-10-15)

Run against `anthropic/claude-opus-5.5`, pinned to Anthropic's own servers (D-65), from this Mac. The key is in `.env.local` only.

**1. The first request failed: forced tool use (fixed, D-66).** Anthropic returned 400, `tool_choice: type "tool" and "any" are not supported for this model.`, with Anthropic's own request ID. The direct API rejects this the same way, as Anthropic's Opus 5.5 notes document, so it is a bug in the step-4 code that the local stand-in couldn't catch. It is not an OpenRouter difference. The fix uses `tool_choice: auto`, retries a reply with no tool call, sends no `thinking` field, raises `max_tokens` to 16,000 and sets effort to `medium`.

**2. CLI, the real `ClaudeModel` (done prompt, generate only):** "invoice for Acme, $2,400" → v1 in 1 attempt and 4.5 s from the command line. The result: Bill to Acme; USD; one line, quantity 1, $2,400.00, description missing; subtotal $2,400.00; total unknown, with the reasons "Tax applicability not supplied — tax is unknown, not zero." and "Discount applicability not supplied." The follow-up was "What is the $2,400 charge for?".

**3. Chat route, the browser client (`RemoteModel` → `/api/document-model` → OpenRouter), on the local dev server:** a 200 response in 3.6 s, with 12 partial proposals. The first partial arrived at 1.4 s, the last at 3.5 s, with a median gap of 164 ms. The route returned 3 operations and the follow-up "What is the $2,400 for?".

**4. Tool-input streaming, raw SDK through OpenRouter (real schema and prompt, same request apart from the flag):**

| `eager_input_streaming` | `input_json_delta` events | first at | last at | median size | largest |
|---|---|---|---|---|---|
| `true` (what the code sends) | 40 | 1.30 s | 3.55 s | 17 chars | 28 |
| omitted | 39 | 1.16 s | 3.41 s | 17 chars | 34 |
| `false` | 44 | 1.12 s | 3.52 s | 17 chars | 26 |

Across all three, the pieces arrive every ~50 ms as the model writes. No `thinking` block appeared in any of these responses: adaptive thinking chose not to think for this prompt. Output was 381–413 tokens.

**Differences from Anthropic's documented direct-API behavior (stopped here before the evals, per Chaitanya's instruction):**
- **`eager_input_streaming` has no measurable effect through OpenRouter.** Anthropic's docs: "Without `eager_input_streaming`, the API buffers and validates each parameter value before streaming it back, so nothing prints for a large parameter until Claude has finished generating it." Through OpenRouter, omitted and `false` stream exactly like `true`: the `operations` parameter arrives in small pieces as it's written, never as one buffered block. The drafting preview gets the small pieces it needs either way. Without a direct key I can't tell whether OpenRouter adds the legacy fine-grained header, or whether the direct API on Opus 5.5 also streams this way.
- **`strict: true` is silently dropped** unless the request sends `anthropic-beta: structured-outputs-2025-11-13`. The real schema with `strict: true` succeeded through OpenRouter. With that header, the same request got Anthropic's 400 for `maxItems`. The code doesn't use strict (D-66), so this has no effect today. If strict is adopted later, the header is needed on the OpenRouter path.
- **Same as the direct API:** the forced-tool-use rejection (Anthropic's own error), `stop_reason: tool_use`, the `tool_use` content block, and `input_json_delta` events.

Not compared side by side: no direct Anthropic key is available, so the differences are measured against Anthropic's documentation, not against a direct run.

## Real model: evals and the done flow in the browser (2026-10-15)

**Evals: 10/10 pass, every turn in 1 attempt, 3–10 s per call.** Full table in [../documents/evals/s1-invoice.md](../documents/evals/s1-invoice.md). They found two problems, both fixed:
- **A wrong date (fixed, D-67).** "Dated today" used the UTC date, a day ahead in California after 5 pm.
- **A wrong expectation in the eval set itself.** Eval 2 expected a final total, but the prompt says nothing about a discount, and an unstated discount is unknown, not zero. The model was right; the row is corrected and marked as corrected.

**Done flow in the chat with the real model, local dev server (`.env.local` → OpenRouter):**
- "invoice for Acme, $2,400" → "Drafted v1. What is the $2,400 charge for?"
- "add a line item: design review, $600" → "Updated to v2: added line 2. Who is sending this invoice (your name or business)?"
- "due in 30 days" → "Updated to v3: set Payment terms. Who is sending this invoice?"
- **Download PDF:** `issuer_invoice_v3_a862.pdf`, 54,834 bytes, saved as [chat-s1/real-v3.pdf](chat-s1/real-v3.pdf). Its text shows the draft banner, Bill to Acme, both lines, subtotal $3,000.00, "Incomplete — not a final amount" with both reasons, and the payment terms.
- Screenshots: `real-1280-drafting.png` (the skeleton while the model works), `real-1280-v1.png`, `real-1280-v3.png`, `real-390-v3.png`, `real-320-v3.png`, `real-390-memo.png`, `real-1280-memo.png`. No horizontal scroll at 390 or 320 (scroll width equals viewport width).

**Fixed during the browser run: a plain-text reply could end up hidden behind the input box.** At 390 px, the memo reply ("I can only draft invoices so far…") was scrolled to the bottom edge, under the sticky composer. The scroll target now keeps 128 px clear (`.threadEnd` in `chat.module.css`). Re-checked at 390 and 1280: the reply's bottom edge is at 706 px and the composer's top at 750 px.

## Needs a decision

- **D-63:** "$" is read as US dollars unless another dollar is named. This is proposed, not approved; see decisions.md.
- **D-65** (direction approved; two details to confirm): the model runs through Souvenir's OpenRouter key, with the direct Anthropic API as an env-switched fallback. Two departures from the brief: the base URL is `https://openrouter.ai/api`, because the brief's `/api/v1` gives 404 with this SDK; and the key goes as a bearer token. OpenRouter requests are pinned to Anthropic's own servers. The default model is `anthropic/claude-opus-5.5` (latest Opus, D-59), not the brief's example `anthropic/claude-sonnet-4.5`.
- **D-64** (applied): each document's conversation starts at "New document", so a value from an earlier document can't be quoted into a new one. The divider's label is "New document".

## New user-facing text (for approval before merge)

Page and empty state:
- Title "Draft a document"; subtitle "Prototype · invoices for now · saved in this browser only"
- "What should we draft?"
- "Describe it in a sentence. You’ll see it take shape, refine it in conversation, and download it."
- Suggestion "Invoice for Acme, $2,400"

Composer:
- Placeholder "Describe the document you need…", and once a document exists "Ask for a change…"
- Button labels "Send" and "Stop"
- "New document"

Drafting:
- "Drafting your invoice…", "Revising v{n}…"

Card:
- "v{n}"; chips "Ready to send", "Draft · {n} missing", "Draft"
- "Not provided yet", with "Line {n} description" in the list
- "Show v{n}" / "Hide v{n}"
- "Download PDF", "Download Word"
- "{format} download failed: {message}"

Replies:
- "Drafted v{n}." followed by the model's follow-up question, if any
- "Updated to v{n}: {change summary}." The summary is built from what changed: "added / changed / removed line {n}", "set / changed / cleared {field}", "marked {field} not applicable".

Notices:
- "I couldn’t make a valid document from that, so nothing was saved. Try saying it another way.", with "What was wrong" expanding to the gate's messages
- "I can only draft invoices so far. Briefs, memos and decks are coming next."
- "The document model isn’t available here. {message}"
- "That version has changed since this message started, so nothing was saved. Send it again to revise the latest version."
- "Stopped. Nothing was saved."
- "Something went wrong, and nothing was saved. {message}"

Storage:
- "The saved chat couldn’t be read ({reason}), so this is a new one. The old copy was kept."
- The variant when the backup also fails
- "This browser isn’t letting the page save, so the chat will be lost on reload."
- "The chat couldn’t be saved in this browser ({reason}). It will be lost on reload."

Workbench (D-60): "Description not supplied", shown where a line has no description.

Gate and tool messages are machine-facing; the most likely to reach people are listed in `generation/apply.ts` and `gate.ts`. Model error messages:
- "Neither OPENROUTER_API_KEY nor ANTHROPIC_API_KEY is set, so no model can generate. Set it in .env.local (development) or in the Vercel Preview environment." *(replaces the earlier "ANTHROPIC_API_KEY is not set, …"; D-65)*
- "MODEL_PROVIDER is {provider} but {KEY} is not set, so no model can generate. Set it in .env.local (development) or in the Vercel Preview environment." *(new, D-65)*
- "MODEL_PROVIDER is "{value}"; it must be "openrouter" or "anthropic"." *(new, D-65)*
- "The {OpenRouter | Anthropic} API key was rejected." *(was Anthropic only; D-65)*
- "The {OpenRouter | Anthropic} account has run out of credits." *(new, for HTTP 402; D-65)*
- "The model declined this request."
- "The model took too long to answer."
- "The model is rate-limited right now. Try again shortly."
- "The document model is not available on this deployment."

The preview reuses the approved missing state ("Missing — Description") and the draft marking.

## What's left for S1 (step 6) and what Chaitanya needs to do

1. **Local real-model run:** paste Souvenir's key after `OPENROUTER_API_KEY=` in `~/craft/.env.local`. The file is already in place and git-ignored by `.env*` (D-65). I then run the eval set and the done prompt against Claude and record the results.
2. **Hosted run (D-54):** add `OPENROUTER_API_KEY` to the Vercel project's environment variables with **Preview** scope. `MODEL_PROVIDER` and `OPENROUTER_MODEL` are optional: OpenRouter is chosen whenever its key is set, and the model defaults to the latest Opus. Vercel builds this branch on push. Then, in a fresh browser on the preview URL: "invoice for Acme, $2,400" → two refinements → PDF. The preview sits behind Vercel's deployment protection, so the visitor needs Vercel access, or a protection-bypass link if I'm to drive it.
3. **Before the hosted run, checked read-only on 2026-10-15:**
   - **Preview builds:** Vercel built this branch on every push. The build at `83a66c75` is READY at `craft-43c9gpnm5-chaiidesigns-projects.vercel.app`.
   - **Protection:** Vercel's login protection (SSO) is on for all deployments except custom domains, so the preview, and with it the key, can't be reached by strangers.
   - **Not verified: the Auth0 settings in Preview.** I don't have permission to list the project's environment variables. Every `/api/*` request passes the existing Auth0 middleware, so if `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET` and `APP_BASE_URL` are missing from Preview, the model route will fail with 500 there even with the key.
   - **New variables need a redeploy:** they reach only deployments built after they're added, so redeploy, or push, once the key is in.
   - **CI:** React Doctor runs only on pull requests and on `main`, so it hasn't scanned this branch yet. It will when the PR opens.
4. **Then:** screenshots of the hosted run go in this folder, I open the PR from `feat/chat-document-flow` to `main` and stop. Merge and release are Instinct's verdicts.
