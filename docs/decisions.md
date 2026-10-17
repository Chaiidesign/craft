# Decisions — document-generation build

Every approved decision for this build, numbered in the order it was made, newest first. Dates are UTC, the time zone of the session records.

**Sources.** Chaitanya approved these decisions in the Claude Code build session, either as written replies to each step report or as answers to multiple-choice questions. They are backfilled here from that session's transcript, so each entry states its context in full instead of pointing to the chat. **Applied in** names the commit, and where useful the README section, that carries the decision out. The feature README is [documents/README.md](documents/README.md); the spec is [souvenir-document-generation-prd.md](souvenir-document-generation-prd.md).

Status is **approved** unless marked otherwise. When a later decision replaces an earlier one, the earlier entry is marked **superseded by D-n** and kept.

---

## Output system, Phase 1: Foundations (branch `feat/output-system-foundations`)

The plan is [output-system/plan.md](output-system/plan.md) (Chaitanya, 2026-10-17): nine output lanes, a ten-question router, one guide per lane, design tokens and an eval set, built in five gated phases. This branch is Phase 1 only. D-68 to D-70 were made during the build and are **proposed** until Chaitanya approves them. D-71 is left for S1's next decision.

### D-74 · 2026-10-17 · Prompt version 3: share-this by meaning, `export_version`, four new requests
**Status: approved** (Chaitanya, 2026-10-17, answering the four gap fixes in the Phase 1 report).

**Rule.**
- **Share-this by meaning.** The rule in `system-prompt.md` now reads: "When the person wants something you answered in chat to reach other people, whether they say share it, forward it or send it on, and whether or not they name who it is for, turn that reply into a document they can pass on. Passing on your answer is not a message."
  - The aim is to cover phrasings like "forward this to Priya" without quoting any eval request.
  - Prompt version 3 therefore departs from the plan's draft in this rule. `plan.md` is Chaitanya's and is not edited.
- **Export action.** Router step 1 now names the export action: "'Make it a PDF' exports the current version with export_version."
  - The harness choice `export_existing` is renamed `export_version` to match.
  - The test instruction hash changes with it, to `3bf4e190a6d0`.
- **System words stay out of the prompt.** Proposal 2, which would have listed tools, sandboxes and skills in "Words on screen", is **rejected**. Listing the words can prime the model to use them. "Running sandbox command" came from the app's progress events, not from the model. Replacing those labels is recorded in `progress.md` as an engineering item.
- **New requests in `requests.jsonl`, r31 to r34.** The set now has 34 requests. Scores on the original 30 are still reported on their own.
  - r31 and r32 are changes to uploaded files, expected to go to File.
  - r33 and r34 test the closest-format rule: an ad as Excel, and a calculator page as PowerPoint. Both are expected to be one question.

Applied in: `docs/output-system/system-prompt.md`, `docs/output-system/evals/requests.jsonl`, `src/lib/output-system/lanes.ts`, `scripts/output-system/route-eval.ts`.

### D-73 · 2026-10-17 · Guide rules that go beyond the plan are assumed
**Status: assumed.** Chaitanya asked for these to be marked as assumptions, not decisions. They hold until the plan's open questions are answered, and each guide still states them as rules so it reads cleanly. Changing one means editing the guides it appears in and this entry.

| Assumed rule | Where it appears | Open question it waits on |
|---|---|---|
| A design opens in an editor, where the person can move and adjust things | `guides/design.md` | plan.md: can people edit directly, or only through chat? |
| The store's brand (logo, colours, fonts) comes from the store and applies to everything | every guide | plan.md: is brand set per store, and where does it come from (Shopify theme, an upload, manual setup)? |
| Dashboards read live store data each time they open | `guides/dashboard.md` | plan.md: which store data can be read (catalog, orders, customers)? |
| Status is **Draft** until every required fact is there, then **Ready** | `guides/strict-document.md`, `design.md`, `file.md` | concept map, Round 1 (readiness): not yet answered |
| Page size is A4 or US Letter, chosen by the store's country | `guides/strict-document.md`, `file.md` | not in the plan or the engine. The baseline run used US Letter every time. |

### D-72 · 2026-10-17 · Router change: a named format decides delivery, not kind
**Status: approved** (Chaitanya, 2026-10-17, by updating `docs/output-system/plan.md`). It takes Phase 1 proposals 1 to 4 from [reports/output-system-phase-1.md](reports/output-system-phase-1.md) into the plan.

**Problem.** Under the original router:
- Step 2 sent any named file format to File, before the strict-document step. So "purchase order as a PDF" lost the fixed layout and exact totals.
- Step 2 also contradicted the plan's own "make it a PDF exports the current version" rule.
- "Share this with my team" about a chat reply went to a message card in 2 of 3 baseline runs (r29), because the share-this rule was in the plan but not in the prompt.

