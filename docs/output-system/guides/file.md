# File

## Purpose
Make a file straight from data: a raw export of store data (orders as Excel, products as CSV), or a change to a file the person uploaded ("fix my uploaded price list"). It always arrives as a file card in the conversation, with its name, format and a download, never as a loose link in the reply text. Every file uses the same brand look, so two files made a week apart look like they came from the same store.

## When it applies
- **Raw data exports:** store data the person wants as a spreadsheet or data file:
  - "export last month's orders as Excel"
  - "our catalog as a CSV"
  - "all customers who bought twice, as a spreadsheet"
- **Uploaded files:** a change to a file the person shared, such as "fix the prices in my uploaded price list" or "clean up this CSV". The result is the same kind of file, changed.
- **A named format alone doesn't make it a file.** "Purchase order as a PDF" is a strict document, "campaign plan as Word" a composed document and "the deck as PowerPoint" a design. Each is made as its own kind, then exported in that format, so it keeps its layout and exact figures.
- **"Make it a PDF"** about something already made exports its current version. That belongs to the kind it was made as, not to this guide.
- **A format a kind can't be exported in:** say so in one line and offer the closest formats from [formats.json](../formats.json). They are shown as a card with those formats to choose from. For example, "An ad can't be a spreadsheet. I can give it to you as an image or a PDF."

## Layout rules
- **Formats:** which formats this can be exported to is listed in [formats.json](../formats.json) under `kinds.file`, closest first. Offer only formats listed there as supported or planned. If the person names one that isn't, say so and offer the closest ones listed.
- **Name:** says what it is and when, such as "Orders, September 2026.xlsx" or "Invoice INV-0042, Bloom & Co.pdf". No random strings.
- **File card:** the card shows the name, the format and the size, with download as the main action. The chat reply doesn't repeat the link. This applies to every file Souvenir delivers, including documents and designs exported in a named format.
- **Documents (PDF, Word):**
  - Same layout, type and colours as the document they come from (tokens.json).
  - The page is A4 or US Letter from the store's country.
  - Body text never below the body size in tokens.json.
- **Slides (PowerPoint):** the design's slides, at 16:9, with the same type floors as the design.
- **Spreadsheets (Excel, CSV):**
  - One header row, with one column per field and plain column names ("Order number", "Date", "Total").
  - Dates and money in real date and number cells, not text.
  - Excel files get a frozen header row and sensible column widths.
- **Brand:** the store's brand. With none set, the neutral default, mentioned once.
- **Missing facts:** a document's Missing facts stay marked in the file. The file is labelled Draft until they're filled.

## Tone
- **In the chat:** one line saying what the file is and anything to check. "Here's last month's orders as Excel: 312 orders, one row each."

## Example 1
**Person:** "Export last month's orders as Excel."

**Souvenir makes** "Orders, September 2026.xlsx":
- one row per order
- columns for the order number, date, customer, items, subtotal, tax, shipping and total
- the header row frozen
- totals as numbers

**Souvenir says:** "Here's September's orders as Excel: 312 orders."

## Example 2
**Person:** "Here's my price list (prices.xlsx). Raise everything 5% and round to the nearest .99."

**Souvenir makes** "Price list, raised 5%.xlsx":
- the same sheet, columns and order as the upload
- each price raised 5% and rounded to the nearest .99, as numbers
- a new column "Old price" next to each new price, so the change can be checked

**Souvenir says:** "Here's your price list with every price raised 5% and rounded to .99. The old prices are in the column next to them."

## Common mistakes
- **A link in the reply text** instead of a file card.
- **A different look for each file:** accent colours, margins or tiny body text chosen file by file.
- **Making a document here.** "Invoice as a PDF" built straight into a file loses the fixed layout and exact totals. Make it as a strict document, then export it.
- **Rebuilding a document** that already exists instead of exporting its current version.
- **Font problems.** Don't use fonts that aren't embedded, which makes the file look different on another computer.
- **Text instead of numbers.** Don't put money and dates in spreadsheets as text, or they can't be added up or sorted.
- **Hiding Missing facts.** Don't drop them to make the file look finished.
