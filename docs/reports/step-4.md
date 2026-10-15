# Step 4 report — revisions

- **Reported:** 2026-10-14 (UTC).
- **Commits:** `cf6c9884` (14 files, +1,854 / −65) and the review follow-up `0e031c76` (4 files, +154 / −17).
- **Decisions:** D-30 to D-34 in [../decisions.md](../decisions.md).
- Backfilled from the Step 4 report and the follow-up report given in the build session.

## Scope

PRD §5 revision contracts and the §9 rows for bounded edits, proposed edits, revision history, restore and approved-old/new-edit; fixtures 6, 7 and 8; and the deck-ancestry check deferred from Step 3. Ten parts, confirmed before building (D-30).

## What was built

- **Revision store** (`revisions.ts`): every document has its own history, in memory (browser storage came in Step 6).
  - Saved revisions can't be changed; trying throws.
  - Two documents with the same title stay separate: identity is the revision ID.
  - "v1, v2…" are display labels in creation order.
- **Bounded edits:** one field, one line item's description, quantity or unit price, or the text of one sentence or list item.
  - Saving creates a revision. Cancel and Escape change nothing, and focus returns to the button that opened the form.
  - Unchanged blocks, fields and the brand are exactly what they were; totals recalculate.
  - Invalid, blank, unchanged or out-of-scope edits are refused with a specific message and create no revision.
  - Older revisions are read-only.
- **Missing fields:** filling one updates validation (filling the due date on the missing-facts invoice drops its issues from 5 to 4). A total that depends on unknown tax stays unknown until tax is supplied.
- **Proposals:** the two fictional proposals show before and after. Accept saves a revision ("Accepted proposal: …"); Reject changes nothing; a proposal written against an older revision can't be accepted.
- **Restore:** restoring v1 after v3 creates v4 with v1's content; v2 and v3 stay in history; v1's approval doesn't carry over.
- **Mock approval:** the marker stays on its own revision; every later revision reads "Not approved".
- **Deck ancestry:** checked against real revisions — the source exists, belongs to that brief, is a brief, and the deck is exactly what it derives. Editing the brief makes the deck stale with the approved message; "Derive again" creates deck v2.
- **Scenarios 6, 7 and 8** run with a button (scenario 7's export check was "Deferred" until Step 5).
- **History panel** uses the repo's `VersionCard`, with change summary, author, parent and approval beneath.

## Review follow-up (`0e031c76`, D-33 and D-34)

1. Titles recompute when a revision changes a brief's title or an invoice's number; restoring restores the old title; deck derivation uses the current title.
2. Validation in the revision logic itself: impossible dates refused (2026-13-45, 2026-02-30); amounts must be whole, non-negative minor units in the invoice's currency ("Unit price is in EUR, but this invoice is in USD."), and are refused when the invoice has no currency; percentages 0–100; text trimmed, and whitespace-only changes count as no change.
3. Restoring content identical to the current revision, and deriving again from the same brief revision, are refused with specific messages.
4. Approval on older revisions unchanged, as confirmed.
5. Only the issuer name is brand-locked; the issuer address stays editable.
- Tests: a render test of the workbench (Issuer has no Edit button and shows the reason; Issuer address and Payment terms do), and a test that a proposal touching the issuer name is refused.

## Checks

- Step 4: 174 document, workbench and proxy tests pass, including forced cases (editing a saved snapshot, editing a non-current revision, accepting a stale proposal, restoring a missing or another document's revision, ancestry pointing at a missing, misattributed, non-brief or tampered source). Full suite 1,347 pass.
- Follow-up: full suite 1,356 pass.
- Both: the only failure is the known `theme.test.tsx`; typecheck, lint and the production build clean.
- Browser: every flow at desktop width including Cancel and Escape; the field-fill flow at 320px and the page at 390px have no sideways scroll.

## Decisions asked, and the verdicts

1. Editing the Issuer field split the issuer name between letterhead and Parties block. → D-31: refuse issuer-name edits with a reason.
2. New wording ("Created", "Ancestry check failed: {reason}", "Sample reviewer (fictional)", the two proposal titles, "v2 · Current"). → D-31 approved.
3. Em dashes vs hyphens. → D-31: keep em dashes.
4. Decks can't be edited directly. → D-31 approved.
5. Workbench-only text. → D-31 approved as written.

## New user-facing text

All wording in D-30 item 4 and D-31 item 2, plus the workbench labels ("Save as new revision", "Fill", "Derive again", the refusal messages, "Older revisions are read-only…").
