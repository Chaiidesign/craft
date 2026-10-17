# Rubric: how outputs are scored

Used from Session 1 on every gallery item and eval output (build-loop.md §8). Six dimensions, each scored 1 to 5.

**Scores are advisory.** Claude's own scores run high, so they never pass a gate alone. They are shown next to each gallery item to help the designer review. The gates are the automatic checks (build-loop.md §8) and the designer's review.

Score each output against its guide (`guides/`) and the "Based on" standard named in that guide. Look at the rendered output as an image, at 390 px and 1280 px, and at every exported page. Don't score from extracted text.

| Dimension | 1: not shippable | 3: ships after real rework | 5: ships with small edits or none |
|---|---|---|---|
| **Hierarchy** | Everything looks equally important. The reader can't find the main point or the next thing to read. | The main point is findable, but the headings, weights or spacing compete with it. | The eye lands on the main point first, then moves in the intended order. Headings say something. |
| **Brand fit** | Colours, type or tone chosen ad hoc, or another brand's look. | Brand colours and type are present but used loosely: too many accents, inconsistent marks. | Only the store's brand, or the neutral default when there is none. Used sparingly and the same way as every other output of its kind. |
| **Readability** | Body text below the token sizes, lines too long or too short, low contrast. | Readable, but dense in places, or lines outside 45 to 75 characters. | Body at the token sizes, comfortable line lengths, clear spacing, and WCAG 2.2 AA contrast. |
| **Facts and numbers** | Any invented fact, any number that doesn't match the sample data, or a total that doesn't add up. | Facts correct, but a required fact is missing without a Missing mark, or a number lacks its unit or period. | Every fact is sourced or marked Missing. Every number matches the sample data exactly, with its unit and period. |
| **Fit to its standard** | Missing fields or sections its standard requires (for example, no tax line on an invoice). | Has the required parts, in an unusual order or with weak labels. | Looks like a standard, professional example of its kind, with every required part, in the expected order and with the expected labels. |
| **Phone legibility** | At 390 px it needs sideways scrolling, overlaps, or has text too small to read. | Usable at 390 px, but cramped, or some parts need zooming. | At 390 px everything reads without zooming or sideways scrolling, and tap targets are at least 44 px. |

**Rules for scoring**

- **A score of 1 on facts and numbers fails the output,** whatever else it scores. The automatic checks catch most of these. The rubric records the rest.
- **Give one sentence of evidence for every score below 5,** naming what is wrong and where. For example, "Totals block: tax line missing; subtotal is shown as the total due."
- **Fix the cause, not the output.** A low score is fixed in the template or guide that caused it, never in one output by hand (build-loop.md §7).
- **Score files and chat replies too.** For a file, "hierarchy" means column order and headers, and "phone legibility" applies to its preview. For a chat reply, "brand fit" means tone.
