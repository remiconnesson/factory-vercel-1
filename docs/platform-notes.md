# Platform notes

Behavior of the platforms and packages this factory depends on, verified while building it (October 2026). Each item
says what to do about it. `pnpm check <name>` re-verifies the ones marked with a check.

## Vercel Connect (GitHub)

- **`scopes` is ignored for GitHub App tokens.** A token minted with `scopes` carries the app's full permission set,
  so a "read-only" token can write and a token "without workflows" can push `.github/workflows/`. Narrow tokens with
  `authorizationDetails: [{ type: 'github_app_installation', repositories, permissions }]` (`lib/github.ts`).
  Check: `pnpm check tokens`.
- **The permission format is `name:level`** (`contents:read`). `name=level` is silently ignored and the token gets
  full permissions again, so a typo fails open. `pnpm check tokens` catches it.
- **Tokens need a project OIDC token.** Locally that's `VERCEL_OIDC_TOKEN` from `vercel env pull`. It expires after
  about 12 hours and `@github-tools/sdk` doesn't refresh an env token (error `OIDC_TOKEN_EXPIRED`): pull again.
- **The CLI only mints `development` OIDC tokens**, even with `vercel env pull --environment production`, so anything
  that depends on a token's environment can behave differently locally and on a deployment.

## Vercel API and CLI

- **The Vercel CLI rejects project-scoped tokens.** Every command first loads the user (`/v2/user`), which answers
  404 for a project token (CLI 59 and 62). Agents therefore use the REST API with `curl` (`vercel-debug` skill).
- **A project-scoped token reaches only its project** (other projects answer 404), but inside it, it can do
  everything: read env vars, read the project's protection bypass secrets, deploy. Only the sandbox firewall
  restricts what the agents can do with it (`lib/vercel.ts`).
- **Logs available with a project token:** build logs (`GET /v3/deployments/{id}/events`) and the live runtime-log
  tail (`GET /v1/projects/{id}/deployments/{id}/runtime-logs`). Request logs (`vercel.com/api/logs/request-logs`)
  answer 403. The runtime-log stream sends nothing, not even headers, until the deployment writes a line.
- **The API sometimes answers 403 for a valid project token.** A retry seconds later succeeds. Code that calls the
  API should retry once before treating a 403 as final.
- **`vercel curl` changes the project.** If the project has no "Protection Bypass for Automation" secret, it creates
  one (`PATCH /v1/projects/{id}/protection-bypass`), then reads it from the project API to call the deployment.
