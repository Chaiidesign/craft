# Dashboard

## Purpose
Make a page of numbers the person checks again and again, such as weekly sales or daily stock levels. It reads the store's live data each time it opens, so it stays current without being remade. It lives at a private link.

## When it applies
- The request is about numbers that will be watched over time:
  - "dashboard I can check every Monday"
  - "keep an eye on stock levels every day"
  - "track our ad spend against sales"
- A one-time look at numbers is an inline chart instead.
- **Changes**, such as "add returns to it" or "show last 12 weeks", make a new version of the same dashboard.

## Layout rules
- **Formats:** which formats this can be exported to is listed in [formats.json](../formats.json) under `kinds.dashboard`, closest first. Offer only formats listed there as supported or planned. If the person names one that isn't, say so and offer the closest ones listed.
- **Top row:** three to five headline numbers. Each one has:
  - its label
  - the value
  - its change against the previous period, with a clear direction (up or down, in words or symbols, not colour alone)
- **Below the top row:** at most four charts, each answering one question. They follow the inline chart rules: titled in words, axes from zero for bars, one data colour.
- **Tables** for lists the person acts on, like low-stock products with their quantities. Sort them by what needs attention first.
- **Update line:** shows when the data was last updated and which store it reads from.
- **Phone first:** on a phone, everything stacks into one column and the headline numbers stay at the top.
- **Brand:** the store's accent colour for the data, otherwise neutral accent. The state colours mark problems (tokens.json `colour.state`).
- **Missing data:** if a number can't be read, its tile says **Missing** and why ("not connected: ad accounts"). It never shows zero.

## Tone
- Labels are short and plain, such as "Orders", "Revenue", "Average order value" or "Low stock".
- No commentary on the page itself. Souvenir's interpretation goes in the chat.

## Example 1
**Person:** "A weekly sales dashboard I can check every Monday."

**Souvenir makes** a dashboard, version 1:
- **Headline numbers:** revenue, orders, average order value and returning customers, each against the week before
- **Chart:** weekly revenue for the last 12 weeks
- **Table:** top 10 products this week
- **Update line:** "Updated when opened · Your store's orders"

**Souvenir says:** "I made your weekly sales dashboard. Open it any Monday and it shows the latest week."

## Example 2
**Person:** "I want to keep an eye on stock levels for my top 30 products every day."

**Souvenir makes** a dashboard, version 1:
- **Headline numbers:** products below reorder level, products out of stock, and days of stock left at the current sales rate
- **Table:** the 30 products, sorted by days of stock left, with the low ones marked

**Souvenir says:** "I made a stock dashboard for your top 30 products. The lowest stock is at the top."

## Common mistakes
- **A snapshot that goes stale.** Don't copy today's numbers into the page as fixed text.
- **Too many charts.** More than four charts, or charts that answer the same question twice.
- **Colour alone for meaning.** A red number needs a word or symbol too.
- **Zero for missing data.** Show zero only when the value really is zero; data that couldn't be read is Missing.
- **Using a dashboard for a one-off question.** That's an inline chart.
