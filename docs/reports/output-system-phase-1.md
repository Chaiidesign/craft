# Output system, Phase 1: Foundations

**Date:** 2026-10-17
**Branch:** `feat/output-system-foundations`, stacked on `feat/chat-document-flow` at `c7dcd12f` (D-68).
**Status:** the Phase 1 baseline is below. The router change (D-72) and its re-run are in the last section, "After the router change".
**Plan:** [../output-system/plan.md](../output-system/plan.md).
**Decisions:** D-68 to D-70 in [../decisions.md](../decisions.md), all proposed.

## What was built

| File | What it is |
|---|---|
| `docs/output-system/plan.md` | The plan, copied unchanged from Chaitanya's document |
| `docs/output-system/system-prompt.md` | The draft prompt from the plan, word for word, with an editor's comment at the top (stripped before sending) |
| `docs/output-system/tokens.json` | Colours, type, spacing, page, table, chart and slide values, generated from the document engine (D-69) |
| `docs/output-system/guides/*.md` | A README, plus one guide per lane, nine in all. Each has purpose, when it applies, layout rules, tone, two worked examples and common mistakes. |
| `docs/output-system/evals/requests.jsonl` | 30 e-commerce requests with their expected lanes: every lane covered, 8 ambiguous, 3 with earlier turns |
| `docs/output-system/evals/results/` | The three baseline runs (`.md` table and `.json` replies), plus `latest.md` |
| `scripts/output-system/route-eval.ts` | The routing harness |
| `scripts/output-system/build-tokens.ts` | Regenerates `tokens.json` |
| `src/lib/output-system/` | Supporting code for the harness and the tests:<br>• `lanes.ts`: lane and action names<br>• `evals.ts`: parsing, coverage and scoring<br>• `tokens.ts`: builds `tokens.json`<br>• `words.ts`: the forbidden-words check<br>• `output-system.test.ts`: 29 tests |

**Not changed:**
- production routes or auth
- the document engine (`src/lib/documents/` is untouched; tokens are only read from it)

**No user interface was added,** so there was nothing to check in a browser. The "Souvenir says" lines in the guides are examples for designers to edit. They are not text that ships.

## Harness results

**Setup:**
- Model: OpenRouter, requested `anthropic/claude-opus-5.5`, and the replies came from `anthropic/claude-opus-5.5`.
- Effort medium.
- Prompt hash `747c90cba9da`, test instruction `b53ddac96b33`.
- Three runs of the same 30 requests, all with the unchanged draft prompt.

| Run | Right | Misses |
|---|---|---|
| `2026-10-17T07-26-28-baseline` | **30 / 30** | none |
| `2026-10-17T07-27-00-baseline-repeat` | **29 / 30** | r29 |
| `2026-10-17T07-27-33-baseline-run3` | **29 / 30** | r29 |

**Gate (at least 27 of 30): passed in every run.**

### The one miss: r29, which missed in 2 of 3 runs

- **Context:**
  1. The person asked for five ways to cut the return rate.
  2. Souvenir answered in chat.
  3. Then the person said: **"Share this with my team."**
- **Expected:** composed document. The plan's upgrade rule says "share this" about a chat reply turns it into a composed document.
- **Chosen:** message card.
- **The model's reason:** "Sharing the chat answer with the team is a message for other people, and messages come at step 3, before documents at step 6."

The model followed the prompt correctly. The upgrade rule is in the plan, but **not in the draft prompt**, so step 3 catches the request first.

### How much to trust 30/30

**The run is weaker evidence than the score suggests.** Several requests echo the prompt's own examples, so they test recall of the prompt rather than judgment:
- r26 ("a report for Monday's meeting") is the prompt's example of an open format.
- r30 ("size guide") and r22 ("quiz") are named in step 8.
- The model's reasons quote the prompt back. For r30: "rule 8 names size guides".

A held-out set would test judgment rather than recall. It should be written by someone who hasn't read the prompt, worded the way store owners actually talk, and include messier requests.

## Router conflicts in the plan, which the eval set does not resolve

The expected lanes follow the router as written (D-68). Two places in the plan disagree with it.

1. **Step 2 (named format) against step 4 (strict document).**
   - "Purchase order to Packwell … as a PDF" (r11) goes to File, and the model did that every time.
   - But a strict document is where exact totals and Missing states are guaranteed.
   - Routed to File, a purchase order goes back to being written from scratch: the inconsistent look and loose facts that the baseline run found.
2. **Step 2 against the upgrade rule.**
   - The plan says "make it a PDF" exports the current version.
   - The router sends it to File (r28).
   - The model picked File and said it would export the existing invoice, which is the right behaviour. But it's the right behaviour only because of the model's own judgment; the prompt never says it.

## Guide rules that settle open questions (proposals, for review)

Some guide rules decide things the plan or the concept map still leaves open. They are written as rules so the guides read cleanly, but treat each one as a proposal.

