# Output system build loop: Session 1 (Chat and File)

**Date:** 2026-10-17
**Branch:** `feat/output-system-build`
**Decisions:** D-80 to D-86, all marked **assumed** for the designer to review.
**Next:** Session 2, strict documents.

**Run it:** `npx next dev --webpack -p 4011` in `~/craft-output`, then open http://localhost:4011/output-verify. The gallery is at `/output-verify/gallery`.

## What works

| Kind | What a person can do on `/output-verify` |
|---|---|
| **Chat reply** | Ask about either sample store, such as sales for a period, top products, low stock, average order value or refunds, and get an answer-first reply. Every store number is checked against the sample data before it is shown. Advice and copy questions work too. |
| **File** | Get orders, products or customers as Excel, CSV, JSON or PDF, for any period or status, or just the low-stock products. Attach a CSV or Excel file and ask for changes: prices up 5% to .99, duplicates removed, names in title case. It comes back in the same format, with the same structure. |
| **Inline chart** (built early, D-86) | Weekly or monthly sales, or top products, as a bar or line chart with a lead sentence. Downloads as PNG or CSV. |
| **Format not supported** | Ask for something in a format it can't be made in, such as orders as Word, and get a card with the closest formats as buttons. Only formats that are built are clickable. |
| **Coming later** | Strict and composed documents, message cards, designs, dashboards and pages show an honest "coming later" card that says what would have been made. |

**Progress labels while it works:** "Checking your store data", "Making your file", "Writing your answer", "Making your chart".

## Automatic checks

Gate runs: three runs per request, no cache. These are the final runs after the last fixes.

| Set | Result | Results file |
|---|---|---|
| Chat (8 requests × 3) | **23 of 24** | `evals/results/2026-10-17T11-27-40-chat.md` |
| Chart (4 × 3) | **12 of 12** | `evals/results/2026-10-17T11-29-12-chart.md` |
| File (10 × 3) | **30 of 30** | `evals/results/2026-10-17T11-32-08-file.md` |
| Routing through the app's real loop (34 × 1) | **33 of 34** | `evals/results/2026-10-17T11-37-12-app-routing.md` |
| Routing check, prompt version 4 (Session 0) | 34 of 34, three runs | `evals/results/2026-10-17T10-26-17-s0-verify3.md` |

**What was checked:**
- **Chat:** the right kind was made, the guide was read, every store number matches the sample data, there are no system words, and the store was asked when a question needs store data.
- **Files:**
  - the right format and dataset, with a row count equal to what the sample store holds for that request
  - the file opens and reads back, with one header row, ISO dates and currency in its own column
  - uploads keep their format, columns, column order and sheet name, with the right row count after the change, and every price ends in .99, within 5% of the original
- **Charts:** the lead's numbers match the chart; the title is in words; at most 12 bars or 24 points.

**Misses:**
- **c01** "How did sales go last month?", Fernhill, run 2 of 3. It made a chart with a lead sentence instead of a chat reply. The chart was correct. But for this request the eval expects a chat reply, which I wrote before the chart existed, so it counts as a miss (D-86).
- **r25** "Write descriptions for these 20 products: …", app routing. The model asked the store, found no product list (there is no catalog question), and answered in chat instead of making a document. The fix belongs to Session 3, which needs product data for spec sheets anyway: add a product-catalog question to the store.

**Checks:**
- Typecheck, lint and build are clean.
- Every test passes except the known `src/lib/theme.test.tsx`. The output-system tests are in `src/lib/output-system/**` and `src/app/output-verify/**`.

## Looked at, not just checked

Screenshots are in `docs/output-system/gallery/screens/`: the page and gallery at 390 and 1280 px, plus `session-1/` for individual results.

**Fixed after looking:**
1. **Reply bullets:** list items in replies showed no bullets; a global reset was hiding them.
2. **Bullets after a lead line:** a list directly after a lead line rendered as "- **text**". The renderer now splits mixed blocks.
3. **Tiny chart text on phones:** chart text shrank to about 6 px at 390 px. Charts are now drawn at their container's real width.
4. **Chart widened the page:** charts made the conversation wider than a phone screen (243 px of sideways scroll), because a grid track grew to fit the chart. Fixed with `minmax(0, 1fr)` tracks.
5. **Weekly chart at 390 px:**
   - every-other-bar labels left the peak unlabelled, and the last label was clipped. Bars now use short values ("$3.03K") so every bar gets one.
   - date labels ran together. Dates are now labelled every other bar and aligned at the edges.
6. **Top-products chart:** product names were cut short ("Travel mug, Charc…"). On a phone each name now sits above its bar.
7. **Line chart:** labels on every point crowded the line. Only the first, last, highest and lowest points are labelled now.
8. **Lower-case channels:** order channels were lower-case in exports ("online store") and are now "Online store".
9. **"Today" caveat:** a reply warned that September "could still change before the month closes". The context now says the sample data is complete through today.
10. **Month comparisons:** "last month" was compared with the 30 days before it (Aug 2–31). It is now compared with the previous calendar month.

