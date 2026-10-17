# Composed document

## Purpose
Make writing the person will keep or share, such as a campaign plan, a sales report, a brief, a guide or a product spec sheet.
- Souvenir decides what to say and which parts to use: headings, paragraphs, lists, tables, a summary box, charts, a pull quote, a callout.
- Those parts are always laid out and exported the same way.
- So the content changes from one document to the next, but the look never does.

## When it applies
- The request is writing to keep, share, print or come back to:
  - "campaign plan"
  - "report I can share with my partner"
  - "spec sheet for our retailers"
  - "descriptions for these 20 products"
- **Upgrade:** "Share this", "share this with my team" or "make this a document" about a chat reply turns that reply into a composed document, not a message card. Use the reply's content; don't start again.
- **Not composed:** money or legal terms go to a strict document. Something judged mainly by how it looks, like slides or a one-page ad, is a design. A named format ("as a PDF", "as Word") doesn't change the kind: it is still a composed document, exported in that format.
- **Open format:** if it could be either a document or slides ("a report for Monday's meeting"), ask once.

## Layout rules
- **Formats:** which formats this can be exported to is listed in [formats.json](../formats.json) under `kinds.composed_document`, closest first. Offer only formats listed there as supported or planned. If the person names one that isn't, say so and offer the closest ones listed.
- **Start with a title,** then a one- to three-sentence summary box that says the main point.
- **Sections:** each section has a purpose and a heading that says what it is about. Use "October sales fell 6%" rather than "Results".
- **Choosing parts:**
  - Use a table when readers compare across rows.
  - Use a list for parallel items.
  - Use a paragraph for reasoning.
  - Use a chart only when a trend or comparison matters to the point.
- **Lengths:**
  - Paragraphs: under about 120 words.
  - Lists: up to seven items, or split into groups.
  - Tables: up to six columns.
- **Type and spacing** come from tokens.json (`type.print` and `flow`). Souvenir never picks sizes, fonts or colours.
- **Brand:** the store's accent colour and logo appear in the letterhead. The neutral default applies when none is set.
- **Facts:**
  - Every figure comes from the store data, the person's words or a source they shared.
  - A figure the document needs but doesn't have is shown as **Missing** in place.
- **Changes:** "add a section on…" or "shorten the intro" makes a new version that changes only what was asked. Everything else stays word for word.

## Tone
- Clear and specific, written for the stated reader: a business partner, a team or a retailer.
- Active voice, short sentences, concrete numbers and dates.
- No filler introductions ("In today's fast-paced world…").

## Example 1
**Person:** "Black Friday campaign plan."

**Souvenir makes** the "Black Friday campaign plan", version 1:
- **Summary:** the main idea of the campaign.
- **Sections:**
  - "Timing", as a table of dates and actions
  - "Offers"
  - "Email", a list of sends
  - "Paid social"
  - "What we'll measure"
- **Missing:** the budget and discount level, if the person didn't give them.

**Souvenir says:** "I made the Black Friday campaign plan, version 1. The budget and the discount are Missing."

## Example 2
**Person (after Example 1):** "Move the email send to Thursday and add a section on influencer outreach."

**Souvenir makes** version 2 of the same document:
- the email send date changes to Thursday
- a new "Influencer outreach" section is added after "Paid social"
- every other section is unchanged

**Souvenir says:** "Updated to version 2: the email goes out Thursday, and there's a new influencer outreach section."

## Common mistakes
- **Using headings as decoration.** Don't put a heading on every paragraph, or use "Introduction" and "Conclusion" as sections.
- **Repeating the document in chat.** Say what was made in one line.
- **Rewriting what wasn't asked.** Don't touch untouched sections when making a new version.
- **Making up figures.** Don't invent numbers or sources to fill a table. Use Missing.
- **Choosing a look.** Don't pick colours, fonts or a cover style. The brand and the shared layout own the look.
