# A practical AI-building workflow
Research checked October 14, 2026.

The strongest shared advice is not "write a bigger prompt." Give the agent durable project instructions, work in small slices, and make it prove that each slice works. Use GitHub as the durable shared record, Claude Code as the implementer, and a separate review pass for product/design and technical concerns.

## The corrected protocol

Replace "do not commit or push until Instinct reviews" with:

"Commit and push checked work to the feature branch so it is saved and reviewable. Review happens against that exact pushed revision. Approval gates merge and release, not saving work. Never describe an unreviewed change as approved."

A commit is a local saved revision. A push puts it on GitHub. A merge brings it into the main line. A deployment releases it. These are different events. Have Claude inspect deployment automation: a push can trigger a preview or even production in some repos. Establish a safe feature-branch route before pushing sensitive changes. Do not delete the Drive backup until the exact PRD is verified on the intended GitHub branch.

## The playbook

### 1. One project, one durable home
Keep product specs, decisions, progress and tests in the repo. Chat can explore ideas; any approved decision or implementation instruction that matters later must be recorded before the next dependent change.

Layout:
- CLAUDE.md: short, always-loaded instructions and links/imports.
- docs/workflow.md: the working agreement.
- docs/souvenir-document-generation-prd.md: the product spec.
- docs/decisions.md: decision, date, status (proposed/approved/superseded), reason, link to approval.
- docs/progress.md: current branch, what works, what is unfinished, next step and blockers.
- docs/reports/step-N.md: only the useful evidence per meaningful slice: changes, checks, visual examples, known limits, decisions needed.

Keep the paperwork lighter than the work. Approved product choices belong in decisions; implementation details belong in code, tests and commit messages.

### 2. Make the rules load automatically
docs/workflow.md alone is not loaded at startup. Put a short root CLAUDE.md under version control and include @docs/workflow.md to load the agreement. Point to the current spec and progress file and require reading them before implementation. Link to long reports rather than importing the whole archive. Keep CLAUDE.md under ~200 lines, with the actual install/run/test/build commands, architecture constraints, the review gate and the completion checklist.

### 3. Start every session by getting bearings
Claude identifies the repo, branch, remote and working-tree changes; reads CLAUDE.md, spec, decisions, progress and recent commits; runs baseline checks; reports existing failures before changing anything. The opening question: "What is the current state, what is the next smallest step, and how will you prove it works?"

### 4. Approve a small outcome before a large implementation
Read-only planning first: intended experience, files likely to change, risks, explicit out-of-scope, acceptance checks. Chaitanya decides product behavior, visual direction, copy, privacy and spending. The agent chooses routine implementation details within the approved plan.

### 5. Make proof part of the task
Run the real project checks: lint, typecheck, tests, production build. For UI: run the app, exercise the flow in a browser, inspect screenshots at mobile and desktop widths including error and empty states. For documents: inspect the generated document itself. Reports show commands and outcomes, screenshots, what was not tested, known issues. "Done" without evidence means "not yet verified."

### 6. Save safely, then review the pushed revision
One feature branch and one small PR per coherent outcome. Commit checked increments with descriptive messages; push at meaningful checkpoints and before ending the session. After Claude's own checks, open/update a draft PR with summary, evidence, unresolved decisions and the exact commit - that is the review handoff. Merge/release only after agreed approval. Never treat an old verdict as approval of later changes. Have an engineer set up CI and branch protection; instructions are advisory, not safety locks.

### 7. Keep context fresh, not enormous
One main task per session. Before stopping, update the progress file and push. Start the next session from the repo, not from a pasted account of the previous chat. /clear between unrelated tasks. Consult current docs matching installed framework versions.

### 8. Keep secrets and customer data out of the bridge
The repo contains secret names and fake examples, never real keys, passwords, cookies or customer data. Inspect staged changes before committing. If a secret is committed, revoke/rotate first, then clean history. Payment, auth, data-access and production migration changes need qualified technical review.

### 9. Keep Chaitanya's job small and clear
Delegate repo inspection, implementation, tests, browser checks, reports and draft handoff prep. Chaitanya inspects the product experience, exact customer-facing wording and visual output, approves consequential choices, and tries the main journey before release. He should not carry file paths, remember prior decisions or copy reports between assistants. A pushed PR link and commit identify the review target.

## The tiny repeatable ritual
Start: "Read the repo. Tell me the state, next slice and proof plan."
Finish: "Show what works, show the evidence, save it to the feature branch, and give me the review link. What still needs my decision?"

## Start here: five primary resources, in order
1. Anthropic, Claude Code best practices - https://code.claude.com/docs/en/best-practices
2. Anthropic engineering, Effective harnesses for long-running agents - https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
3. Anthropic, How Claude remembers your project - https://code.claude.com/docs/en/claude-md
4. Vercel, AGENTS.md outperforms skills in our agent evals - https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals
5. Simon Willison, Agentic manual testing - https://simonwillison.net/guides/agentic-engineering-patterns/agentic-manual-testing/

Additional primary sources:
- Simon Willison, First run the tests - https://simonwillison.net/guides/agentic-engineering-patterns/first-run-the-tests/
- Claude Code security and permissions - https://code.claude.com/docs/en/security and https://code.claude.com/docs/en/permissions
- GitHub secret cleanup - https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository
- Karpathy talk summary (April 2026) - https://karpathy.bearblog.dev/sequoia-ascent-2026/
