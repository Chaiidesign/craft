# Souvenir output system: router, system prompt and build plan

Oct 17, 2026 · @chai.design

## Why phases, and why not copy Claude's prompt

We can build the whole output system; we should build it in five phases, because each phase needs the one before it to be testable. A single "build everything" prompt gives Claude Code too many moving parts to verify, and the craft build already showed that step-by-step work with checks and a decisions log produces trustworthy results.

Claude's own system prompt would not transfer well. It is written for Anthropic's tools: its sandbox paths, Claude Docs, its artifact publisher, its card widgets. What transfers is the pattern behind it:

- One router that asks questions in a fixed order and stops at the first match.
- One guidance file (a "skill") per output type, read before the model writes anything.
- Ready-made templates the model fills with content, so the look is guaranteed.
- Typed tools for cards (email, chart, product), so the app renders them consistently.
- A fallback that always produces something, so the assistant never says "I can't do that".

Section 4 applies that pattern to Souvenir, with its own lanes and words.

## The output lanes

Every request lands in one of nine lanes. Each lane has one way of being made, one way of being shown and one owner of its look.

| Lane | What it makes | E-commerce examples | How it's made |
| --- | --- | --- | --- |
| Chat reply | Answers, explanations, short copy | "Why did sales drop?", a product title | Plain text in chat |
| Message card | Something to send to someone | Customer reply, campaign email, SMS | Typed card with copy and send |
| Inline chart | A quick look at numbers | Sales by week, top products | Typed chart spec rendered by the app |
| Strict document | Money, legal or required facts | Invoice, wholesale quote, purchase order, returns policy | Fixed template, Missing states, exact math (craft engine) |
| Composed document | Writing to keep or share | Campaign plan, sales report, product spec sheet | Model arranges craft blocks; engine lays out and exports |
| Design | Things judged by looking | Ad creative, product page mockup, social post, deck | Template filled with content, opens in an editor |
| Dashboard | Numbers checked repeatedly | Weekly sales dashboard | Published page reading live store data |
| Published page | Interactive tools and anything else | Shipping calculator, size guide, landing page | Model writes one HTML file using design tokens; hosted at a private link |
| File | Raw data exports and uploaded files | "Export orders as Excel", "fix my uploaded price list" | Sandbox builds the file using design tokens |

The composed document lane is the bridge between today's flexible-but-inconsistent production and the strict-but-narrow craft prototype: the model decides what to say and which blocks to use, and the engine guarantees the look.

## The router

The router asks ten questions in order and stops at the first yes. A fixed order keeps behaviour predictable and stops two lanes competing for one request.

1. Is this a change to something already made? → Update it as a new version. Never make a duplicate. "Make it a PDF" exports the current version.
2. Is it a raw data export (orders as Excel, products as CSV) or a change to a file the person uploaded? → File.
3. Is it a message for a particular person or list (a customer, a supplier, subscribers)? → Message card.
4. Does it involve money, legal terms or required facts? → Strict document.
5. Will they judge it by looking (ad, mockup, social post, banner, slides)? → Design.
6. Is it writing they will keep or share? → Composed document.
7. Is it numbers? A quick look → Inline chart. Checked repeatedly → Dashboard.
8. Will they interact with it (calculator, size guide, quiz)? → Published page.
9. Can it be answered well in text? → Chat reply.
10. Nothing fits → the closest lane, else a Published page. Never refuse.

A named format decides how something is delivered, not what kind of thing it is. "Purchase order as a PDF" goes to Strict document and is exported as PDF, so it keeps the fixed layout and exact totals. The File lane covers only raw data exports and uploaded files. If a lane cannot export the named format, say so and offer the closest one.

Two more rules:

- **Ask only when the format is truly open.** "A report for Monday's meeting" could be a document or a deck, so ask once. Otherwise make the best guess and say what was made.
- **Upgrade, don't restart.** "Share this" or "share this with my team" about a chat reply turns it into a composed document. It is not a message card.

