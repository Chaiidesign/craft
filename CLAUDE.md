@AGENTS.md

# Document-generation build (branch `feat/document-quality`)

@docs/workflow.md

Before implementing anything in this build, read:
- the spec: [docs/souvenir-document-generation-prd.md](docs/souvenir-document-generation-prd.md)
- the current state and next step: [docs/progress.md](docs/progress.md)
- approved decisions: `docs/decisions.md` (once it exists), plus the feature README [docs/documents/README.md](docs/documents/README.md)

Commands:
- Dev / demo: `npx next dev -p 4010`, then http://localhost:4010/document-verify
- Typecheck: `npx tsc --noEmit -p .`
- Lint: `npx eslint src/lib/documents src/components/documents src/app/document-verify scripts/documents next.config.ts`
- Tests: `npx vitest run` (`src/lib/theme.test.tsx` fails, as it did before this build)
- Build: `npx next build --webpack`

Before saying a step is done, all of these hold:
- typecheck, lint, tests and build are clean apart from the known failure
- the change was exercised in a browser at phone and desktop widths
- the step report lists the new user-facing text with exact wording
- `docs/progress.md` is updated, and the work is committed and pushed to the feature branch
