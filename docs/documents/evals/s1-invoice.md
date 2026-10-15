# Eval set S1: invoices from a prompt

Fixed prompts for checking the real model by hand (not run in CI, which uses the scripted model). Run each through `/document-chat` or the CLI with `ANTHROPIC_API_KEY` set, and record the result per commit at the bottom.

The bar for every prompt:
- **Nothing invented.** Every value is in the prompt. The gate enforces the quote; this eval also checks the meaning is right (for example, the buyer isn't the issuer).
- **Unknowns stay unknown** and are listed under "Not provided yet".
- **The first turn always produces a document**, unless the request is for another document type.
- **The follow-up asks one useful question**, or none.
- **Attempts:** 1 is good, 2 is acceptable, 3 or a refusal is a failure to investigate.

| # | Prompt (then refinements) | Expected |
|---|---|---|
| 1 | `invoice for Acme, $2,400` | Bill to Acme; USD; one line, quantity 1, $2,400.00, description missing; subtotal $2,400.00; total incomplete (tax unknown); follow-up asks what the $2,400 covers |
| 1a | → `add a line item: design review, $600` | v2: line 2 "Design review" $600.00; line 1 unchanged (same digest); subtotal $3,000.00 |
| 1b | → `due in 30 days` | v3: payment terms say 30 days from the invoice date; no invented invoice or due date |
| 2 | `Bill Northwind 3 hours of consulting at $150/hr, no tax` | Bill to Northwind; line "Consulting", quantity 3, unit hours, $150.00; tax exempt with rate not applicable; total $450.00, so the invoice is ready apart from the missing facts |
| 3 | `invoice Globex €1.200 for the March retainer, 20% VAT` | EUR; one line "March retainer" €1,200.00; tax applicable at 20%; total €1,440.00. If the model cannot quote "€1.200" as 1200 it must leave the price unknown, not guess |
| 4 | `make me an invoice` | A blank invoice, every fact missing, with a follow-up asking who it's for and how much |
| 5 | `memo for the team about the offsite` | No document; "I can only draft invoices so far…" |
| 6 | `invoice for Acme $2,400, actually make it $2,600` | One line at $2,600.00 (the later statement), quoting it |
| 7 | → on #1: `remove the $2,400 line` | Line 1 removed by its ID and digest; nothing else changes |
| 8 | → on #1: `from Halden Studio, invoice number HS-104, dated today` | Issuer "Halden Studio" (an unbranded document takes it as a field); number HS-104; invoice date = today |

## Results

| Date | Commit | Model | Results |
|---|---|---|---|
| — | — | — | Not run yet: needs `ANTHROPIC_API_KEY`. |
