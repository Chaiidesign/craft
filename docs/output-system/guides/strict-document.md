# Strict document

## Purpose
Make a document where money, legal terms or required facts must be exact: an invoice, a wholesale quote, a purchase order, a receipt or a returns policy. The layout is fixed for each document type. Souvenir only fills in facts the person gave or the store data holds. Totals are worked out exactly, and any fact still unknown is shown as **Missing** on the document, where it belongs.

## When it applies
- The request involves money that must add up, legal terms, or facts a document isn't valid without:
  - "invoice Bloom & Co…"
  - "quote for 500 units…"
  - "purchase order to our supplier…"
  - "write our returns policy…"
- It comes before composed documents, so a policy is strict even though it is also writing.
- **If the person names a format** ("purchase order as a PDF"), it is still a strict document. Make it with its fixed layout and exact totals, then export it in that format. The format decides how it arrives, not what kind of thing it is.
- **"Make it a PDF"** about a strict document already made exports its current version. It doesn't make a new version or a second document.
- **Changes** to an invoice already made, such as "add a line item" or "due in 30 days", make a new version of the same document, never a second invoice.

## Layout rules
- **Formats:** which formats this can be exported to is listed in [formats.json](../formats.json) under `kinds.strict_document`, closest first. Offer only formats listed there as supported or planned. If the person names one that isn't, say so and offer the closest ones listed.
- **Fixed sections for each type,** in a fixed order. An invoice has:
  1. the letterhead
  2. title and number
  3. dates
  4. bill-to
  5. line items
  6. totals
  7. payment terms
- Souvenir doesn't add, remove or reorder sections.
- **Money:**
  - Figures use the money type role and line up in columns.
  - Every line item total and the grand total are worked out, never typed.
  - The currency is stated once, near the totals.
- **Missing facts:**
  - Each unknown fact is shown in its own place with the Missing style (the state colours in tokens.json).
  - The document's status stays **Draft** until every required fact is there, then becomes **Ready**.
- **Unknowns:** an unknown tax, price, quantity or date is Missing, never zero and never "TBD" typed in.
- **Brand:**
  - The store's brand provides the logo and accent.
  - With no brand, the document is unbranded: no letterhead and no invented issuer Say so once.
- **Page:** A4 or US Letter from the store's country. The margins and type sizes come from tokens.json (`page` and `type.print`) and are never changed per document.

## Tone
- **On the document:** plain and formal. Use the person's own wording for descriptions and terms. Don't add marketing language.
- **In the chat:** one line saying what was made and which facts are Missing. The facts are not listed in the reply text instead of on the document.

## Example 1
**Person:** "Invoice Bloom & Co for 40 ceramic planters at $18 each."

**Souvenir makes** an invoice, version 1:
- **Bill to:** Bloom & Co
- **Line item:** "Ceramic planters", quantity 40, unit price $18.00, line total $720.00
- **Totals:** a subtotal of $720.00
- **Tax:** Missing
- **Invoice number, invoice date and issuer:** Missing
- **Status:** Draft

**Souvenir says:** "I made the invoice for Bloom & Co, version 1. The invoice number, date and tax are Missing. Who is it from?"

## Example 2
**Person (after Example 1):** "No tax, and it's due in 30 days."

**Souvenir makes** version 2 of the same invoice:
- **Tax:** set to exempt
- **Payment terms:** "Due within 30 days of the invoice date"
- **Everything else:** unchanged

**Souvenir says:** "Updated to version 2: no tax, due in 30 days. The invoice number and date are still Missing."

## Common mistakes
- **Guessing a fact.** Don't invent an invoice number, a date, a tax rate or the issuer's address to make the document look complete.
- **Treating unknown tax as zero.** That changes the total someone pays.
- **Listing Missing facts in the chat reply** and leaving the document looking finished.
- **Making a second invoice** when the person asked for a change. Make a new version of the same one.
- **Restyling it.** Don't change the layout, colours or type sizes for one document. The point of a strict document is that every one looks the same.
