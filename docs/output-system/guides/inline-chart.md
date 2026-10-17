# Inline chart

## Purpose
Give a quick look at numbers inside the conversation, such as sales by week or the top products. It answers a question once. It is not a page to come back to.

## When it applies
- The request is about numbers and the person wants to see them now:
  - "show me sales by week"
  - "which products sold most"
  - "how did September compare to August"
- If they will check the same numbers again and again ("every Monday", "keep an eye on"), it is a dashboard instead.
- A chart often comes with a chat reply. The sentence answers the question and the chart shows it.
- Charts inside a report belong to that composed document, not to the chat.

## Layout rules
- **One chart, one question.** Choose the chart from what the question compares:
  - a bar chart for comparing categories or a handful of periods
  - a line for a trend over many periods
  - never a pie chart with more than four slices
- **Title:** says what the chart shows, in words: "Weekly sales, last 8 weeks". It should not be a label like "Chart 1".
- **Labels and axes:**
  - Give every bar its value label.
  - Axes start at zero for bars.
  - Show units: currency symbol, "orders", "%".
- **At most 12 bars or 24 points.** Group the rest as "Other".
- **Under the chart:** one line saying where the numbers come from and the date range, such as "Source: your store's orders, Aug 25 – Oct 19".
- **Colour:**
  - One colour for the data, from the store brand's accent, or neutral accent if no brand is set.
  - A second colour only to pick out one bar the reply talks about.
  - Never a rainbow.
- **Sizes:** the chart's sizes follow `chart` in tokens.json. On a phone it fills the width and the labels stay at the caption size.

## Tone
- The sentence with the chart does the interpreting: "Week 41 was the low point, down 18%."
- The chart itself carries no commentary.

## Example 1
**Person:** "Show me sales by week for the last 8 weeks."

**Souvenir:**
- **Reply:** "Sales peaked in week 39 at $14,200 and have eased since."
- **Chart:** "Weekly sales, last 8 weeks", a bar chart with eight bars and value labels in dollars. The source line is the store's orders.

## Example 2
**Person:** "Which five products sold the most in September?"

**Souvenir:**
- **Reply:** "The Alpine backpack led with 212 sold, nearly twice the next product."
- **Chart:** "Top 5 products by units sold, September", horizontal bars with product names on the left and units at the bar ends.

## Common mistakes
- **Numbers that weren't given.** Don't chart numbers the store data didn't return. With no data connected, say what's needed and don't chart examples.
- **Hiding a small change.** Don't start a bar axis above zero to make a small difference look big.
- **Using the wrong kind.** Don't use a chart for a single number ("how many orders today?"); that's a sentence. Don't use one for numbers they want daily; that's a dashboard.
- **Too much at once.** Don't use more than two colours, put a legend on a single series, or squeeze 40 bars into a phone width.
