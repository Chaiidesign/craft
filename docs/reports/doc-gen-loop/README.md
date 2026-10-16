# Doc-generation baseline loop

A baseline of how the real chat generates documents today: the Souvenir front-end on `localhost:3000` (unchanged app code), talking to the shared dev backend `https://devapi.getsouvenir.com` through its local `/api` proxy. Nothing in the app is fixed or changed by this loop. It only records.

**Agreed scope (2026-10-16):** pass 1 only, 16 runs (8 formats, loose to strict, a simple and a demanding prompt each; see [`scripts/doc-gen-loop/matrix.json`](../../../scripts/doc-gen-loop/matrix.json)). Chai decides on passes 2 and 3 after reviewing. The account's default model is used, and the model that answered is recorded per run.

## Safety rules

- Every prompt starts with `[loop-test] `, so the chats can be found and deleted later.
- One run starts at most every 2 minutes. At most 40 runs in total, retries included.
- Any 401 or 403, or being sent back to login, stops the loop at once. `STOPPED.md` says why.
- `touch docs/reports/doc-gen-loop/STOP` stops it. The file is checked before each run and every 5 seconds.
- A failed run is retried once at most, never after an auth error.
- All names in the prompts are fictional. No private data.

## How to run

```bash
node scripts/doc-gen-loop/login.mjs        # once: a visible browser; log in; saves .auth/souvenir.json (gitignored, mode 600)
node scripts/doc-gen-loop/run.mjs --pass 1 # headless; reuses the saved session
```

The saved session holds a login cookie. It is never printed, read back or committed.

## What each run records (`runs.jsonl`, one line per run)

| Field | Meaning |
|---|---|
| `format`, `level`, `prompt` | What was asked |
| `stream.firstByteMs`, `stream.firstTextMs`, `stream.totalMs` | Time to first byte, to first answer text, and to the end of the stream, measured from the send |
| `runErrors` | Every `RUN_ERROR` frame in the stream, which arrives inside an HTTP 200 |
| `httpErrors` | Any 4xx/5xx from the local `/api` routes |
| `toolCalls` | Tool names, in order |
| `model` | From the `model_selected` event |
| `thinkingShown` | Each thinking/activity text seen on screen, with when it first and last appeared (sampled every 250 ms) |
| `reasoningHeadings`, `docxProgress` | The matching stream events, with times |
| `generatedFiles`, `files` | Files produced: name, type, size, whether **View** opened a preview or downloaded instead, and the word count of the file |
| `reply` | Word count, headings, list items, tables and code blocks in the reply, plus a 400-character excerpt |
| `check` | Measured against what the prompt asked for: length, item count, sections, table size, file produced, JSON parses and fits the schema |
| `documentRendered`, `previewOpened` | Whether a document appeared (a file, card, headings or a table) and whether its preview opened |
| `outcome`, `failure` | `ok`, `failed` (timeout, run error, HTTP error, empty) or `halted` |

Screenshots go in `pass-<n>/` for each run: `-page.png` (the screen as seen), `-reply.png` (the whole reply at full height), and `-preview-<i>.png` when a file preview opened. Generated files are saved in `pass-<n>/files/`. `pass-<n>/meta.json` records the app commit that was served.
