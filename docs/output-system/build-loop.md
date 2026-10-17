# Souvenir output system: launch build loop

Build prompt for Claude Code | 17 October 2026 | Handoff this morning; demo-ready Friday 23 October

Save this file as `docs/output-system/build-loop.md`. Run it one session at a time (section 6). Start each session with: "Read docs/output-system/build-loop.md and docs/progress.md, then run the next session."

Before leaving the Mac unattended: keep it plugged in, on a stable network, and stop it sleeping (System Settings, or run `caffeinate -dimsu` in a separate Terminal window). Check in and answer stops from the Claude mobile app.

## 1. Outcome

A local prototype at `/output-verify` where a person types a store request and gets the finished thing back, chosen by the router and shaped by Souvenir's design system. This build covers the four launch lanes only:

1. **Chat reply**
2. **Strict document**
3. **Composed document**
4. **File**

Message card and inline chart are "if time allows" at the end of Session 1, only after chat and file pass their checks. Every other lane (design, dashboard, published page) shows an honest "coming later" state on `/output-verify`, as do message card and chart if they are not built. They belong to a later build loop, not this one. The format-not-supported card is in scope, because launch lanes need it.

Done means: on Friday 23 October the designer can open `/output-verify`, try realistic store requests in the four lanes, and see results they would ship with small edits.

## 2. Read before anything else

Read these in full in Session 0 and print a reuse map. In later sessions, reread only what the session needs. The existing design work is the foundation; do not redesign what is already decided.

- `docs/output-system/system-prompt.md` (v4): source of truth for routing.
- `docs/output-system/plan.md`, `guides/`, `tokens.json`, `formats.json`, `evals/`.
- `docs/documents/README.md`: typography roles (Voice, Display, Function, Money), type scale, pagination, revisions and export rules. These are approved decisions.
- `src/lib/documents/`: model, tokens, theme, primitives, layout engine, revisions, exporters, capabilities registry.
- `docs/design-system/` and `fe system design/`: app components, copy guide, master concept map, frontend principles.
- `docs/documents/samples/`: the current quality bar.
- `docs/decisions.md`, `docs/progress.md`, `docs/workflow.md`, `CLAUDE.md`.

## 3. Standards to learn from

Study established conventions for each kind of output and encode them as template and guide rules. Take patterns and structure, never another company's layout, brand, wording or assets. Record which standard shaped each template in its guide under "Based on".

| Kind | Standards and conventions to draw on |
| --- | --- |
| Invoice, quote, purchase order, receipt, credit note | EN 16931 / UBL core fields; India GST invoice fields (fixtures include INR); issuer-first hierarchy; totals block with subtotal, tax lines, total due; payment terms beside totals |
| Packing slip, returns policy | Common retail practice: order reference, items without prices on packing slips; plain-language policies with numbered sections |
| Report, brief, campaign plan, SOP, spec sheet | Answer-first structure (pyramid principle); executive summary under 150 words; one idea per section; numbered steps for procedures |
| Charts inside documents | Labelled axes with units; direct labels over legends; colour never the only encoding; data summary in text; bars start at zero |
| Marketing email (if time allows) | One primary action; subject under 50 characters; preheader; single-column, 600px content width; text that works with images off |
| Data files | One header row; one record per row; ISO dates; currency in its own column; no merged cells |
| All documents | WCAG 2.2 AA contrast; body measure of 45 to 75 characters; A4 and US Letter |

## 4. Scope by lane

Each lane gets its guide, the templates listed, a renderer, the exports in `formats.json`, versions, and an eval set. Update `formats.json` from "planned" to "built" as exports land; keep generating it from code.

1. **Chat reply.** Answer-first text grounded in store fixtures. Numbers quoted in a reply must match the fixtures exactly. "Share this" turns the reply into a composed document.
2. **File.** Raw data exports (orders, products, customers) as Excel, CSV, JSON and PDF, using `tokens.json` where styling applies. Changes to an uploaded CSV or Excel file, keeping its structure.
3. **Strict document.** The model fills typed fields only; Missing states beside fields; integer money; exact totals; PDF and Word. Priority order, so the most important land first: quote, purchase order, receipt (invoice already exists), then credit note, packing slip and returns policy if time allows.
4. **Composed document.** The model returns a block plan as JSON using the craft block types. Recipes, not fixed schemas. Priority order: sales report, campaign plan, product spec sheet (brief already exists), then product descriptions set and SOP if time allows. PDF, Word and Markdown.
5. **If time allows, end of Session 1: message card and inline chart.** Message card: customer reply, supplier email, campaign email; copy action, "open in mail"; no real sending. Inline chart: line and bar from store fixtures; PNG and CSV export.
6. **Format not supported.** A card that says what cannot be made in the named format and offers the closest formats from `formats.json` as buttons.

Every strict and composed document has versions: a follow-up changes or exports the existing one, changing only what was asked, and the history is visible.

## 5. Architecture rules

- One lane registry: each lane declares its router id, guide, templates, renderer, exporters and eval set. Lanes added in a later build loop must slot in through the registry.
- The model returns structured JSON for every lane except chat replies. Validate every response against a schema. On a validation error, retry once with the error; if it fails again, show an honest error and keep any earlier version.
- The model reads the guide for the chosen lane before it writes, and `formats.json` is loaded for real.
- One brand profile per fictional store, applied to every lane. Missing assets use the existing neutral fallback.
- Store data comes only from fictional fixtures: two stores (one INR, one USD), at least 60 products, 500 orders over 12 months, 200 customers, labelled as sample data.
- The API key stays server-side, from the environment variable the harness uses.
- Words on screen follow the concept map: document, version, file. Progress labels say what is being made ("Making your quote"), never system words.
- Reuse the craft engine; do not fork or weaken it. Its existing tests keep passing.
- Any new dependency must be free, suitably licensed and maintained. Record each in decisions.md.

