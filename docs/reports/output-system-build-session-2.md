# Output system build loop: Session 2 (Strict documents)

**Date:** 2026-10-17
**Branch:** `feat/output-system-build`
**Decisions:** D-87 to D-94. D-87 is approved; the others are marked **assumed** for the designer to review.
**Next:** Session 3, composed documents. It ends at the first designer gate.

**Run it:** `OUTPUT_BUILD_SESSION=2 npx next dev --webpack -p 4011` in `~/craft-output`, then open http://localhost:4011/output-verify. The gallery is at `/output-verify/gallery`.

## What works

On `/output-verify`, the four strict documents can be made, changed and exported:

| Kind | Made from | What stays Missing until the person says |
|---|---|---|
| **Invoice** | An order ("Invoice for order FH-01500"), catalogue products, or the person's own lines | Number, billing address, payment terms. The due date stays Missing until given ("due in 14 days" sets it). |
| **Quote** | Catalogue products at the store's price, or lines in the person's words (wholesale) | Number, valid until |
| **Purchase order** | Catalogue products, with the cost only if the person states it (never the selling price) | Number, supplier address, the supplier's price, tax and discount |
| **Receipt** | An order, found by its number or by the customer's name | Number. A receipt from an order is otherwise complete: the date paid is the order date. |

- **Store facts are copied, never typed** (D-89). This covers:
  - the store's name, address, currency and tax rate, and today's date
  - for an order: the customer, lines, discount, tax and shipping

  The model only names the order or the SKUs. Everything else must quote the person, through the engine's existing gate.
- **Missing facts** show in place with the Missing style. The document stays a Draft until every required fact is there, then shows "Ready to send". Nothing is invented: no document numbers, addresses or prices.
- **Follow-ups make versions.** "Valid for 30 days, and number it Q-2041" makes version 2 and changes only those two fields. Earlier versions fold away in the thread and can still be opened and exported.
- **Exports:** PDF and Word, of the version asked for. "Make it a PDF" exports the current version, and "Export version 1 as a Word file" exports version 1. Asking for Excel gets the format card with PDF and Word.
- **Page size:** A4 for Saffron Loom (INR) and US Letter for Fernhill (USD).
- **Not built yet:** a returns policy and other documents with exact terms show "coming later" (D-93).

**Progress labels:** "Making your quote" (and invoice, purchase order, receipt), "Changing your quote", "Exporting your quote". These are in addition to Session 1's.

## Automatic checks

| Set | Result | Results file |
|---|---|---|
| **Strict documents, gate** (13 conversations × 3 runs, no cache) | **39 of 39** | `evals/results/2026-10-17T15-13-49-strict.md` |
| Routing check, prompt version 4 (34 × 1) | 34 of 34 | `evals/results/2026-10-17T14-59-22-s2-verify.md` |
| Routing through the app's real loop (34 × 1) | 32 of 34 | `evals/results/2026-10-17T15-20-46-app-routing.md` |
| Chat, single run (regression) | 8 of 8 | `evals/results/2026-10-17T15-14-52-chat.md` |
| Chart, single run (regression) | 4 of 4 | `evals/results/2026-10-17T15-15-24-chart.md` |
| File, single run (regression) | 10 of 10 | `evals/results/2026-10-17T15-16-15-file.md` |

**What the strict set checks, on every turn:**
- **The right thing was made:** the document kind, an export, the format card, coming later, or a chat answer.
- **The guide was read** before a new document was made.
- **Every value has a source:** copied from the store, or quoting the person.
- **Store values match the store exactly:**
  - catalogue titles and prices
  - order lines
  - a document from an order totals exactly what the order did
  - a purchase order never carries a selling price
- **What should stay Missing stays Missing.**
- **Follow-ups:** only the asked-for fields change. Existing lines are unchanged, and the previous version is kept unchanged.
- **Exports:** an export is of the version asked for, and in the format asked for. Every version renders as a PDF and a Word file that open.

**The 13 conversations:**

| Id | Case |
|---|---|
| s01 | Quote from the catalogue |
| s02 | INR quote with a stated number and validity |
| s03 | Purchase order with a stated cost |
| s04 | Purchase order with no cost |
| s05 | Receipt from an order |
| s06 | Receipt found by the customer's name |
| s07 | Invoice from an order with a due date |
| s08 | A cancelled order, answered in chat |
| s09 | Quote → change → "make it a PDF" |
| s10 | Invoice → add a line → export version 1 as Word |
| s11 | Excel asked for, so the format card |
| s12 | Returns policy, coming later |
| s13 | Wholesale quote with the price Missing |

**Caught in review and fixed:**
- **The `/document-chat` generator.** Widening the generator's list of kinds would have let `/document-chat` and the agent CLI accept a quote they can't make. They would have saved an invoice, or failed with a retry error. The list is back to invoices only, and a test checks it.
- **The lane registry** now lists the new templates and each lane's eval set.
- **`/document-verify`** was checked at 390 and 1280 px after the engine change. The fixture invoices render as before.

**Tests:**
- `strict.test.ts` makes a receipt and an invoice from every order that wasn't cancelled (about 950) and checks each total equals the order's to the cent.
- The loop tests cover making, changing, exporting, the one retry, and the "other" type.
- 1,597 tests pass, and the document engine's 299 tests are unchanged. The only failure is the known `src/lib/theme.test.tsx`.
- Typecheck, lint and build are clean.

