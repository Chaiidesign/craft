# Eval set S1: invoices from a prompt

Fixed prompts for checking the real model by hand (not run in CI, which uses the scripted model). Run each through `/document-chat` or the CLI with a model key set (`OPENROUTER_API_KEY`, or `ANTHROPIC_API_KEY`; D-65), and record the result per commit at the bottom.

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
| 2 | `Bill Northwind 3 hours of consulting at $150/hr, no tax` | Bill to Northwind; line "Consulting", quantity 3, unit hours, $150.00; tax exempt with rate not applicable; subtotal $450.00. The total stays incomplete because the prompt says nothing about a discount, and an unstated discount is unknown, not zero (corrected 2026-10-15: this row first said "total $450.00") |
| 3 | `invoice Globex €1.200 for the March retainer, 20% VAT` | EUR; one line "March retainer" €1,200.00; tax applicable at 20%; total €1,440.00. If the model cannot quote "€1.200" as 1200 it must leave the price unknown, not guess |
| 4 | `make me an invoice` | A blank invoice, every fact missing, with a follow-up asking who it's for and how much |
| 5 | `memo for the team about the offsite` | No document; "I can only draft invoices so far…" |
| 6 | `invoice for Acme $2,400, actually make it $2,600` | One line at $2,600.00 (the later statement), quoting it |
| 7 | → on #1: `remove the $2,400 line` | Line 1 removed by its ID and digest; nothing else changes |
| 8 | → on #1: `from Halden Studio, invoice number HS-104, dated today` | Issuer "Halden Studio" (an unbranded document takes it as a field); number HS-104; invoice date = today |

## Results

| Date | Commit | Model | Results |
|---|---|---|---|
| 2026-10-15 | `f3c88efb` | `anthropic/claude-opus-5.5` via OpenRouter (D-65), effort medium | **10/10 pass, every turn in 1 attempt.** Details below. |

### 2026-10-15 run, in detail

Run through the agent CLI (`scripts/documents/agent.ts`), one fresh store per prompt; 7 and 8 start from a fresh copy of #1 v1. Times are wall-clock per CLI call, including about 1.5 s of process start-up.

| # | Result | Attempts | Time | Follow-up asked |
|---|---|---|---|---|
| 1 | Pass. Bill to Acme; USD; one line, quantity 1, $2,400.00, description missing; subtotal $2,400.00; total incomplete (tax and discount unknown). | 1 | 8 s | "What is the $2,400 charge for?" |
| 1a | Pass. v2 adds line 2 "Design review" $600.00; line 1 keeps digest `7631b75a`; subtotal $3,000.00; only `line 2` changed. | 1 | 4 s | "Who is sending this invoice (your name or business)?" |
| 1b | Pass. v3 sets Payment terms "Due within 30 days of the invoice date."; no invoice or due date set. | 1 | 5 s | "What date should the invoice be dated?" |
| 2 | Pass (against the corrected row). Northwind; "Consulting", quantity 3, unit hour, $150.00; tax exempt, rate not applicable; subtotal $450.00; total incomplete only because discount is unstated. | 1 | 8 s | "Who is sending this invoice (your name or business name)?" |
| 3 | Pass, by the fallback branch. EUR; "March retainer"; 20% VAT applicable; **unit price left unknown**. The model quoted "€1.200", but the European thousands separator fails the number-in-quote check, so it didn't set the price and didn't guess. Known limitation, S1 report. | 1 | 10 s | "Is the retainer amount €1,200 (one thousand two hundred euros)?" |
| 4 | Pass. Blank invoice, every fact missing, no currency. | 1 | 6 s | "Who is this invoice for, and what are you charging them for (with the amount)?" |
| 5 | Pass. No document; non-retryable `unsupported-type`; the chat shows "I can only draft invoices so far. Briefs, memos and decks are coming next." | 1 | 3 s | — |
| 6 | Pass. One line at $2,600.00, quoting "actually make it $2,600". | 1 | 5 s | "What is the $2,600 charge for?" |
| 7 | Pass. Line 1 removed; nothing else changed; subtotal $0.00. | 1 | 5 s | "What should this invoice charge Acme for, and how much?" |
| 8 | Pass after a fix. Issuer "Halden Studio"; number HS-104; invoice date = today. **First run dated it 2026-10-16:** "today" was the UTC date, a day ahead of California after 5 pm. Fixed (D-67), re-run: 2026-10-15. | 1 | 6 s | "What is the $2,400 charge for?" |

Observations:
- **Nothing invented, in any turn.** Every set value quotes the request, and no turn set an issuer, date, tax or discount that wasn't stated.
- **Follow-ups are one plain question each.** After 1a the model asks about the issuer rather than repeating the line-1 description; both are still missing, so either is reasonable.
- **#3 is the weakest result.** The price is right in meaning but blocked by the quote check. The follow-up asks the person to confirm it, which is honest but costs a turn. Accepting European number formats in the quote check is a candidate fix for S3.