## 6. Sessions

Run one session per Claude Code conversation. Each session ends by updating `docs/progress.md` with what was done, what is next, open problems and money spent, then committing and pushing. The next session starts only from the repo, never from memory of an earlier conversation.

| Session | Target day | Work | Ends with |
| --- | --- | --- | --- |
| 0. Verify | Handoff morning | Confirm Phase 1 (below); build fixtures, lane registry, spend tracking, `/output-verify` shell with "coming later" states | Phase 1 results shown to the designer, approved from the mobile app |
| 1. Chat and File | Sun 18 to Mon 19 Oct | Chat reply lane; File lane with exports and uploaded-file changes; format-not-supported card; then message card and inline chart if time allows | Gallery of chat and file results |
| 2. Strict documents | Tue 20 Oct | AI filling for invoice, quote, purchase order, receipt; Missing states; versions; exports | Gallery of strict documents |
| 3. Composed documents | Wed 21 Oct | Block plans for sales report, campaign plan, spec sheet; editing by follow-up; exports | **Stop for the designer's review (section 8)** |
| 4. Fix and verify | Thu 22 Oct | Fix what the designer flagged; final end-to-end run; held-out run if present; demo script | Final report (section 10) |

Friday 23 October is the demo, with no build work planned. If a session overruns, cut the "if time allows" lanes and templates first, never the checks. If the designer has not approved Phase 1 by the end of Session 0, wait; do not start Session 1.

### Session 0: confirm Phase 1 first

Before building anything, rerun the routing harness three times on prompt v4 against all 34 requests and show the designer `evals/results/latest.md` with the raw per-request table, not a summary. Earlier reports of 34 of 34 were Claude Code's own summary; the designer confirms them from the results file. If any run is below 34, stop and report before building.

## 7. The loop inside each session

For every step in the session:

1. **Plan** the step in a few lines in progress.md.
2. **Build** it.
3. **Check:** typecheck, lint, tests, build. Known failure `theme.test.tsx` excepted.
4. **Look:** render real outputs and inspect them as images at 390px and 1280px, and every exported page. Extraction is not inspection.
5. **Critique** each output against `evals/rubric.md` and the template's "Based on" standard. Fix the template or guide, never a one-off output.
6. **Retry** up to three fix rounds if a check fails.
7. **Save:** commit and push to `feat/output-system-build`; update progress.md.

Keep `/output-verify/gallery` current: the best example of every template, with committed screenshots, plus the two weakest results, so problems are visible rather than hidden.

## 8. Gates

Write `evals/rubric.md` in Session 0: hierarchy, brand fit, readability, correctness of facts and numbers, fit to its standard, phone legibility, each scored 1 to 5.

**A passing score is not approval.** **Claude's own rubric scores are advisory only.** Self-scores run high, so they never pass a gate alone. They are reported beside each gallery item to help the designer review.

Automatic checks that must pass (these are objective, so Claude can enforce them):
- Routing stays at 34 of 34 on every run.
- Every number in a strict document, composed document or chat reply matches the fixtures exactly.
- No invented facts: every required field is either filled from a source or marked Missing.
- Edits change only what was asked; exports target the selected version.
- Files open, with correct type and structure.
- Typecheck, lint, tests and build pass.

Designer gates (Claude stops and waits):
- **End of Session 3:** stop and show the gallery for all four lanes. Do not start Session 4 until the designer replies with what to fix.
- **End of Session 4:** the final report is reviewed before the demo.

Do not start later phases on your own pass. Design, dashboard and published page wait for a separate build loop that the designer starts.

Held-out set: if `evals/heldout.jsonl` exists in Session 4, run it three times against the final prompt and report it separately. Never edit it or tune against it.

## 9. Spend limit

Track model cost for every call using the usage and cost data OpenRouter returns, and write a running total to progress.md.

- **Per-session limit: US$20.** **Whole build limit: US$75.** The designer can change these numbers in this file.
- At 80% of either limit, warn in progress.md and prefer cheaper work (smaller eval batches, reusing cached outputs).
- At 100%, stop immediately, commit, and report spending by lane and by eval.
- Cache model responses by request, prompt version and guide version, so unchanged evals are not paid for twice.
- Run full three-run evals only at session ends; use single runs while iterating.

## 10. When to stop and ask

Stop only when:
- a secret or credential is needed that you do not have;
- a change would touch production routes, auth or deployment;
- a check still fails after three fix rounds;
- a spend limit is reached;
- a designer gate is reached;
- a product choice has no safe default.

For every other product choice, pick the simplest safe option, record it in decisions.md marked "assumed", and continue. Leave D-71 free for S1; number after the last decision on the branch.

## 11. Final report (Session 4)

- What works, lane by lane, with gallery screenshots.
- Automatic check results with evidence; Claude's rubric scores, marked advisory.
- Every "assumed" decision, grouped by lane, for the designer to review first.
- Money spent by session and in total.
- Known gaps, anything unverified, and the later-build-loop list (design, dashboard, published page, plus message card and chart if they were not built).
- A five-minute demo script for Friday.

Then stop. The gallery and this report are the handoff; the designer's review decides what happens next.
- Exact steps to run `/output-verify` on a Mac, written for a non-engineer, including where to put the API key.