**Checked by eye:**
- **The orders PDF** (`gallery/files/f04-…pdf`, 5 A4 pages): letterhead, title, meta row, a table header repeated on every page, and page numbers. Page 1 is in `session-1/f04-pdf-page-1.png`.
- **The Excel files,** checked in Quick Look: bold header, real dates, numbers right-aligned.

## Gallery and advisory scores

`/output-verify/gallery` shows the best example of each template, then the two weakest results. Scores are in `docs/output-system/gallery/scores.json`. They are Claude's own and advisory: self-scores run high, so they pass nothing.

**The weakest results, with the reason:**
- **c03 (low stock), 4.7:** it offers to draft a purchase order, which the prototype can't make yet. Replies should offer only what can be made.
- **c07 (product title), 4.7:** generic copy ("Breathable & Easy to Wear").
- **c08 (return window), 4.7:** long for chat, and its advice isn't checked against a source.
- **f04 (orders PDF), 4.7:**
  - The letterhead shows a dashed "No logo supplied" box, because the sample stores have no logo files. That's honest, but it looks unfinished in a demo.
  - The table has no total row.

## New user-facing text, for approval

All of this is on `/output-verify` and the gallery.

**Request area:**
- Store picker: the legend "Store" and the options "{store} ({currency})"
- Placeholders: "For example: Export last month’s orders as Excel." and "For example: What were my top 3 products over the last 12 months?"
- "Attach a CSV or Excel file", "Attached: {file} ({n} rows)", "Remove", "Send"
- Under the box: "Sample data runs to 30 Sept 2026, so “last month” means September 2026. {store} uses {currency}."

**Progress labels:** "Working on it…", "Checking your store data…", "Writing your answer…", "Making your file…", "Making your chart…", "Making your document…", "Checking which formats work…"

**Cards:**
- File card: "{format} · {n} rows · {size}" and "Download"
- Chart: "Download PNG", "Download CSV", and the source line "Source: {store} fulfilled orders, {range}. Sample data."
- Format card: "{format} isn’t available for this", and a disabled button "{format} · Coming later"
- Coming-later card: "{kind}: coming later", "Souvenir would make this: {summary} This kind isn’t ready in the prototype yet.", and "Exports of made things: coming later"

**Upload change summaries:**
- "Raised {n} values in “{column}” by {p}%." and "Lowered {n} values in “{column}” by {p}%."
- "Removed {n} duplicate rows by “{column}”, keeping the first of each."
- "Changed “{column}” to title case." (also upper or lower case)
- "Trimmed spaces in “{column}”." and "Trimmed spaces in every column."

**Errors:**
- "Souvenir didn’t answer. Try asking again."
- "Souvenir’s answer had numbers that don’t match your store data, so it wasn’t shown. Try asking again."
- "Souvenir’s answer used words meant for its own workings, so it wasn’t shown. Try asking again."
- "Souvenir’s chart came with numbers that don’t match your store data, so it wasn’t shown. Try asking again."
- "Souvenir couldn’t put this together correctly. Nothing was changed. Try asking again."
- "This took too many steps, so Souvenir stopped. Try asking in a simpler way."
- "Souvenir couldn’t reach the model just now. Try again in a moment."
- "The spending limit for this build has been reached, so Souvenir stopped."
- "No model key is set up, so Souvenir can’t make anything yet."
- "This request is too large."
- "This request isn’t in the expected shape."
- "The file couldn’t be made from this request. Try asking again."
- Upload errors: "Upload a CSV or Excel (.xlsx) file.", "This CSV file is empty.", "This Excel file has no rows.", "This file isn’t an Excel workbook.", "There is no column called “{name}” in {file}.", "That file couldn’t be read. Upload a CSV or Excel (.xlsx) file."

**Gallery:**
- "The best example of each kind, then the two weakest results. Scores are Claude’s own and advisory; the designer’s review decides."
- "Best of each kind", "Two weakest results", "Weak"
- "Advisory score {x} of 5 · automatic checks {all passed|failed}"

**PDF data export:** "{n} rows. Amounts in {currency}. Sample data from a fictional store."

## Spend

| | US$ |
|---|---|
| Chat evals | 6.47 |
| File evals | 4.23 |
| Chart evals | 2.02 |
| App routing check | 2.84 |
| Manual checks in the app | 0.09 |
| **Session 1** | **15.66 of 20 (78%)** |
| Build total, from the ledger | 16.77 of 75 |

Most of the cost was repeating gate runs after fixes: the chat set ran four times in full. Next session, I'll iterate on single runs with the cache, and run the three-run gate only once per set at the end.

## Open items

- **Product-catalog store question.** Needed in Session 3, and it would fix r25.
- **Offers in replies.** Replies sometimes offer things that aren't built yet (c03: "draft a purchase order"). Options: tell the model which kinds are built in the context block, or accept this until strict documents land in Session 2.
- **A logo for each sample store**, so the PDF letterhead doesn't show the "No logo supplied" box in the demo. That's the designer's call: a fictional mark, or keep the honest fallback.
- **A total row for data-export PDFs.**
- **Message card** ("if time allows") is not built, and stays "Coming later".
