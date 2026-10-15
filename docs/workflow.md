# Working protocol — document-generation build

Standing protocol for the Souvenir document-generation build (branch `feat/document-quality`). Follow it for the whole project. The reasoning behind it is in [ai-build-playbook.md](ai-build-playbook.md).

1. **The repo is the single source of truth.** Specs, decisions and reports are committed files. Chat is conversation only, never storage. Nothing exists only on Chaitanya's Mac or in Messages.
2. **Layout.**
   - `docs/` holds the specs and this file. The product spec is [souvenir-document-generation-prd.md](souvenir-document-generation-prd.md).
   - `docs/decisions.md` records every approved decision: numbered, dated, newest first.
   - `docs/reports/step-N.md` holds one report per step.
   - `docs/progress.md` holds the current branch, what works, what's unfinished and the next step.
3. **Per step:** implement, verify, and write the step report to `docs/reports/`. Commit and push checked work to the feature branch at every meaningful checkpoint. Instinct's verdicts gate merge and release, not saving work. When verdicts arrive, record them in `decisions.md`, apply them, and commit and push again. Never describe an unreviewed change as approved.
4. **Instinct reads this repo through Chaitanya's connected GitHub after each push.** Write reports and decisions as the permanent record: full context, never "as discussed in chat".
5. **New user-facing text** is listed in the step report with its exact wording, and approved before merge.
6. **Never let the only copy of anything live outside the repo.**

A commit saves a revision locally; a push puts it on GitHub; a merge brings it into the main line; a deployment releases it. These are different events, and only merge and release wait for approval.
