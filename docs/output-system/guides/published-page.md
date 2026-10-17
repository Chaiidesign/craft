# Published page

## Purpose
Make a page people interact with, such as a shipping calculator, a size guide, a product quiz or a launch countdown. It's hosted at a private link the person can share or put on their store. This is also the fallback: when no other kind fits, a published page can still be made, so Souvenir never says it can't make something.

## When it applies
- The person or their shoppers will use it, not just read it. They will type, choose, filter or click:
  - "shipping cost calculator for my site"
  - "a quiz that recommends a serum"
  - "size guide for our jeans"
- Numbers checked again and again are a dashboard instead.
- If no other kind fits, use the closest one. If none is close, use a published page.
- **Changes**, such as "add express shipping" or "make the button say Calculate", make a new version of the same page.

## Layout rules
- **One job per page,** with a title that names it, like "Shipping cost calculator".
- **Inputs:**
  - Each input has a visible label, sensible defaults and plain error messages ("Enter a weight in kg").
  - The result appears next to the inputs, not on another screen.
- **Phone first:**
  - It works at 320 px wide.
  - Tap targets are at least 44 px.
  - The page never needs sideways scrolling.
- **Brand:**
  - The store's colours, fonts and logo.
  - With no brand, the neutral default (tokens.json `colour.neutral`) and the four type roles.
- **Self-contained:** the page works by itself, with no outside scripts and nothing that breaks when another site is down.
- **Store facts:** rates, sizes and products come from the store's data or the person's words. A rate Souvenir doesn't have is shown as **Missing** on the page and is never filled with an estimate.
- **Accessible:** labels on every input, enough contrast, and usable with a keyboard.

## Tone
- Shopper-facing words, short and friendly: "Your estimated shipping: $8.40".
- No instructions longer than one line.

## Example 1
**Person:** "Shipping cost calculator for my site."

**Souvenir makes** a published page, version 1:
- **Inputs:** destination country, parcel weight and a delivery speed choice
- **Result:** the price and the delivery estimate, under the inputs
- **Missing:** the rates, shown as "Missing: shipping rates" until the person gives them

**Souvenir says:** "I made a shipping calculator page. Add your rates (or tell me your carrier) and it's ready to share."

## Example 2
**Person:** "Size guide for our jeans."

**Souvenir makes** a published page, version 1:
- **Inputs:** a waist and inseam input
- **Result:** the recommended size from the store's size chart
- **Table:** the full chart underneath, in cm and inches
- **Missing:** the size chart, if the store data doesn't have it

**Souvenir says:** "I made a jeans size guide page. It uses your size chart for the waist and inseam ranges."

## Common mistakes
- **Inventing numbers.** Don't make up shipping rates, sizes or prices so the page "works".
- **Depending on outside services.** Don't load fonts, scripts or images from other sites.
- **Building for desktop only.** Most shoppers are on phones.
- **Packing in jobs.** Don't put several jobs on one page, like a calculator, a quiz and a newsletter sign-up.
- **Refusing.** Don't say "I can't make that". Make the closest kind, or a published page.
