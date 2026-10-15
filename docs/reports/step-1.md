# Step 1 report — foundations

- **Reported:** 2026-10-14 (UTC). **Commit:** `13265b24` (21 files, +2,935 / −1).
- **Decisions:** D-01 to D-08 in [../decisions.md](../decisions.md).
- Backfilled from the Step 1 report given in the build session; nothing has been reworded except to remove references to the chat.

## Scope

PRD §5 (types and contracts) and §11 (fixtures), as the base for everything else: the typed document model, integer money, validation, the 11 PRD fixtures, and a workbench page to inspect them. No drawing of documents yet (Step 2).

## What was built

- **Document model** (`src/lib/documents/model.ts`): invoices, briefs and decks; fields with provided / missing / not-applicable states; content blocks (heading, paragraph, list, field group, table, line items, derived totals, image, chart, callout, source list); brand profiles; revisions; mock review markers; export records with typed errors.
- **Money** (`money.ts`, `invoice.ts`): every amount is a whole number of minor units (cents, paise), never parsed from formatted text. The hand-worked sample invoice totals exactly **$7,514.82**, checked to the cent.
- **Missing facts** are shown as missing beside the field, never filled in or treated as zero. Without tax, the total reads "Unknown — tax is unknown, not zero" instead of a final amount.
- **Fixtures** (`src/lib/documents/fixtures/`): all 11 PRD fixtures, all fictional and labelled "Sample data — fictional". The eight plain documents are fully built; the five scenarios (deck, edit, approval, restore, export and error cases) are listed with the step that makes them runnable, and say they can't run yet.
- **Demo page:** `/document-verify`. `src/proxy.ts` lets it open without a login in development and on Vercel previews; in production it stays behind login (D-05).
  > **Correction (2026-10-15, Instinct review D-45):** "behind login" is only half of it. In production `src/proxy.ts` doesn't allow the route through, so a visitor who isn't signed in is sent to log in; a signed-in user then gets a **404**, because `page.tsx` calls `notFound()` outside development and Vercel previews. The README's "404 in production" describes the signed-in case; both are true.

## How to see it

`cd ~/craft && npx next dev -p 4010`, then http://localhost:4010/document-verify.
- "Invoice with missing facts": yellow rows are missing required facts; clicking an issue jumps to its field; totals show the unknown tax.
- "Long invoice": 42 rows in rupees with Indian digit grouping (₹1,23,456.78).

## Checks

- 71 new tests pass: document logic, plus `proxy.ts` tests showing the page opens in dev and on previews, stays locked in production, and opens nothing below it.
- Typecheck clean; lint clean on the new files.
- Full suite: the only failure is `src/lib/theme.test.tsx` ("theme.css is additive and in sync"), which failed before this work began.
- Phone widths: the page fits at 320px and 390px with no sideways scroll (a squashed line-item table at 320px was fixed).

## Finding reported

The app's shared root layout asks the app's own `/auth/access-token` endpoint for a login token on every page, including the demo. Locally it fails because Auth0 isn't configured; nothing else is requested and nothing breaks. On a Vercel preview, the same layout's Mixpanel provider could log a page view if a token is set. Recommendation: leave both and document them. Approved as D-20.

## New user-facing text

"Sample data — fictional"; "Unknown — tax is unknown, not zero"; the fixture titles and purposes in `fixtures/index.ts`. Approved with the plan (D-08).