**Misses in the app routing run:**
- **r25** (product descriptions): a composed document. Known since Session 1; it belongs to Session 3.
- **r27** ("move the email send to Thursday…"): its made-up history says a campaign plan version 1 exists. Composed documents don't exist in the app yet, so the model said it couldn't edit it. It was right on one rerun and wrong on the full run. In the real app that earlier turn would have been a "coming later" card. Session 3 gives composed documents versions, which resolves it.
- **r10** (wholesale quote) missed on the first full run. The model asked in chat instead of making the quote, and that led to a guide fix (D-92). It was right on the rerun and on the full run, and s13 now checks it.

**The regression runs are single runs, not gates.** Session 1's gates (three runs each) were not repeated. The tool list every turn sees has changed, so I ran each set once to check that nothing regressed.

## Looked at, not just checked

Screenshots are in `docs/output-system/gallery/screens/`: the gallery at 390 and 1280 px, plus `session-2/`.

**Checked by eye:**
- **The quote,** at 1280 and 390 px, version 1 and version 2, and its exported US Letter PDF, page 1.
- **The receipt for SL-01481,** at 1280 px, and its A4 PDF. The total of ₹1,336.95 is the order's, with a 10% discount, 5% tax and ₹99 shipping. The Word file's text was also read.
- **The purchase order,** at 390 px. The ₹650 cost is from the request; the supplier's address, discount and tax are Missing, and the total says it isn't final.
- **The invoice, its change, and the version 1 export,** at 1280 px. Version history is visible.
- **No sideways scroll** at either width anywhere.

**For the designer.** None of these is fixed, because each is either settled design or your call:
1. **On a phone the page preview is scaled to the screen,** so its text is about 5 px. This is the existing `/document-chat` card, reused rather than redesigned; the downloads are the readable form.
2. **A three-line invoice runs to two US Letter pages,** with page 1 half empty (Fernhill, version 2 of s10). The approved layout keeps the last two lines with the totals. A tighter top section, or a different rule for short tables, is a design decision.
3. **The "No logo supplied" box** shows on every document (Session 1's open question).
4. **Billing address is always Missing on an invoice for a store order.** The sample data holds only each customer's city and country, and a partial address isn't shown as if it were complete.
5. **Payment terms:** "due in 14 days" set the due date, but the payment terms stayed Missing (s07). Filling the terms from the same words is a small guide change if you want it.
6. **While a document is being changed,** the progress label can briefly say "Making your document": the model re-reads the guide before changing it.

## Gallery and advisory scores

`/output-verify/gallery` now shows the best invoice, quote, purchase order and receipt from the gate run, as rendered pages, next to Session 1's kinds.
- **Scores** are in `gallery/scores.json`. They are Claude's own and advisory.
- **Every strict document** scores 4 for brand fit (the logo box) and 3 for phone legibility (the scaled preview). That makes them the two weakest results now, which is accurate.
- **s07** scores 4 on its standard (payment terms), and **s10** scores 4 on readability (the two-page invoice).

## New user-facing text, for approval

**In the conversation:**
- "Here is your {invoice | quote | purchase order | receipt}."
- "Version {n}: {what changed}." The change summary is the engine's own, for example "Set Quote number and set Valid until" or "Added line 3".
- The question Souvenir asks about the most important missing fact. The model writes this, and it is checked for system words.
- **Export card:**
  - "{Quote Q-2041}, version {n}" and "{PDF | Word}"
  - "Download {PDF | Word}" and "Making the file…"
  - "{Format} download failed: {reason}"
- **Progress labels:** "Making your {kind}", "Changing your {kind}", "Exporting your {kind}".

**The document card, reused from `/document-chat`:** "Ready to send", "Draft · {n} missing", "Not provided yet", "Show v{n}" / "Hide v{n}", "Download PDF", "Download Word".

**On the documents:**
- **Titles:** "Quote", "Purchase order", "Receipt".
- **Details headings:** "Quote details", "Order details", "Payment details".
- **Field labels:**
  - Quote: "Quote for", "Address", "Quote number", "Quote date", "Valid until", "Terms"
  - Purchase order: "Supplier", "Supplier address", "PO number", "Order date", "Deliver by"
  - Receipt: "Received from", "Receipt number", "Date paid", "Paid by"
  - Any kind: "Order", "Shipping"
- **Totals:** "Total" for a quote, "Order total" for a purchase order, "Total paid" for a receipt.
- **Footer** while the number is missing: "{Quote | Purchase order | Receipt} (number missing)".

**Engine messages, now naming the kind:**
- "Line priced in {currency}, {kind} is in {currency}."
- "A tax rate is supplied, but the {kind} is marked tax-exempt."
- "A discount rate is supplied, but the {kind} is marked as having no discount."
- "{Due label} is before the {issue label}." Example: "Valid until is before the quote date."
- "Quotes, purchase orders and receipts have no slide format."

**Errors:** none new. A refused document uses Session 1's "Souvenir couldn't put this together correctly. Nothing was changed. Try asking again."

## Spend

| | US$ |
|---|---|
| Routing through the app's real loop (two full runs and reruns of r10 and r27; the first full run, before prompt caching, cost 5.80) | 7.15 |
| Strict evals, iterating and the gate | 4.15 |
| Manual checks in the app | 0.75 |
| Routing check | 0.37 |
| Chat, chart and file single runs | 0.69 |
| **Session 2** | **13.11 of 20 (66%)** |
| Build total, from the ledger | 29.88 of 75 |

The rows are the ledger's totals by purpose. Prompt caching (D-94) cut the cost of a repeated call by about 85%, and the gate run cost about US$2.20 for 39 conversations.

## Open items

- **Session 3** needs product data for spec sheets. `find_products` now exists, which also gives r25 what it was missing.
- **The designer items above,** 1 to 6.
- **Credit note, packing slip and returns policy** ("if time allows") are not built. They show "coming later".
- **Message card** is still not built.