| Guide rule | Open question it settles |
|---|---|
| A design "opens in an editor" (design guide) | The plan asks whether people can edit directly or only through chat. |
| The store's brand provides logo, colours and fonts (every guide) | The plan asks where brand comes from: the Shopify theme, an upload, or manual setup. |
| Dashboards read live store data (dashboard guide) | The plan asks which store data Souvenir can read. |
| Status is **Draft** until every required fact is there, then **Ready** (strict, design and file guides) | Concept map, Round 1: still unanswered. |
| Page size is "A4 or US Letter from the store's country" (strict and composed guides) | **Not in the plan or the engine.** The baseline run used US Letter every time. I made this rule up; it needs a decision. |
| Phone checks at 320 px and 44 px tap targets (published-page guide) | Taken from the S1 screenshot widths (1280, 390, 320) and common touch-target guidance, not from the plan. |

## What I would change to fix the miss and the conflicts

These are proposals only, not applied (D-68).

**In the prompt:**

1. **Add the upgrade rule** (fixes r29). Insert after step 1:
   > "If the person wants to share, keep or send on something you made in this conversation, build on it rather than starting again: a chat reply they want to share becomes a document; 'make it a PDF' or another format exports the current version of what you made."
2. **Narrow step 3** to messages written to a named recipient:
   > "a message they will send to a particular person or list: a customer, a supplier, their email list."

   That way "share this with my team" doesn't read as a message request.
3. **Make a named format decide how the result is delivered, not what kind of thing it is.** Replace step 2 with:
   > "If the person named a file format, decide what to make with the questions below, then deliver it as that file. Use build_file directly only for data exports or when nothing below fits."

   This resolves both conflicts: the purchase order stays a strict document and arrives as a PDF. **It changes the plan's order, so it's Chaitanya's call.** The eval set would change with it: r11 becomes `strict_document`, and r28 needs an `export` outcome.
4. **Change "tools" in the first line** ("…dashboards, tools and files") to "calculators and other interactive pages". "Tool" is a system word, and the model may repeat it.

**In the guides:** no change needed for this run. Two notes:
- The strict-document guide already flags conflict 1 as open.
- The file guide already says a named format on an existing document exports its current version.

**In the eval set:**
- Add a held-out set of about 15 requests, written by someone else.
- Count a run as passing only if it scores at least 27 in each of three runs. The model's choices vary from run to run, as r29 shows.

## Open questions for Chaitanya

1. **Proposals 1 to 4:** apply them (then re-run, and report the new score separately from this baseline), or keep the plan's order?
2. **Who writes the held-out requests?** Someone at Souvenir who talks to store owners would be best.
3. **Commit and push:** to `feat/output-system-foundations` once you've seen the diff, or rebase onto `main` after S1 merges? S1's next decision should be D-71, since this branch uses D-68 to D-70.
4. **The guide rules above:** which of them stand?

## After the router change (D-72), 2026-10-17

Chaitanya updated the plan with proposals 1 to 4. `system-prompt.md` is now version 2, the updated draft word for word.

**Other changes:**
- **Expected lanes:** r11 changed to Strict document, and r28 to an export of the invoice's current version. r29 was already a composed document; only its note changed.
- **Harness:** gained the `export_existing` choice.
- **Guides:** seven updated. D-72 lists them.

These scores are reported separately from the baseline above, because the changes were made in response to the baseline's misses.

**Setup:**
- Model: OpenRouter, requested `anthropic/claude-opus-5.5`, and the replies came from `anthropic/claude-opus-5.5`.
- Effort medium.
- Prompt hash `50eb120ad63b`, test instruction `4f43caf50777`.

| Run | Right | Misses |
|---|---|---|
| `2026-10-17T08-25-57-v2-run1` | **30 / 30** | none |
| `2026-10-17T08-26-24-v2-run2` | **30 / 30** | none |
| `2026-10-17T08-26-50-v2-run3` | **30 / 30** | none |

**The changed cases, in all three runs:**
- **r11** went to a strict document: "the PDF is just how it gets delivered".
- **r28** exported the invoice's current version: "Rule 1: 'Make it a PDF' exports the current version".
- **r29** went to a composed document: "'Share this with my team' about a chat reply turns the reply into a document, not a message".
- **r23 and r24**, the raw exports, still went to File.

**Held-out set.** `evals/heldout.jsonl` doesn't exist yet, so it has not been run.

### Why 30/30 is weak evidence here

The share-this rule quotes r29's own words, "share this with my team". So r29 passing shows the model read the rule. It doesn't show the rule works for other ways of saying the same thing. The same is true, more mildly, of r11: the prompt now says "Purchase order as a PDF".

The original 30 have become a check that nothing regressed. They no longer measure how well the router works. The held-out set is the real measure.

### Proposed fixes (not applied)

There are no misses to fix. These are the gaps I would close:

1. **Word the share-this rule by meaning, not by phrase.** For example: "When the person wants to share, send on or keep something you answered in chat, turn that reply into a document. It is not a message." As written, "forward this to my partner" or "can you send this to Priya?" may still become a message card.
2. **Restore the explicit system words in "Words on screen".** Version 2 dropped "tools, sandboxes, skills". The baseline run showed "Running sandbox command" on screen, so naming them is cheap insurance. D-70's test checks the guides, not the prompt.
3. **Two new rules have no test.** The uploaded-file half of step 2 ("fix my uploaded price list") and the "say so and offer the closest format" rule have no request in either set. Add a few to `requests.jsonl` as regression cases, or make sure the held-out set covers them. Don't add them by looking at the held-out set.
4. **`export_existing` is the harness's name for router step 1's export case.** The prompt has no action for it. Engineering will need one, for example `export_version`, when the placeholders are renamed.
