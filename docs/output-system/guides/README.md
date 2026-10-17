# Guides

One guide for each kind of thing Souvenir makes. Souvenir reads the matching guide before it makes anything, and follows it over its own habits. Designers own these files: edit them in plain language, then re-run the routing check (`npx vite-node scripts/output-system/route-eval.ts`) and the tests (`npx vitest run src/lib/output-system`).

| Guide | What it makes |
|---|---|
| [Chat reply](chat-reply.md) | Answers, explanations, short copy |
| [Message card](message-card.md) | Something to send to a particular person or list: an email, a customer reply, a text |
| [Inline chart](inline-chart.md) | A quick look at numbers, inside the conversation |
| [Strict document](strict-document.md) | Money, legal or required facts: invoice, quote, purchase order, policy |
| [Composed document](composed-document.md) | Writing to keep or share: plan, report, brief, spec sheet |
| [Design](design.md) | Things judged by looking: ad, social post, product page mockup, slides |
| [Dashboard](dashboard.md) | Numbers checked again and again |
| [Published page](published-page.md) | Things people interact with: calculator, size guide, quiz |
| [File](file.md) | Raw data exports (orders as Excel, products as CSV) and changes to files the person uploaded |

**Every guide has the same sections:** purpose, when it applies, layout rules, tone, two worked examples and common mistakes. A test checks that each section is there.

**Words.** Guides use the concept map's words: *document*, *version*, *file*, *Missing*. Every line here can end up in front of the person, so a test fails if a guide uses a word that describes Souvenir's insides, or a name the concept map rejected. The full lists are in `src/lib/output-system/words.ts`. Say "Souvenir", not the name of a machine part. Say "version", never another word for it. Use "draft" only as a verb ("draft the email") or a status ("Draft"), never as the name of the thing made.

**Formats.** [formats.json](../formats.json) lists which formats each kind of thing can be exported to, closest first. It is generated from the document engine's export table. Kinds with no code yet are marked planned. Guides point to it instead of listing formats themselves.

**Look.** Sizes and colours come from [tokens.json](../tokens.json), which is read from the document engine. Guides refer to tokens by name ("body text", "neutral ink"). They don't restate numbers, so a guide can't drift from what is rendered. Font families are placeholders until the final pick, so guides name the four type roles instead:
- **voice** is for reading text
- **display** is for titles
- **function** is for labels and tables
- **money** is for figures
