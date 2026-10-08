<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Factory conventions

- Workflow files (`workflows/*.ts` with `"use workflow"`) may import only `@/lib/config`, `@/lib/stations` and
  `./steps`. Anything else ends up in the workflow VM bundle, which has no Node.js and fails on load.
- New steps go in `workflows/steps.ts` and load their host module with `await import(...)` inside the step body.
- Only the Dev (Implement) agent gets GitHub write access: pushing its own `factory/issue-<n>` branch and editing its PR,
  brokered by the sandbox firewall (`lib/github-access.ts`) and confined by the repo's rulesets. Every other GitHub
  write happens in orchestrator steps (`lib/github.ts`, `lib/commit.ts`).
- Business rules are Cedar policies in `core/rules/*.cedar`, each named with `@id("...")`; the name is the reason
  users see. Don't encode a rule in TypeScript: add or change a policy and its row in `core/questions.test.ts`.
- `core/` is pure: no I/O and no imports from `lib/`, `proofs/`, `workflows/` or `app/` (lint enforces it).
- Proofs (`@gdp-ts/core`) are made only in `proofs/`. A function that does something the rules must allow takes the
  proof as an argument; add the mistake it prevents to `test/mistakes.ts`.
- Cedar is wasm: import `core/decide.ts` (and anything that uses it) from host code only, never from workflow files.
- Station prompts live in `factory/stations/*.md`, skills in `factory/skills/`; `pnpm bundle` regenerates the
  generated JSON for stations, skills and rules (`dev`, `build`, `typecheck` and `test` run it first).
- `./scripts/verify` must pass before a change is done.
