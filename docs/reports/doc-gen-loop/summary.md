# Pass 1 summary: document generation in the real chat (partial)

**Date:** 2026-10-16. **Branch:** `chore/doc-gen-baseline` (no PR).
**Setup:** the Souvenir front-end on `localhost:3000` (app commit `c7dcd12f`, app code unchanged) talking to the shared dev backend `https://devapi.getsouvenir.com`, driven by the harness in `scripts/doc-gen-loop/`. Account default model; the stream names it only as the preset **"Advanced"**, never the underlying model.
**Raw data:** [`runs.jsonl`](runs.jsonl), one line per run. Screenshots in [`pass-1/`](pass-1/), generated files and page-1 previews in [`pass-1/files/`](pass-1/files/).

## Coverage

Pass 1 was stopped part-way, at Chai's request, to look at the generated documents first. **7 of 16 prompts completed**, including all four that ask for a file:

| Done | Not run yet |
|---|---|
| 01a, 01b (brainstorm), 02a (email), 04b (PRD as Word), 06b (vendor form), 07b (contract template), 08b (JSON file) | 02b (memo), 03a, 03b (blog/essay), 04a (short PRD), 05a, 05b (tables), 06a (checklist), 07a (invoice), 08a (inline JSON) |

11 records in total. Of those that didn't complete:
- 2 never left the browser: `/chat` failed to load (`net::ERR_ABORTED`) during a devapi outage.
- 2 got an immediate 502 from devapi, which was down (its own gateway returned `502 Bad Gateway`).
- 1 (04b, first attempt) produced its file, but the harness failed on the preview step. The file was recovered from the chat afterwards.

No run hit a 401/403, and the stream carried no `RUN_ERROR` frames. Seven `[loop-test]` chats exist in the account.

## Results

| Run | Format | First text | Total | Output | Against the prompt |
|---|---|---|---|---|---|
| 01a | Brainstorm, simple | 12.5 s | 15.8 s | Inline numbered list | 10 of 10 names |
| 01b | Brainstorm, demanding | 13.2 s | 25.3 s | Inline, grouped by effort, a risk under each idea | 25 of 25, all three groups, a risk each |
| 02a | Email, simple | 15.5 s | 17.9 s | Inline subject + body | About 35 words, under the 80 asked; it loaded an "email" skill to do it |
| 04b | PRD, Word file | 88.7 s | 92.5 s | `Fieldnote_Offline_Mode_PRD.docx`, with file card | 843 words, about 2 pages; every section asked for |
| 06b | Vendor form, Word file | 78.3 s | 82.3 s | Word file, **text link only, no file card** | All five sections, field types, required markers |
| 07b | Contract template, Word file | 92.3 s | 96.0 s | `freelance-design-services-contract-template.docx`, with file card | 1,040 words; 8 clauses; `{{PLACEHOLDER}}` fields |
| 08b | Order, JSON file | 36.7 s | 39.9 s | `.json`, **text link only, no file card** | Valid, and fits the given schema exactly |

The generated files and page-1 previews (`*.page1.png`) are in [`pass-1/files/`](pass-1/files/).

## Findings, by tomorrow's design list

### 1. Chat outputs

- **Inline answers are good.** Short formats (list, grouped brainstorm, email) come back in 15–25 s, follow the prompt exactly, and read cleanly. Bold lead-ins and italic "Risk:" lines in 01b are well judged.
- **Even a two-line email loads a skill.** 02a shows "1 action completed · Loading skill — email" above the answer. That's overhead in the UI for the simplest output.

### 2. Chat document experience

- **Two of the four files had no file card.** 04b and 07b showed the file chip with **View** and **Download**. 06b and 08b only had a "Download the…" link inside the reply text. The backend sent no `generated_file` event for those two, so the app never knew a file existed. Same request type, two different outcomes.
- **The file chip's type is generic.** Both Word files arrived as `application/octet-stream`; the chip relies on the file extension to show "DOCX".
- **"View" doesn't preview a Word file.** It opens the raw storage URL in a new tab, which downloads rather than showing the document. The harness saw a blank tab. There is no in-app document preview.