**Rule** (the plan's router and draft prompt, word for word in `docs/output-system/system-prompt.md`, version 2):
- **Step 1** adds: "Make it a PDF" exports the current version.
- **Step 2** is now: "Is it a raw data export (orders as Excel, products as CSV) or a change to a file the person uploaded?" Only then is it a File. The File lane covers only raw data exports and uploaded files.
- **Step 3** is now: a message for a particular person or list (a customer, a supplier, subscribers).
- **New rule:** a named format (PDF, Word, PowerPoint, Excel) decides how something is delivered, not what kind of thing it is. Choose the kind with the questions, then export it in that format. If that kind can't be exported in the named format, say so and offer the closest one.
- **New rule:** "Share this" or "share this with my team" about a chat reply turns it into a document, not a message.
- **The opening line** says "calculators and other interactive pages" instead of "tools".
- **"Words on screen"** now reads: "Never mention guides, templates or code to the person, or how things are made behind the scenes."

**What changed with it:**
- **Eval set.** Two expected lanes changed, because the new rules change the right answer:
  - r11 "Purchase order … as a PDF" goes from File to Strict document.
  - r28 "Make it a PDF" after an invoice goes from File to an export of the invoice's current version (`export:strict_document`).

  r29 was already expected to be a composed document. Only its note changed. No other request changed.
- **Harness.** It gained a new choice, `export_existing`: export something already made without changing it, scored as `export:<lane>`. Without it, the model had no way to report router step 1's new export case. This changed the test instruction's hash from `b53ddac96b33` to `4f43caf50777`.
- **Guides.** These were updated: File, Strict document, Message card, Composed document, Design, Chat reply, and the README index.

Applied in: `docs/output-system/system-prompt.md`, `docs/output-system/evals/requests.jsonl`, `docs/output-system/guides/`, `src/lib/output-system/lanes.ts`, `scripts/output-system/route-eval.ts`.

### D-70 · 2026-10-17 · Words on screen are checked by a test
**Status: proposed.**

**Problem.** The rule says guides and the prompt must use the concept map's words (document, version, file) and must never put system words in text a user would see. A rule nobody checks drifts.

**Rule.**
- `src/lib/output-system/words.ts` lists two kinds of forbidden word:
  - **System words:** skill, sandbox, tool, template, code, python, prompt, model, router, routing, lane, engine.
  - **Names the concept map rejected:** artifact, output, generated file, revision, and draft used as a noun.
- **A test checks every guide in full,** because Souvenir reads the guides and any line can end up in a reply. References that tell an editor where a value lives (tokens.json keys) are allowed.
- **Store and business terms pass:** "discount code", "business model", "search engine", and file formats the person names (JSON, CSV).
- **"Draft" with a capital is the readiness status,** so it passes. "The draft" fails.
- **The system prompt is not checked.** It is read only by the model and has to name the actions (`build_file` and the rest). Its "Words on screen" rule is what keeps those names out of replies.

Applied in: `src/lib/output-system/words.ts`; tests in `output-system.test.ts`.

### D-69 · 2026-10-17 · `tokens.json` is generated from the engine, not written by hand
**Status: proposed.**

**Rule.**
- **Generated from the engine.** `docs/output-system/tokens.json` is written by `scripts/output-system/build-tokens.ts` from three files: `src/lib/documents/tokens.ts`, `theme.ts` and `templates/brand.ts`. None of the three is changed.
- **The neutral palette** (ink, muted, rule, accent) comes from `UNBRANDED` in `templates/brand.ts`, which is D-61's unbranded profile. `tokens.ts` holds only the state colours. The brief named only `tokens.ts` and `theme.ts`, but `brand.ts` is where the prompt's "neutral default" lives.
- **Fonts are recorded by role:** voice, display, function and money. Their families are marked as OFL placeholders.
- **Every size is in points,** as the engine has it.
- **Not invented:**
  - radius
  - screen sizes in px for cards, charts and pages
  - dark-mode colours

  These are listed under `notDefined` instead, since the engine has no values for them.
- **A test keeps it in sync:** it fails if the committed file differs from what the generator produces.

Applied in: `src/lib/output-system/tokens.ts`, `scripts/output-system/build-tokens.ts`; test in `output-system.test.ts`.

### D-68 · 2026-10-17 · How Phase 1 is set up and measured
**Status: proposed.**

**Rule.**
- **Branch.** `feat/output-system-foundations`, stacked on `feat/chat-document-flow` (`c7dcd12f`).
  - `origin/main` has neither the model client (`providerFromEnv`, D-65) nor decisions after D-48, so a branch off `main` would lose the client and re-use decision numbers.
  - The trade-off: until S1 merges, a pull request from this branch also carries S1's commits.
- **Code location.** Lanes, eval parsing and scoring, token building and the words check live in `src/lib/output-system/`, so Vitest runs their tests (it only collects `src/**`) and Phase 2 can import the lanes. The harness itself is in `scripts/output-system/`.
- **The prompt is measured as written.**
  - `docs/output-system/system-prompt.md` is the plan's draft, word for word. Only an editor's comment at the top is added, and the harness strips it before sending.
  - The eval set was written before the prompt was touched.
  - Changes suggested by a run are proposed in the phase report, not applied. Tuning the prompt against the same 30 requests would make the score circular.
- **Expected lanes follow the router as written,** even where the plan contradicts itself. Two cases were flagged as ambiguous (r11, r28), and the conflict was raised in the report rather than resolved in the eval set. The plan resolved it in D-72.
- **The harness** sends the prompt as the first system block, and a separate, recorded test instruction as the second.
  - The test instruction asks which action the model would take first. The model answers with a `report_choice` call offered with `tool_choice: auto` (Opus 5.5 rejects forced tool use, D-66).
  - The harness maps the action to a lane.
  - "Asking one question" counts as right only where the request is marked `ask_ok`. "Update as a new version" scores as `update:<lane of the thing updated>`. A reply that names no action is retried once and then counted as a miss.
- **Key handling.** The model key comes from the environment, the same way as D-65. The harness can load `.env.local`, or a file named with `--env-file`, without printing anything. With no key it stops with exit code 3 and names the variable.
- **The action names** in the prompt (`build_file`, `create_document` and so on) are placeholders for engineering to rename, as the plan says.
- **Decision numbers.** S1 on `feat/chat-document-flow` is still open, and its last recorded decision is D-67. This branch uses D-68 to D-70 and D-72 onward, and leaves D-71 for S1's next decision (Chaitanya, 2026-10-17).

Applied in: `src/lib/output-system/`, `scripts/output-system/route-eval.ts`, `docs/output-system/`.

---

## Chat-to-document flow (branch `feat/chat-document-flow`)

The plan for this work is the "chat → document → refine → export" plan approved on 2026-10-15: slice S1 (invoice end to end, real model, hosted) is this branch; S2–S6 follow on later branches. Decisions D-49 to D-58 were settled by Chaitanya and Instinct before building; D-59 onward were made during the build.

### D-67 · 2026-10-15 · "Today" is the person's local date
**Problem.** Eval 8 ("dated today") set the invoice date to 2026-10-16 at 19:00 on 2026-10-15 in California. The tools took "today" from the UTC clock, which is already tomorrow there from 17:00. That would put a wrong date on a sent invoice.

**Rule.** The `today` given to the model is the calendar date in the local time zone where the tools run. For the chat that is the person's browser; for the CLI, the machine it runs on.

Applied in: `generation/tools.ts` (`today`); test in `generation.test.ts`.

### D-66 · 2026-10-15 · Opus 5.5 can't be forced to call a tool: the proposal tool is offered, not forced
**Problem.** The first real request (through OpenRouter, routed to Anthropic) returned 400 with Anthropic's own error and request ID (`req_011Cg4gpGEVMZe4wi6yB7zof`, `provider_name: Anthropic`): `tool_choice: type "tool" and "any" are not supported for this model.` This is the model's documented behavior on the direct API too, not an OpenRouter difference. Anthropic's "What's new in Claude Opus 5.5" says: "Claude Opus 5.5 doesn't support forced tool use. `tool_choice` set to `{"type": "any"}` or `{"type": "tool", "name": "..."}` returns a 400 `invalid_request_error`." The S1 step-4 code forced the tool, and the local stand-in accepted it, so the bug only showed against the real model. Claude Sonnet 5.5 rejects it the same way; Opus 4.8 accepts it. The model tier stays Opus 5.5 (D-59).

**Rule.**
- `tool_choice: auto`. The system prompt already says "Always respond by calling submit_proposal, exactly once."
- A reply without the tool call is `model-refused`, retryable. The loop now asks again within the same bound of 2 retries. A real refusal (`stop_reason: refusal`) and transport errors are not retried by the loop; the SDK already retries transport errors.
- Thinking is always on for Opus 5.5 and can't be disabled, so the request sends no `thinking` field. `max_tokens` goes from 4,096 to 16,000 to leave room for thinking, as the same page advises. A proposal measured 381–413 output tokens.
- `output_config.effort` is set explicitly to `medium`, the model's documented default, so a change of default can't shift behavior. No sweep was run.
- **Strict tool use is not adopted.** The proposal schema uses `minLength`, `maxLength`, `pattern` and `maxItems`. With strict on, Anthropic rejects these: "tools.0.custom: For 'array' type, property 'maxItems' is not supported". The gate and retries remain the safety net. Making the schema strict-compatible is a possible later change.

Research (primary sources, 2026-10-15): Anthropic's "What's new in Claude Opus 5.5", "Fine-grained tool streaming" and "Structured outputs" pages, plus live probes recorded in the S1 report.

Applied in: `generation/claude.ts`, `generation/loop.ts`; tests in `model.test.ts`, `generation.test.ts`.

### D-65 · 2026-10-15 · The model runs through Souvenir's OpenRouter key; the direct Anthropic API is the fallback
**Status: approved** (Chaitanya, 2026-10-15). Chaitanya chose Souvenir's OpenRouter key over a direct Anthropic key, with `ANTHROPIC_API_KEY` kept as an env-switched fallback. Chaitanya then approved the base URL, bearer auth and Anthropic-only pinning below, and confirmed the D-59 model tier: "failing instead of silently moving to Bedrock/Vertex is the right tradeoff for behavior parity." Prompt retention on the OpenRouter account is Chaitanya's to check, as an account setting.

**Rule.**
- `MODEL_PROVIDER` picks the provider: `openrouter` or `anthropic`. Unset or blank: OpenRouter when `OPENROUTER_API_KEY` is set, otherwise Anthropic. Any other value is an error.
- A named provider without its key is a `model-unavailable` error that names the missing variable. It never falls back to the other provider (D-52: no silent substitution).
- Both use the same `@anthropic-ai/sdk` client, request, forced tool and streaming. OpenRouter differs only in base URL, credential header, model name and one routing field.
- Models: `OPENROUTER_MODEL` (default `anthropic/claude-opus-5.5`) or `ANTHROPIC_MODEL` (default `claude-opus-5-5`). This is the D-59 tier, the latest Opus, which OpenRouter's public model list (`GET https://openrouter.ai/api/v1/models`, read 2026-10-15) lists with tool support and a 1M context. `DOCUMENT_MODEL` is replaced by `ANTHROPIC_MODEL`; it was never set anywhere outside this branch.
- Variables are documented in `.env.example`, which `.gitignore` now lets through (`!.env.example`). `.env.local` stays ignored.

**Departures from the brief, with evidence.**
1. **Base URL `https://openrouter.ai/api`, not `https://openrouter.ai/api/v1`.** The SDK posts to `{baseURL}/v1/messages` (`node_modules/@anthropic-ai/sdk/resources/messages/messages.js`). With the brief's URL that is `/api/v1/v1/messages`, which OpenRouter answers with 404; `/api/v1/messages` answers 401 without a key, so it exists. OpenRouter's Claude Code guide gives the same base URL ("`https://openrouter.ai/api`").
2. **The key is sent as a bearer token**, the SDK's `authToken`, with `apiKey` set to null. OpenRouter's guide: OpenRouter "authenticates requests with a bearer token"; `x-api-key` "is treated as a direct-Anthropic credential". Nulling `apiKey` also stops the SDK from sending an `ANTHROPIC_API_KEY` from the environment to OpenRouter.

**Routing.** OpenRouter requests carry `provider: { order: ["anthropic"], allow_fallbacks: false }`, a field its Messages endpoint documents. This keeps requests on Anthropic's own servers rather than Bedrock or Vertex, so behavior should match the direct API. OpenRouter's guide says Claude Code "is only guaranteed to work with the Anthropic first-party provider". The trade-off: when Anthropic is down through OpenRouter, requests fail rather than move to another host.

**Not covered by D-56's "no logging".** Whether OpenRouter keeps prompts is a setting on Souvenir's OpenRouter account, not something this code controls.

**Where it's recorded.** The brief asked for this note in "design.md". In this build that name is reserved for the per-brand style artifact (D-53, slice S4), so the note lives here and in the feature README's "Document model provider" section instead.

Research (primary sources, 2026-10-15): OpenRouter's Claude Code integration guide (openrouter.ai/docs/guides/guides/claude-code-integration); its Anthropic Messages reference (openrouter.ai/docs/api/api-reference/anthropic-messages/create-a-message); its public model list; and the installed SDK's source.

Applied in: `generation/claude.ts` (`providerFromEnv`, `ClaudeModel`), `.env.example`, `.gitignore`, `scripts/documents/agent.ts`; tests in `model.test.ts`.

### D-64 · 2026-10-15 · Each document's conversation starts at "New document"
**Problem.** The chat sent the model, and allowed quotes from, every message in the thread. A new invoice could therefore quote "$2,400" from an earlier document's conversation, and the quote check would pass because those words really were in the source text.

**Rule.** "New document" now adds a divider to the thread. Only the person's messages since the last divider go to the model as conversation, and only those can be quoted. This applies D-49: nothing from another document is carried in.

Applied in: `src/app/document-chat/DocumentChat.tsx`, `chatSession.ts`; test in `chat-ui.test.tsx`.

### D-63 · 2026-10-15 · "$" is read as US dollars — awaiting Chaitanya's confirmation
**Status: proposed, not approved.**

The model's instructions (`generation/claude.ts`) say a "$" amount means USD unless another dollar currency is named, and the model sets the invoice currency quoting the amount. This is an inference, not a stated fact. It decides how the done prompt, "invoice for Acme, $2,400", is read.

The alternative is to leave the currency missing for a bare "$". Then every amount on the invoice is unknown until the person names the currency, and the line items can't be checked against $2,400.

Listed in the S1 report for approval.

### D-62 · 2026-10-15 · What "deterministic export" guarantees
The brief: "Export is deterministic; never re-summarize at export time." The `export_document` tool renders the pinned revision with the existing adapters and nothing else, and stamps the file with the **revision's** creation time, not the export time.
- **PDF: byte-identical** for the same revision. jsPDF chose a random file ID on every export; `pdf.ts` now derives it from the title, subject and creation time.
- **Word: content-identical, not byte-identical.** `word/document.xml` is the same text and layout every time, but the docx library numbers pictures across the whole process, writes the current time into `docProps/core.xml`, and keys the embedded fonts with random GUIDs. Making the package byte-stable needs a zip post-processor (re-keying the fonts), recorded as a later step.
Applied in: `src/lib/documents/export/pdf.ts`, `src/lib/documents/generation/tools.ts`, tests in `generation.test.ts`.

### D-61 · 2026-10-15 · Documents with no stated issuer are unbranded
Every snapshot carries a brand profile, and the issuer's name comes from it (`issuer.name` is brand-owned). A prompt such as "invoice for Acme, $2,400" names no issuer, and D-49 forbids inventing one, so generated documents use an **unbranded** profile (`templates/brand.ts`): no name, no logo, a neutral palette, the default type theme.
- An unbranded document has **no letterhead**; it starts at its title rather than showing an empty mark or "No logo supplied".
- The issuer field stays missing until someone states it. On an unbranded document `issuer.name` is an ordinary field (not brand-owned), and once supplied it appears in the footer.
- Fixture invoices keep their fictional brands and render exactly as before.
- The invoice block skeleton moved from the fixtures to `templates/invoice.ts` so fixtures and generation build invoices the same way.
Applied in: `src/lib/documents/templates/`, `compose.ts`, `revisions.ts`.

### D-60 · 2026-10-15 · An unstated line-item description is missing, not an error
Amends the Step 1 validation rule ("Line item has no description" was a blocking error). "invoice for Acme, $2,400" does not say what the $2,400 covers.
- A description that was not supplied is stored as `null` and reported as **missing**: the invoice saves as incomplete, the preview shows the approved missing-value state ("Missing — Description"), and it exports as a draft. A supplied but blank description is still an **error**.
- After the draft saves, the chat's follow-up may ask what the amount covers; that is the refine loop, not a gate. The first turn always produces a document.
- Rejected: using the prompt's own words as the description, which reads as junk on a sent invoice.
Applied in: `model.ts` (`InvoiceLineItem.description: string | null`), `validation.ts`, `compose.ts`, `layout/blocks.ts`, `export/docx.ts`, `session.ts`; test in `validation.test.ts`.

### D-59 · 2026-10-15 · Scope of the generation work
Output types: invoice first, then brief, memo or report, then deck (derived from the brief), then letter, one-pager and proposal. Inputs: the prompt, the chat conversation, pasted text or Markdown, and PDF (sent to Claude as a document). DOCX input comes later, after asking about a parser package. Model per step: the latest Opus for first-pass generation; if refine turns feel slow in play-testing, refine may step down to Sonnet, recorded as a decision with the reasoning.

### D-58 · 2026-10-15 · Real citations only when traced
A citation may be real (not marked fictional) only if it points to a source in the request's evidence bundle (the conversation or an uploaded file) and the host checks that the source exists. Claims carry provenance. Fixtures stay fictional. Amends the PRD's fictional-only rule; lands in S2.

### D-57 · 2026-10-15 · The Claude client is `@anthropic-ai/sdk`
One new dependency, used on the server and in the CLI only, never in the browser bundle.

### D-56 · 2026-10-15 · One model-only route
The demo chat reaches the model through one new route handler, `/api/document-model`, that only forwards a model request and returns the candidate operations. It answers 404 in production and is open in development and on Vercel previews; it caps tokens, body size, retries and time, and never logs prompt content. The pipeline, gate and revisions stay pure TypeScript and run the same for every caller. Amends D-51's "no HTTP routes". No existing route, auth guard or `/api` proxy rule changes.

### D-55 · 2026-10-15 · Generate any type and read sources, staged
Types first, conversation as a source second, file uploads third.

### D-54 · 2026-10-15 · Done condition for S1
A hosted Vercel preview running the real model (Chaitanya adds the Anthropic key to Vercel's Preview environment), multi-turn refinement in the chat: a fresh visitor prompts an invoice, revises it twice, and exports a PDF.

### D-53 · 2026-10-15 · The frontier bar
Real generation, output at a designer's bar, fast refine laps. design.md (a versioned per-brand style artifact) is the next slice after the invoice.

### D-52 · 2026-10-15 · The generation writer is swappable
A `GenerationModel` interface. A scripted model for tests and CI, including deliberately bad output to test retries. A real Claude-backed model in development; the API key lives in a local `.env` only (git-ignored), never committed.

### D-51 · 2026-10-15 · The agent surface
Pure TypeScript tools (`generate`, `revise`, `export`) with exported JSON tool schemas, plus a vite-node CLI that reads and writes a store file and prints JSON tool results. The revision store is passed in and returned; there is no parallel store.

### D-50 · 2026-10-15 · The chat client is a demo route
A chat page beside `/document-verify`, open in development and on Vercel previews, 404 in production. Wiring the real `/chat` is a later PR, after its environment is set up.

### D-49 · 2026-10-15 · The gate blocks invalid documents only
Schema errors, wrong types and sums that don't match block saving. Missing facts are saved as explicit unknowns (shown as missing in the preview), and the document exports as a draft. Nothing is invented.

**Research used for D-49 to D-62.** The research digest supplied with the plan (two rounds, already verified, not re-fetched): the intent → outline → typed blocks pipeline with per-type budgets and provenance (cathrynlavery/diagram-design); constrained generation with an exhaustive runtime schema, structured validation errors, bounded retries and atomic application (Nutrient's agentic-tools and workflow guides), including the trap that a whole-document replace loses element identity, which is why operations target stable IDs; target-plus-digest edit safety, distilled from a source this build never reads; and schema validity is not truth, unknown versus observed absence (morluto/rea). Taken from them: the layered gate (`gate.ts`), digest-checked revise operations, host-assigned IDs, the quote check on every prompt-derived value, and the two-retry loop.

---

## Review of PR #1

### D-48 · 2026-10-15 · Merge PR #1; release stays unapproved
On D-47's approval, Chaitanya had PR #1 marked ready and merged into the fork's `main` with a merge commit (not a squash), so every step commit cited in these docs stays in `main`'s history. Release is a separate verdict from Instinct and is **not approved**. `feat/document-quality` is kept until the release verdict, then deleted.
Applied in: merge commit `b1025a93` (PR #1, merged 2026-10-15 15:02 UTC); this record via PR #2.

### D-47 · 2026-10-15 · Instinct's re-review of PR #1: approved
Verdict on PR #1 at `06763bb1`: **approved to merge.** Conditions 1–3 of D-45 were verified by direct code inspection at `06763bb1`, with their regression tests present; CI is green (React Doctor 0 errors / 50 warnings; Vercel deployed). Instinct did not independently re-run the test suite or re-inspect the slide images; the approval rests on code inspection and CI.
Non-blocking cleanup, applied: the PR body's test count (1,421 → 1,425) and decision range (D-01 to D-44 → D-01 to D-47); the React Doctor summary's tally (47 accepted / 2 debt → 48 accepted / 1 debt, matching the tables); the Step 7 report's original "(continued)" finding marked superseded by D-46.
Applied in: `a0e2c3ad`.

### D-46 · 2026-10-15 · "(continued)" is tracked per section
Every slide after the first that repeats a section's heading carries the approved "(continued)", whether the section overflowed onto the next slide or was deliberately split (text, then its chart on its own slide, then more text). In the sample deck, slides 4 (chart) and 5 (text) now read "Evidence: … (continued)". A one-slide continuation may still share a slide with the next short section (D-26); a section that overflowed onto several slides never shares.
Resolves the Step 7 finding. Refines D-28.
Applied in: `src/lib/documents/layout/slides.ts`, deck PDF/PowerPoint samples and page images regenerated.

### D-45 · 2026-10-15 · Instinct's review of PR #1: ready, with conditions
Verdict on draft PR #1 at `874fb039`: ready with conditions, to be applied before merge; **no merge until Instinct re-reviews.**
1. Mark both slide 4 (chart) and slide 5 (text) with "(continued)" via section-level continuation tracking; regenerate the deck PDF/PowerPoint and page images; recheck visually; record the decision (D-46); remove stale "awaiting a decision" entries.
2. Reset during an export: a late completion after Reset or Start again is discarded silently — no late file, status, announcement or preview, and no unhandled rejection — with a held-resource regression test.
3. Malformed-session recovery returns early when the backup can't be written, keeping the raw-data banner and its actions, with a test where `setItem` fails.
4. Document the disposition of the 51 advisory React Doctor findings.
5. Annotate the report inconsistencies: Step 1 "behind login" vs "404" in production; Step 3 "9 slides" vs the sample deck's 6; "171 files" vs 172 at the reviewed commit.
6. Record the export-bytes memory retention as known debt.
- Rerun lint, typecheck, tests and build on the final commit.
Applied in: see [reports/step-7.md](reports/step-7.md), "Review follow-up".

## After Step 6

### D-44 · 2026-10-15 · Push the docs to the public repo
`Chaiidesign/craft` is a public GitHub repo, so pushing makes the PRD and the playbook publicly readable, including the PRD's reference links (a `files.instinct.com` spec link and links into the private `souvenir-inc/may-day` repo). Chaitanya was told this and chose to push as is, without making the repo private or removing the links.
Applied in: `9df0654e`, `1780e9ba`, `51901953`, pushed to `feat/document-quality`.

### D-43 · 2026-10-15 · Save work at every checkpoint; approval gates merge and release
The standing protocol is saved as [workflow.md](workflow.md). Its rule 3 was changed from "stop and wait for Instinct's verdicts, then commit and push" to: commit and push checked work to the feature branch at every meaningful checkpoint; Instinct's verdicts gate merge and release, not saving work. The repo is the single source of truth: specs, decisions (this file), step reports (`docs/reports/`) and progress ([progress.md](progress.md)) are committed files, and nothing exists only on a Mac or in Messages. A root `CLAUDE.md` imports the protocol and points to the PRD and the progress file. The reasoning is in [ai-build-playbook.md](ai-build-playbook.md).
Supersedes D-03's "no commit or push until the report is approved".
Applied in: `1780e9ba`, `51901953`.

### D-42 · 2026-10-15 · The PRD lives in the repo
The PRD was only a Messages attachment. It is now `docs/souvenir-document-generation-prd.md`, byte-for-byte the attachment as amended by D-40, and checked against the copy on GitHub. The Drive/Messages copy can be deleted once it's confirmed on the branch.
Applied in: `9df0654e`.

### D-41 · 2026-10-15 · Delete the `step-4-revisions` branch
It held Step 4 only (head `0e031c76`), which is already part of `feat/document-quality`. Deleted from the fork after confirming that commit is an ancestor of the feature branch.

## Step 6 — session storage, recovery, cancel, errors (commit `0cca21d6`)

### D-40 · 2026-10-15 · Step 6 verdicts
1. **Cancel only during loading.** Cancel takes effect only while an export loads its fonts and images; once a renderer starts, the page can't respond until it finishes, and the late result is discarded. No artificial slow render is built to widen the window. Recorded as a known limitation.
2. **Banner line.** Edits made while the malformed-session banner shows aren't saved (saving is paused so the unreadable data isn't overwritten). The banner says so: "Changes won't be saved while this banner is showing." The workbench is not made read-only, because that would need a whole state machine for an edge case.
3. **`expired` export status.** `ExportRecord` has five statuses: pending, succeeded, failed, unsupported, expired. The PRD was incomplete; its section 5 was updated.
4. **Reset backs up a malformed session first.** Reset on a malformed session saves a backup copy before clearing, as "Start again" does.
5. **Hydration fix (Step 4 bug).** Revision IDs used `Date.now()` from the first render, so server and client HTML differed. The first render now uses fixed `fx` IDs; IDs created after mount carry a prefix unique to the page load, so they never collide with saved IDs.
6. **Generated malformed sessions.** The Step 1 hand-written list of broken sessions is replaced by `malformedSessions()`, which breaks one thing in a valid session per kind.
7. **Two tabs: last write wins.** Accepted as a known limitation; no cross-tab sync.
8. **One message on a viewer error.** The Step 5 status "The PDF could not be shown." is removed while the viewer-error alert shows, so a screen reader announces one message.
- **Text approved:** "Export again"; "Forced viewer failure (scenario 11 only)"; "Forced renderer failure (scenario 11 only)" and "Forced failure (scenario 11 only)"; the download name `souvenir-doc-workbench-unreadable.json`; the announcements "Restored the saved workbench session.", "Started again from the sample fixtures." and "Workbench reset to the sample fixtures."; and the detail text in "fails validation: {message}".
- Checking export rows at 320px by measurement rather than screenshot is accepted.
Applied in: `0cca21d6`; README "Session, recovery and errors" and "Known limitations"; PRD section 5.

### D-39 · 2026-10-15 · Step 6 design
1. **Storage split.** Revisions, approval markers and export records are saved in this browser under one versioned key, `souvenir-doc-workbench:v1`. Export files are never stored. On reload, a finished export becomes "expired" with an Export again action, and a running one comes back cancelled, so it can never block a new export. This is demo storage, not production persistence.
2. **Broken saved sessions.** Never silently replaced. A banner names the reason and offers "Download the unreadable data" and "Start again from the sample fixtures". Nothing is written until one is chosen; Start again first copies the data to a backup key (`souvenir-doc-workbench:v1:backup`). Each kind of breakage has a test that forces it: not JSON, unknown version, wrong structure, current revision not in history, missing parent, missing deck source, approval of a missing revision, and a snapshot validation can't read. Save failures (storage full or blocked) show a warning.
3. **Cancel.** Marks the record cancelled (error code `cancelled`) and discards the late result, with honest screen text. Fixes a Step 5 bug: the "ready" announcement and the PDF-preview switch now follow the stored record, not the render outcome, with a test.
4. **Renderer vs viewer errors.** A renderer error is a failed export with Retry. A viewer error means the file was made but couldn't be shown: the download still works, with "Try the viewer again" and "Show the HTML preview". Sections have error screens, and a failing HTML preview is covered by them. Scenario 11 has two scenario-only checkboxes: "Force a renderer failure (scenario 11 only)" and "Force a viewer failure (scenario 11 only)".
5. **Duplicate filenames.** An export's identity comes from its record, never its filename.
- **Text approved as written:** the cancel button and labels, the expired and reload-cancelled labels, the malformed-session banner and its eight reasons, the save-failure warning, the Reset button and confirmation, the viewer-error text and buttons, the section error screen, and the scenario 11 checkboxes. Exact wording is in the README's "Session, recovery and errors" section.
Applied in: `0cca21d6`.

## Step 5 — real exports (commit `8a05e154`)

### D-38 · 2026-10-14 · Step 5 approval
1. `next.config.ts` always declares `turbopack` (empty unless the design-system sibling exists), because Next 16 refuses to start Turbopack dev when a `webpack` hook exists without one.
2. Word's running header sits 24pt from the top edge (`WORD_HEADER_FROM_EDGE_PT = 24`).
3. All new workbench text as listed in the README's Step 5 section.
4. The short revision ID in filenames is the last four hex digits of the revision ID's FNV-1a hash.
5. The Word chart order is: title, picture, axes line, data table, summary.
6. `sharp` 0.34.5 is declared as a devDependency (it rasterises the chart picture's PNG fallback in Node).
7. The Pages long-table limitation is documented, and Word's page-break rules are not weakened to suit Pages.
Applied in: `8a05e154`; README "Exports".

### D-37 · 2026-10-14 · Build fix for pptxgenjs: a scoped webpack rule
pptxgenjs 4.0.1 contains `import('node:fs')` and `import('node:https')`, which webpack refuses in client bundles. Fix: a client-only webpack rule mapping exactly those two imports to empty modules.
Applied in: `8a05e154` (`next.config.ts`).

### D-36 · 2026-10-14 · Word chart, invalid revisions, filename length
- **Word chart:** the `docx` library can't make native Word charts. The chart appears both as a picture and as an editable data table.
- **Invalid or empty revisions:** export is refused with the reason. The empty document's message is "This {kind} has no fields and no content blocks, so there is nothing to export."
- **Filenames:** each filename part is capped at 40 characters.
Applied in: `8a05e154`.

### D-35 · 2026-10-14 · Step 5 plan
1. Word and PowerPoint files are checked by opening them in Pages and Keynote through AppleScript, exporting to PDF and inspecting the pixels. Microsoft Word and PowerPoint themselves remain unverified (not installed).
2. A deliberately triggered Word failure for scenario 9, scenario-only and clearly labelled.
3. Tests use a built-in zip reader, with no new dependency.
4. Sample files and page images are committed (`docs/documents/samples/`).
5. **Text approved:** the filename pattern `{issuer}_{document number or title}_v{n}_{short revision ID}.{ext}`; the draft warning, "Export draft" and "Cancel"; the unavailable reasons; the status labels "Preparing {format} of v{n}…", "{format} of v{n} ready ({size})", "{format} failed: {reason}" and "Retry {format} of v{n}"; the preview labels "HTML preview (not the PDF)" and "PDF preview (generated file, v{n})".
6. Fonts are embedded in Word files. Pages ignores them and uses Helvetica; this is recorded.
Applied in: `8a05e154`.

## Step 4 — revisions (commits `cf6c9884`, `0e031c76`)

### D-34 · 2026-10-14 · Issuer address stays editable
A correction to the Step 4 review: only the issuer name is brand-locked. The issuer address is an ordinary document field and stays editable.
Supersedes the address part of D-33.
Applied in: `0e031c76`.

### D-33 · 2026-10-14 · Step 4 review fixes
1. The document record's title is recomputed when a brief's title or an invoice's number changes; derived-deck summaries use the current title.
2. Bounded edits are validated at the store: real calendar dates, money as non-negative whole minor units in the invoice's currency, percentages in range, text trimmed.
3. A restore identical to the current revision, and deriving a deck again from the same brief revision, are refused with specific messages.
4. Approving an older revision stays allowed; approving a specific past version is legitimate.
5. ~~Issuer address joins the brand-locked fields~~ — **superseded by D-34**.
6. Tests: a render test that the issuer name has no Edit control, and a test that a proposal touching the issuer name is refused.
Applied in: `0e031c76`.

### D-32 · 2026-10-14 · Push Step 4 to a review branch
Step 4 was pushed to a new branch, `step-4-revisions`, for review. That branch was later deleted by D-41.

### D-31 · 2026-10-14 · Step 4 refinements
1. Edits to the issuer name are refused with an explicit reason: issuer identity comes from the brand profile, and brand editing is outside this build. Two issuer names in one document is worse than a refused edit.
2. **Text approved:** "Created", "Ancestry check failed: {reason}", "Sample reviewer (fictional)", both proposal titles ("Clearer payment terms", "Tighter evidence sentence"), and "v2 · Current".
3. Em dashes stay, matching the already-approved "Draft — incomplete".
4. Decks are derived documents: you edit the brief and derive again. A direct deck edit is refused with an explicit message.
5. Workbench text approved as written.
Applied in: `cf6c9884`.

### D-30 · 2026-10-14 · Step 4 scope and wording
- Scope confirmed: all ten parts, nothing added. The deferred deck-ancestry check runs against real revisions.
1. The revision store lives in memory for Step 4; browser storage and broken-session recovery wait for Step 6 (built in D-39). Superseded by D-39 for storage.
2. **Bounded edit:** one field value, one line item's description, quantity or unit price, or the text of one sentence or list item. No adding or removing whole blocks or rows.
3. "v1", "v2"… are display labels in creation order; revision IDs remain the true identity. Authors: "Sample operator (fictional)" for edits, "System" for derivations and restores.
4. **Text approved:** history labels "Current" and "Viewing v{n} — not the current revision"; change summaries "Edited {field label}", "Edited line {n}: {quantity / unit price / description}", "Edited text in {section heading}", "Accepted proposal: {proposal title}", "Restored from v{n}", "Derived from {brief title} v{n}"; approval marker "Approved (sample) by {reviewer} on {date} — applies to v{n} only" and "Not approved"; deck ancestry "Derived from brief v{n} — current" and "Derived from brief v{n} — the brief now has v{m}. This deck does not update by itself; derive again to update."
5. Two fictional proposals: a payment-terms wording change in the invoice and one tightened evidence sentence in the brief. Before and after are shown; no AI.
- Working agreements: new values and new document wording are proposed and approved before use; explicit errors, never silent fallbacks; a test for every rule, including cases forced to fire; full suite, typecheck, lint and build clean before reporting.
Applied in: `cf6c9884`.

## Step 3 — layout and pagination (commit `a6e5e0e5`)

### D-29 · 2026-10-14 · `ja-JP` refusal is a known limitation
The placeholder fonts can't draw `ja-JP` dates (年, 月, 日) or the full-width ￥. Layout stops with a clear "characters the fonts can't draw" error; nothing is substituted.
Applied in: README "Known limitations".

### D-28 · 2026-10-14 · Pagination wording
**Text approved:** "Continued from previous page" (a row carried over a page break), "(continued)" after a repeated slide heading, "Page n of N" (pages), "n / N" (slides), and a running header of issuer · document number plus the draft state on pages 2 onward.
Applied in: `a6e5e0e5`.

### D-27 · 2026-10-14 · Pagination values (recorded values, not spec changes)
At least 2 lines on each side of a paragraph or list-item break (`KEEP.orphans`, `KEEP.widows`); 2 line-item rows kept with the totals (`KEEP.rowsWithTotals`); prefer a section break when under 120pt remains (`KEEP.preferredBreakMinSpacePt`); chart plot height 128pt in print and 220pt on slides; block spacing as in `FLOW` and `SLIDE_FLOW` in `tokens.ts`.
Applied in: `a6e5e0e5`.

### D-26 · 2026-10-14 · Up to two short sections may share a slide
At most two short consecutive sections may share a slide, each keeping its own heading.
Applied in: `a6e5e0e5`.

### D-25 · 2026-10-14 · Payment terms stay with the totals
Payment terms are kept with the totals and never stand alone on a page. In the long invoice, the last page carries the last rows, the totals and the terms.
Applied in: `a6e5e0e5`.

## Step 2 — typography, tokens, templates (commit `87b61b53`)

### D-24 · 2026-10-14 · Yen is refused, never substituted
The Money face can't draw the yen sign. It is recorded as missing, and export is refused for documents that need it. Never substitute silently.
Applied in: `87b61b53`.

### D-23 · 2026-10-14 · Font roles for details
Rates inside totals labels use Function; chart values use Function; currency codes use Money; the footer invoice ID uses Function 8pt.
Applied in: `87b61b53`.

### D-22 · 2026-10-14 · Leading values
Issuer name leading 1.2; grand total leading 1.3; field values Function 9.5/1.4.
Applied in: `87b61b53`.

### D-21 · 2026-10-14 · The hosted typography spec needs no update
Building from the typography spec as given in the session is fine; the hosted spec matches it.

### D-20 · 2026-10-14 · App-shell requests are documented, not changed
The shared root layout's `AuthProvider` requests `/auth/access-token` on every page, including the demo. This is the app shell's session check, not a document service call: leave it and note it in the README. Same for Mixpanel on Vercel previews.
Applied in: README "Known caveats of the demo route".

### D-19 · 2026-10-14 · Checkpoint each step locally
Commit each step locally with a clear message before starting the next.
Superseded by D-43, which adds pushing at every checkpoint.

### D-18 · 2026-10-14 · Typography spec is the source of truth
The typography spec at `https://files.instinct.com/rnub2313fscd-souvenir-typography-spec` is the reference for roles, scales, rules and acceptance tests.

### D-17 · 2026-10-14 · Size floors on slides
18pt minimum for slide body content; 12pt minimum for captions, citations and chart data summaries.
Applied in: `87b61b53`.

### D-16 · 2026-10-14 · Newsreader optical size
All Voice files use Newsreader's text optical size. At 13pt a display cut would look thin, and Archivo already covers the large sizes.
Applied in: `87b61b53`.

### D-15 · 2026-10-14 · Static font files
Archivo SemiCondensed 600; Newsreader at one optical size (see D-16). Only those files are committed.
Applied in: `87b61b53`.

### D-14 · 2026-10-14 · Stop if a face lacks ₹
If IBM Plex Mono lacks ₹, stop and ask; no silent substitution.

### D-13 · 2026-10-14 · Slide scale
Title Display 32/1.1; slide heading Display 24/1.2; body Voice 18/1.4 minimum; captions Function 12/1.35.
Applied in: `87b61b53`.

### D-12 · 2026-10-14 · Table rows unified at 9.5pt
Table text and amounts are both 9.5pt, tuned optically; sizes are not mixed within a row.
Applied in: `87b61b53`.

### D-11 · 2026-10-14 · Styles for remaining text
Grand total Money Medium 12pt; table header Function Medium at table-text size; invoice number and reference IDs Money Regular 9.5pt; dates Function 8.5pt caption style; issuer name in the letterhead Display 18pt; citations and source list Function 8pt; draft marker Function Medium 8.5pt, uppercase, tracking +0.08em.
Applied in: `87b61b53`.

### D-10 · 2026-10-14 · Weights per role
Voice: Regular, Italic, SemiBold. Display: one weight (600). Function: Regular and Medium. Money: Regular and Medium. No other weights.
Applied in: `87b61b53`.

### D-09 · 2026-10-14 · Typography system
- **Architecture:** document fonts are tokens. `src/lib/documents/theme.ts` is the only file that names font families; `tokens.ts` reads it, and every renderer reads tokens. Placeholders can be swapped with a one-file edit; the final choice is made later by rendering the same fixture in candidate themes.
- **Roles and placeholders** (all SIL OFL, committed as TTF with their licences): Voice = Newsreader (body, section headings, pull quotes); Display = Archivo (title, headline moments, condensed); Function = IBM Plex Sans (labels, captions, metadata, tables, footer); Money = IBM Plex Mono with tabular figures (every amount, ID, reference number and table numeral). Noto is not committed; non-Latin scripts are an explicit unsupported state.
- **Print scale (pt):** title Display 28/1.15, −0.01em; section heading Voice SemiBold 13/1.3; body Voice 10.5/1.5; pull quote Voice Italic 14/1.45; labels and captions Function 8.5/1.4, +0.02em; footer and page numbers Function 8/1.4.
- **Rules:** numerals carrying money, quantity, ID or reference meaning use Money; prose numerals may use Voice. Emphasis is Voice Italic, never synthetic slant or underline. Letter-spacing is 0 except labels, captions, the title and the draft marker. Only the named weights.
- **Tests:** each committed TTF covers every fixture currency symbol; tokens expose every scale value and renderers use tokens, not literals; PDF and Word show the same fonts.
Applied in: `87b61b53`.

## Step 1 — foundations (commit `13265b24`)

### D-08 · 2026-10-14 · Build plan approved
Step 1 foundations (model, money, validation, fixtures, workbench shell); Step 2 tokens, primitives, templates and typography; Step 3 pagination and deck slide splits; Step 4 revisions; Step 5 renderers (jsPDF native text, not html2canvas; docx; pptxgenjs; capability registry; committed samples; Word and PowerPoint visual fidelity reported unverified where tooling is missing); Step 6 workbench states (PRD §9); Step 7 checks, README and report.

### D-07 · 2026-10-14 · Dependencies approved
`docx`, `pptxgenjs`, OFL document fonts committed as TTF, and `jsdom` + Testing Library for tests. As built, the UI tests use React's own test utilities in per-file jsdom environments, so `vitest.config.ts` is unchanged.

### D-06 · 2026-10-14 · "Preview sorted" means a Vercel preview link
"Preview sorted" means a Vercel preview deployment of the feature branch, plus the local demo at http://localhost:4010/document-verify.

### D-05 · 2026-10-14 · The demo route opens without a login, outside production only
`/document-verify` is added to `src/proxy.ts` so it opens without a login in development and on Vercel preview deployments, and returns 404 in production. This doesn't weaken any existing route.
Applied in: `13265b24`.

### D-04 · 2026-10-14 · Where the work lives
`~/craft`, a fresh clone of the fork `Chaiidesign/craft`, on a new branch `feat/document-quality`. The only remote is `origin`, the fork.

### D-03 · 2026-10-14 · How each step runs
Plan first and get approval before building. After each step, explain in plain language what exists and how to see it. If the PRD is ambiguous or conflicts with the repo, stop and ask instead of guessing. No commit or push until the report is approved — **superseded by D-43**.

### D-02 · 2026-10-14 · Mock data only
Mock and local data only: no backend calls, no auth work, no invented environment values. Fixtures are fictional and labelled as sample data.

### D-01 · 2026-10-14 · All work stays in the fork
All work stays in `Chaiidesign/craft`, never upstream. `Flowting-ai/front-end` and `souvenir-inc/may-day` are read-only references. Don't change remotes, pull or merge upstream, add secrets or overwrite unrelated edits.