- **Production and Preview env vars can be forced to "sensitive"** by team policy (they can't be read back), and env
  var changes apply only to new deployments: redeploy after changing one.

## Vercel Sandbox

- **The firewall can inject headers on Vercel-hosted domains:** `x-vercel-protection-bypass` on a preview host
  opens a protected preview. An injected `x-vercel-trusted-oidc-idp-token` does not work from a sandbox, although
  the same header works from a normal machine. Check: `pnpm check vercel`.
- **Rules are matched in order** and a trailing `response` rule answers what earlier rules didn't claim. That's how
  `lib/vercel.ts` and `lib/github-access.ts` turn a host into an allowlist.
- **Pushes can't be filtered by the firewall:** it sees the git endpoint, not which branch a push updates. GitHub
  rulesets do that part.

- **Sandboxes are persistent by default.** `stop()` snapshots the filesystem; the next `Sandbox.get({ name, resume:
  true })` (or any command) resumes it. Resuming a missing sandbox fails with 404, and one whose snapshot expired with
  410 `snapshot_not_found`: delete it and create a new one (`ensureSandbox` in `lib/sandbox.ts`). Use
  `keepLastSnapshots` to keep one snapshot per sandbox instead of one per stop, and `delete({ deleteOrphanSnapshots:
  true })` to remove the snapshots with the sandbox.

## AI SDK harness (fx)

- **The harness refuses to start a session if the sandbox policy holds credential-injecting rules it didn't add.**
  Start each session on plain lockdown, then add the other rules (`runAgentSlice` in `lib/sandbox.ts`).
- **fx runs with its own HOME** (`~/.ai-sdk-harness/.harness-bootstrap/fx/implementation/home`), so anything cached
  under the default HOME is invisible to it. Every orchestrator command in the sandbox uses the agent's HOME.
- **fx isn't on `PATH`.** The harness installs it into the template and calls it by path.
- **The `skills` option writes every skill file through the sandbox API, one call per file, in every new sandbox.**
  Fine for small skills; for hundreds of files, bake them into the template in `onBootstrap` instead.
- **The Vercel plugin has no fx integration** (`npx plugins add vercel/vercel-plugin` targets other agents). Its
  Agent Skills folders are portable; its hooks, commands and sub-agents are not.

## Vercel Workflow

- **Workflow functions run in a VM without Node.js, and the bundle keeps every module a workflow file imports.** A
  top-level import of `@vercel/sandbox`, Connect or Octokit makes every run fail with `require is not defined`; the
  build only prints a "Serde warning". See `workflows/steps.ts`.

## Cedar (`@cedar-policy/cedar-wasm`)

- **A policy scope names one principal or resource; only `action` takes a list.** `principal in [A, B]` in the scope
  fails to parse ("expected single entity uid or template slot, found set of entity uids"); put it in `when`.
- **Policy ids come from the policy set, not from `@id`.** `isAuthorized` reports the ids of the policies that
  decided, so `scripts/bundle.mjs` passes the policies as a map keyed by their `@id` annotation.
- **With `validateRequest`, an entity attribute or context key the schema doesn't declare fails the request**
  ("attribute `number` … should not exist according to the schema"). TypeScript lets richer objects through, so
  `core/questions.ts` copies fields one by one. The first real merge found this; the tests now pass richer objects.
- **A deny with no matching permit has no reason.** Only a matching `forbid` names itself; explaining a missing permit
  is up to the caller (see `lib/handlers.ts`).
- **Use the `nodejs` build and keep it external** (`serverExternalPackages` in `next.config.ts`), so Next.js traces
  the `.wasm` file into the functions that need it instead of bundling it. Never import it from a workflow file.

## evlog

- **`defineNodeInstrumentation` (from `evlog/next/instrumentation`) breaks on Vercel.** It loads its Node half with an
  import the bundler is told to ignore, so file tracing never ships `evlog` and every request fails loading the
  instrumentation hook ("Cannot find package 'evlog'"); it works locally because `node_modules` is there. Import
  `createInstrumentation` from `evlog/next/instrumentation/create` yourself (`instrumentation.ts`). To catch this class
  of bug before deploying, run `next build && next start` and send a request, or grep `.next/server` for
  `import("evlog`.
- **`captureOutput` re-captures evlog's own events** from stdout and nests each one, escaped, in another event's
  `message`. Leave it off.
- **The default redaction masks emails and any digit run that passes the card checksum** (`4111111111111111` →
  `****1111`), which can hit numeric IDs, and adds nothing for GitHub tokens or Basic auth. Pick builtins and add
  patterns explicitly (`lib/log-config.ts`).
- **`vercel logs --json` returns one record per invocation**, with one log line per entry in `logs[]`; a workflow
  invocation can run several steps, so one record can hold several events.

## GitHub

- **Rulesets and branch protection on private repos need GitHub Pro, Team or Enterprise.** Free accounts and free
  orgs get them on public repos only.
- **A ruleset that restricts updates on `~ALL` branches also blocks merging PRs into `main`** ("Cannot update this
  protected ref"). Exclude `~DEFAULT_BRANCH` and let `main`'s own ruleset protect it.
- **Without the `workflows` permission, GitHub refuses App pushes that touch `.github/workflows/`.** With it, a
  pushed workflow runs on the `push` event. Check: `pnpm check dev`.
- **A PR can't be opened for a branch with no commits beyond the base.**
- **Webhooks fire for changes made by GitHub Apps** (labels, PRs), so the factory's own actions come back as events.

## Packages and tooling

- **The `@ai-sdk/harness*` packages are pinned** to a consistent set (`1.0.139`, harness-fx `1.0.53`), and `ai` must
  equal the version the harness depends on (`7.0.128`), or TypeScript reports incompatible `StopCondition` types.
  Upgrade them together. Some registries enforce a minimum release age and reject releases from the last day or two.
- **`libfx` ships without TypeScript declarations**: `types/libfx.d.ts` follows its README.
- **pnpm needs explicit `allowBuilds`** for `esbuild`, `@swc/core` and `cbor-extract` (`pnpm-workspace.yaml`), and
  Vercel needs `ENABLE_EXPERIMENTAL_COREPACK=1` to build with the pinned pnpm version.
- **`tsx` loads `lib/*.ts` as CommonJS** here (no `"type": "module"`), which breaks ESM-only subpaths such as
  `@github-tools/sdk/connect`. `pnpm check` bundles checks with esbuild instead.