| Request | Lane |
| --- | --- |
| "Why did sales drop last week?" | Chat reply + inline chart |
| "Write descriptions for these 20 products" | Composed document (File if they say CSV) |
| "Reply to this angry customer" | Message card |
| "Instagram ad for the summer sale" | Design |
| "Quote for 500 wholesale units" | Strict document |
| "Black Friday campaign plan" | Composed document |
| "Investor pitch deck" | Design (slides) |
| "Shipping cost calculator for my site" | Published page |
| "Weekly sales dashboard" | Dashboard |
| "Export my orders as Excel" | File |

## Draft system prompt for Souvenir

This is a first draft of the product prompt, written in the concept map's words. Tool names are placeholders for engineering to rename. It goes in the repo as `docs/output-system/system-prompt.md` and is tuned through the evals in Phase 1.

```markdown
You are Souvenir, an assistant for people who run online stores. You help them understand their store and make the things they need: answers, messages, documents, designs, dashboards, calculators and other interactive pages, and files.

# Choosing what to make
Before making anything, decide what kind of thing the request needs. Ask these questions in order and stop at the first yes:
1. Is it a change to something already made in this conversation? Update that document or design as a new version. Never make a second copy. "Make it a PDF" exports the current version.
2. Is it a raw data export (orders as Excel, products as CSV) or a change to a file the person uploaded? Make that file with build_file.
3. Is it a message for a particular person or list (a customer, a supplier, subscribers)? Draft it with show_message_card.
4. Does it involve money, legal terms or facts that must be exact (invoice, quote, purchase order, policy)? Use create_strict_document with the matching template.
5. Will the person judge it by looking (ad, social post, banner, product page mockup, slides)? Use create_design with the best-fitting template.
6. Is it writing they will keep or share (plan, report, brief, guide, spec sheet)? Use create_document and arrange blocks.
7. Is it numbers? For a quick look, use show_chart. For something they will check repeatedly, use create_dashboard.
8. Will they interact with it (calculator, size guide, quiz)? Use publish_page.
9. Can it be answered well in text? Reply in chat.
10. If nothing fits, use the closest option, or publish_page. Never say you cannot make something because of its type.

A named format (PDF, Word, PowerPoint, Excel) decides how something is delivered, not what kind of thing it is. Choose the kind with the questions above, then export it in that format. If that kind cannot be exported in the named format, say so and offer the closest format.

"Share this" or "share this with my team" about a chat reply turns the reply into a document. It is not a message.

Ask one short question only when the format is truly open, for example "a report for Monday's meeting" could be a document or slides. Otherwise make your best choice and say in one line what you made.

# Before you make something
Read the guide for that kind of thing with read_guide(type). Guides hold the layout rules, tone and examples. Follow them over your own habits.

# Facts
Use store data from the connected store first, then what the person said, then source documents they shared. Never invent a fact. If a required fact is missing, leave it marked Missing in the document; do not list missing facts in your reply instead. Never treat an unknown tax, price or date as zero.

# Look
The store's brand (logo, colours, fonts) applies to everything you make. Do not choose your own colours or fonts. If the brand is not set up, use the neutral default and mention it once.

# Words on screen
Talk about documents, versions, designs and files. Never mention guides, templates or code to the person, or how things are made behind the scenes.

# Replies
Lead with the answer. Keep chat replies short. When you make something, say in one line what it is and what they can do next; do not repeat its contents in chat.
```

## What exists and what to build

Two of nine lanes work today, two are half-built in craft, and five are new. Effort is relative, not a time estimate.

| Lane | Today | What's missing | Effort |
| --- | --- | --- | --- |
| Chat reply | Works in production | Router prompt, reply rules | Small |
| File | Production sandbox writes python-docx | Design tokens and guides so the look stops changing; file cards instead of loose links | Small |
| Strict document | craft engine: invoice, model, revisions, exports | AI connection, more templates (quote, PO, receipt) | Medium |
| Composed document | craft blocks and layout engine | AI writes block plans; an in-place editor | Medium |
| Message card | Nothing | Card component and send actions | Small |
| Inline chart | Nothing | Chart spec and renderer in chat | Small |
| Published page | Nothing | Hosting at private links, token injection, safety limits | Small to medium |
| Dashboard | Nothing | Published page plus live store data | Medium |
| Design | Nothing (deck adaptation exists in craft) | Templates, canvas editor, image handling | Large |

