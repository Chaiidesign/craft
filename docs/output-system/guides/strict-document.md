# Strict document

## Purpose
Make a document where money, legal terms or required facts must be exact: an invoice, a quote, a purchase order or a receipt. The layout is fixed for each document type. Souvenir only fills in facts the person gave or the store data holds. Totals are worked out exactly, and any fact still unknown is shown as **Missing** on the document, where it belongs. A returns policy and other documents with exact terms are coming later.

## Based on
- **EN 16931 and UBL core invoice fields:** seller, buyer, document number, issue date, currency, lines with quantity and unit price, tax shown with its rate, and the totals. The same core serves the quote, purchase order and receipt, each with its own names.
- **India GST invoice practice,** for the INR store: tax shown as its own rate and amount under the subtotal. The sample stores hold no GST number or place of supply, so those aren't shown. They aren't marked Missing either, so a document isn't held back as incomplete for a fact no one has been asked for.
- **Issuer first:** the letterhead, then the title and number, then the parties.
- **Totals:** subtotal, then discount and tax lines, then shipping, then the total. Payment terms sit beside the totals.

## When it applies
- The request involves money that must add up, legal terms, or facts a document isn't valid without:
  - "invoice Bloom & Co…"
  - "quote for 500 units…"
  - "purchase order to our supplier…"
  - "receipt for order FH-01042"
- It comes before composed documents, so a policy is strict even though it is also writing.
- **If the person names a format** ("purchase order as a PDF"), it is still a strict document. Make it with its fixed layout and exact totals, then export it in that format. The format decides how it arrives, not what kind of thing it is.
- **"Make it a PDF"** about a strict document already made exports its current version. It doesn't make a new version or a second document.
- **Changes** to a document already made, such as "add a line item" or "valid for 30 days", make a new version of the same document, never a second one.

## Layout rules
- **Formats:** which formats this can be exported to is listed in [formats.json](../formats.json) under `kinds.strict_document`, closest first. Offer only formats listed there as supported or planned. If the person names one that isn't, say so and offer the closest ones listed.
- **Fixed sections for each type,** in a fixed order:
  1. the letterhead
  2. title and number, with the dates
  3. the parties: the issuer, then the other party
  4. details
  5. line items
  6. totals
  7. terms

  | Type | Other party | Dates | Details | Total | Terms |
  | --- | --- | --- | --- | --- | --- |
  | Invoice | Bill to | Invoice date, due date | Purchase order, order, currency | Total due | Payment terms |
  | Quote | Quote for | Quote date, valid until | Currency | Total | Terms, if given |
  | Purchase order | Supplier | Order date, deliver by | Currency | Order total | Payment terms, if given |
  | Receipt | Received from | Date paid | Order, paid by, currency | Total paid | None |

- Souvenir doesn't add, remove or reorder sections.
- **Money:**
  - Figures use the money type role and line up in columns.
  - Every line item total and the grand total are worked out, never typed.
  - The currency is stated once, near the line items.
- **Where each fact comes from.** Each fact comes from one of three places:
  - **The store:** its name, address and currency; today's date as the document date; the tax it charges on what it sells; and for an order, the customer, lines, discount, shipping, tax and order date. Name the order or the products, and the figures are copied from the store exactly. Never type a store figure yourself.
  - **The person:** anything they said that the store doesn't hold, such as the document number, a due date, how long a quote is valid, a supplier and what they charge, or payment terms. Use their own words.
  - **Neither:** it stays Missing.
- **A purchase order** is what the store pays a supplier, so the store's selling prices never go on one. The supplier's price, tax and discount are Missing until the person says what they are.
- **The store's price is its everyday selling price.** A wholesale or special price is something the person states. When they ask for one and don't give it, make the line in their words with the price Missing, and ask for it.
- **Make the document even when a fact is unclear.** If they didn't say which colour or size, or the price is unknown, make the line in their words with what's unknown left Missing, and ask your one question about it. Don't answer in chat instead: the document with its Missing facts is what they asked for.
- **Missing facts:**
  - Each unknown fact is shown in its own place with the Missing style (the state colours in tokens.json).
  - The document's status stays **Draft** until every required fact is there, then becomes **Ready to send**.
- **Unknowns:** an unknown tax, price, quantity or date is Missing, never zero and never "TBD" typed in.
- **Brand:**
  - The store's brand provides the letterhead and accent.
  - With no logo, the letterhead says so instead of showing an invented mark.
- **Page:** A4 or US Letter from the store's country. The margins and type sizes come from tokens.json (`page` and `type.print`) and are never changed per document.

## Tone
- **On the document:** plain and formal. Use the person's own wording for descriptions and terms. Don't add marketing language.
- **In the chat:** at most one short question, about the most important fact still Missing. The document itself shows what is Missing.

## Example 1
**Person (Fernhill Goods):** "Quote Bloom & Co for 40 ceramic planters in sand."

**Souvenir** finds the product in the store's catalogue, then makes a quote, version 1:
- **Issuer:** Fernhill Goods Co., with the store's address
- **Quote for:** Bloom & Co
- **Line item:** "Ceramic planter, Sand", quantity 40, at the store's price, with the line total worked out
- **Tax:** the store's own rate. **Quote date:** today.
- **Quote number and valid until:** Missing
- **Status:** Draft

**Souvenir asks:** "How long should the quote be valid for?"

## Example 2
**Person (after Example 1):** "Valid for 30 days, number it Q-2041."

**Souvenir makes** version 2 of the same quote:
- **Valid until:** 30 days after the quote date
- **Quote number:** Q-2041
- **Everything else:** unchanged

**Souvenir says:** "Version 2: set Valid until and Quote number." The quote is now Ready to send.

## Common mistakes
- **Guessing a fact.** Don't invent a document number, a due date, a supplier's price or anyone's address to make the document look complete.
- **Typing a store figure.** A price or total typed from memory can be wrong. Name the order or the product, and the store's figure is used.
- **Putting the selling price on a purchase order.** It is what the store charges, not what it pays.
- **Treating unknown tax as zero.** That changes the total someone pays.
- **Listing Missing facts in the chat reply** and leaving the document looking finished.
- **Making a second document** when the person asked for a change. Make a new version of the same one.
- **Restyling it.** Don't change the layout, colours or type sizes for one document. The point of a strict document is that every one looks the same.
