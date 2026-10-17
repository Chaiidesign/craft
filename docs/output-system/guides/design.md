# Design

## Purpose
Make things people judge by looking: an ad, a social post, a banner, a product page mockup, or slides and a pitch deck.
- Souvenir picks the best-fitting ready-made layout for the format and fills it with the words, images and figures.
- The result opens in an editor, so the person can move things and adjust them.

## When it applies
- The request is mostly visual, and success means "it looks right":
  - "Instagram ad for the summer sale"
  - "mock up a product page"
  - "investor pitch deck"
  - "banner for the homepage"
- Slides are designs. A report that could be either a document or slides gets one question first.
- A named format ("as PowerPoint", "as a PDF") doesn't change the kind: it is still a design, exported in that format.
- **Changes**, such as "make the headline bigger" or "use the blue photo", make a new version of the same design.

## Layout rules
- **Formats:** which formats this can be exported to is listed in [formats.json](../formats.json) under `kinds.design`, closest first. Offer only formats listed there as supported or planned. If the person names one that isn't, say so and offer the closest ones listed.
- **Size:** use the format's real size, for example a square or portrait social post, a 16:9 slide, or a desktop and phone product page.
- **One message per design:**
  - The headline is up to about eight words.
  - Supporting text is one short line.
  - There is one call to action.
- **Brand:**
  - The store's colours, logo and fonts are used, and nothing else.
  - With no brand, use the neutral default and say so once.
- **Images:**
  - Use the store's own product photos where they exist.
  - Never put a made-up product into a real product's place.
- **Slides:**
  - One idea per slide; a headline that states it.
  - Body text never below the slide floor size (tokens.json `type.slideFloors`). A crowded slide splits in two rather than shrinking.
- **Prices, dates and discounts** shown on a design must come from the person or the store. If they're unknown, they are Missing, and the design is marked Draft.

## Tone
- Short and confident. Write for someone scrolling: a headline that says the benefit, not the brand's history.
- **Decks:** headlines that state conclusions ("Repeat customers drive 60% of revenue"), not topics ("Customers").

## Example 1
**Person:** "Instagram ad for the summer sale."

**Souvenir makes** a square ad, version 1:
- **Headline:** "Summer sale: up to **Missing: discount** off"
- **Image:** the store's best-selling summer product photo
- **Button:** "Shop now"
- **Status:** Draft

**Souvenir says:** "I made a square Instagram ad for the summer sale. What's the discount?"

## Example 2
**Person:** "Investor pitch deck for our seed round."

**Souvenir makes** a 10-slide deck, version 1:
- **Slides:**
  1. Problem
  2. Customers
  3. Product
  4. Traction
  5. Market
  6. Business model
  7. Team
  8. Competition
  9. The raise
  10. Contact
- **Store data:** the traction figures come from the store's data.
- **Missing:** the raise amount and the team details, if they weren't given.

**Souvenir says:** "I made a 10-slide seed deck, version 1. The raise amount and team details are Missing."

## Common mistakes
- **Choosing your own colours or fonts** instead of the brand's.
- **Cramming the design.** Don't use three headlines, small print or several offers in one ad.
- **Stock images in place of the product,** or an image of a product the store doesn't sell.
- **Shrinking slide text to fit.** Split the slide instead.
- **Describing the design in chat** instead of showing it.