The baseline run's problems map onto this table: loose files and inconsistent looks are fixed by the File row; missing facts in prose by the Strict and Composed rows; system words on screen by the prompt's "Words on screen" rule.

## Build plan for Claude Code

Five phases, each ending in a gate that must pass before the next starts. Each phase runs the way the craft build did: plan, numbered steps, checks, decisions log, stop before push.

1. **Foundations.** Write the router prompt, one guide per lane, the design tokens file and an eval set of 30 e-commerce requests with the expected lane for each. Build a small harness that sends each request to the model and records the lane it picks. *Gate: right lane for at least 27 of 30.*
2. **Quick wins.** Apply tokens and guides to the File lane; add the message card and inline chart. *Gate: 10 file requests produce the same brand look; cards and charts render at phone and desktop widths.*
3. **Documents with AI.** The model returns a block plan as JSON; it is checked against the craft schema, laid out by the craft engine and saved as a version. Strict templates get AI-filled fields with Missing states. *Gate: 20 requests scored on the rubric; no invented facts; edits change only what was asked.*
4. **Pages and dashboards.** The model writes one HTML file using the tokens; it is hosted at a private link. Dashboards read live store data. *Gate: pages work offline of outside scripts and pass phone checks.*
5. **Design.** Templates for ads, social posts, product page mockups and slides, filled by the model and opened in an editor. *Gate: a designer would ship 8 of 10 outputs with small edits.*

The repo layout for the design-owned files:

```
docs/output-system/
  system-prompt.md      router and global rules
  tokens.json           colours, type, spacing, radius
  guides/               one guide per lane and per template
  evals/requests.jsonl  test requests with expected lane
  evals/rubric.md       how outputs are scored
```

## Kickoff prompt for Claude Code

Paste this into Claude Code in the craft repo after saving this doc as `docs/output-system/plan.md`. It starts Phase 1 only.

```markdown
Read docs/output-system/plan.md, then CLAUDE.md, docs/workflow.md and docs/decisions.md.

We are starting Phase 1 (Foundations) of the Souvenir output system. Work only on Phase 1. Follow the same workflow as the document-quality build: verify repo, branch and remotes; print a plan and a reuse map of what already exists (especially src/lib/documents); then implement in numbered, testable steps. Record decisions in docs/decisions.md and progress in docs/progress.md. Stop before commit, push or deploy and show me the diff.

Phase 1 delivers:
1. docs/output-system/system-prompt.md, starting from the draft in plan.md section "Draft system prompt for Souvenir".
2. docs/output-system/tokens.json, derived from src/lib/documents/tokens.ts and theme.ts. Do not change those files; map from them.
3. One guide per lane in docs/output-system/guides/, each with: purpose, when it applies, layout rules, tone, two worked examples and common mistakes. Write them in plain language for a designer to edit.
4. docs/output-system/evals/requests.jsonl with 30 realistic e-commerce requests and the expected lane for each, covering every lane and at least 5 ambiguous cases.
5. A routing harness under scripts/output-system/ that sends each request plus the system prompt to the model, asks it to name the lane it would use, and writes a results table comparing chosen vs expected lane.

Rules:
- The model API key comes from an environment variable. Never commit secrets. If no key is available, build the harness and stop with a clear message.
- No changes to production routes, auth or the existing document engine.
- Guides and the prompt must use the concept map's words (document, version, file). Never put system words like skill, sandbox or tool in text a user would see.

When done, report: files created, harness results (lanes right out of 30, with each miss listed), and what you would change in the prompt or guides to fix the misses.
```

## Open questions

- [ ] Which model does the "Advanced" preset use on devapi? (Sahil)
- [ ] Does the concept map grow to cover Design, Dashboard and Published page, or do those get their own maps?
- [ ] Is brand set per store, and where does it come from (Shopify theme, an upload, manual setup)?
- [ ] Which store data can the model read in Phase 3: catalog, orders, customers?
- [ ] Can people edit documents directly, or only through chat? This decides the editor work in Phase 3.
- [ ] Who approves a gate: design, engineering, or both?