### 3. Thinking states

- **File generation means a long, opaque wait: 37 s for JSON, 78–92 s for Word files** before any text appears.
- **What's on screen during that wait** is a chain of status lines, for example in 04b:

  > "Souvenir" (8 s) → "Thinking · Preparing document creation" → "Loading skill" → "Running tool" (51 s) → "Running sandbox command" (15 s) → "Ran 4 actions — Loading skill, Running tool, Running sandbox command" → "Thought for 1m 18s"

  The reasoning headings are model-written ("Designing a secure form", "Considering document attachments", "Exploring validation methods"). The action labels are system terms ("Running sandbox command", "Running tool").
- **Nothing shows progress, or what the document will look like,** until the very end. The backend never sends its `docx_progress` event, so the app's document-progress UI never appears.
- **Every reply opens with "Souvenir" for 8–10 s** before anything else, even for a 10-item list.

### 4. Preview (the documents themselves)

The content and structure are strong: tables where they help, numbered clauses, call-out boxes, and placeholders done properly. The styling has no system behind it. For each file the model writes `python-docx` code and runs it in a sandbox, so it picks styles every time.

**Stable across all three Word files:**

| | Value |
|---|---|
| Fonts | Aptos (body) and Aptos Display (titles, headings) |
| Main colour | Navy `#17324D` |
| Body size | 9 pt |
| Title | 22–24 pt bold |
| H1 | 13.5–14 pt bold |
| Page | US Letter, never A4 |

**Drifting from file to file:**

| | PRD | Vendor form | Contract |
|---|---|---|---|
| Accent | `#287271` | `#2D5F73` | `#16858C` |
| Body text colour | Black | Black, with greys `#52606D` / `#6B7280` | `#24313B` |
| Margins | 0.55 / 0.65 in | 0.55 / 0.65 in | 0.72 / 0.82 in |
| Smallest text | 8 pt | 7.5 pt | 8 pt |

**Problems with the styling:**
- **9 pt body and 7.5 pt labels are too small** for print or a shared document.
- **Aptos only ships with recent Microsoft Office** and isn't embedded. Pages, Google Docs, macOS Preview and older Word substitute it; on this Mac it rendered as a Times-like serif. So the same file looks different depending on where it's opened. (The page-1 previews here are from Quick Look and show that substitute serif, not Aptos.)
- **Small defects:** a stray empty box "☐" above "Functional requirements" in the PRD.
- **Mismatched metadata:** "Microsoft Macintosh Word 14" with author "python-docx", "Souvenir" or "Fieldnote Product".

### 5. Output permutations

- **Two ways files reach the chat today:** a file card (from the backend's file event), or a plain link in the reply. They should be one.
- **Only two output types appeared:** inline Markdown, or a file. No inline document card or in-chat rendering of the file has been seen yet.
- **Not covered yet:** the 9 inline formats that haven't run (tables, essays, the short PRD, the invoice, inline JSON).

## Harness notes

- **Fixed during the pass:**
  - a fresh browser context per run, and an aborted `/chat` load is retried before anything is sent (`ERR_ABORTED`)
  - an unparseable preview URL no longer fails the run (`Invalid URL` on 04b)
  - resume skips finished runs, and keeps the 2-minute spacing across restarts
- **The thinking-text sampler reads each label twice**, once with its "Thinking ·" prefix and once without. Treat them as one label when reading `runs.jsonl`.
- **Files linked only in text** (06b, 08b) aren't picked up by the harness, because it looks for the file card. They were saved by hand through the app's own `/api/download` route.
- **The `-page.png` screenshots include the account's sidebar,** with its chat titles. Share the `-reply.png` shots and the files instead.

## Next

**Chai decides:** finish the 9 remaining pass-1 prompts (about 20 minutes), then passes 2 and 3, or stop here.
