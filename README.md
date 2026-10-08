# Software factory on Vercel

Triage → Spec → Implement → Review, driven by GitHub labels and run on Vercel Workflow, Vercel Sandbox,
AI Gateway, Vercel Connect, the AI SDK fx harness, libfx and GitHub Tools.

| Label / event        | Station   | What it does                                                    | Next                                |
| -------------------- | --------- | --------------------------------------------------------------- | ----------------------------------- |
| issue opened         | Triage    | Checks the issue, flags questions                               | `ready-to-spec` or `needs-info`     |
| `ready-to-spec`      | Spec      | Writes `specs/<n>/PRODUCT.md` and `TECH.md`, opens a draft PR   | a human applies `ready-to-implement` |
| `ready-to-implement` | Implement | Implements the specs, runs the verification, marks the PR ready | the PR event triggers Review        |
| PR ready / updated   | Review    | Reviews the diff against the specs, gives a verdict             | `factory:changes-requested` or done |
| `factory:changes-requested` | Implement (revision) | Addresses the latest review, pushes, re-verifies       | marks the PR ready → Review again   |

Review and Dev go back and forth up to 3 rounds, then a human takes over. A human merges; an
allowed user can also send a PR back to Dev by applying `factory:changes-requested`.

Each issue has one sandbox for its whole life: Spec creates it, Implement and every revision reuse it (checkout and
dependencies included), each run ends by stopping it, which snapshots its filesystem, and it's deleted when the PR is
merged.

Only `FACTORY_ALLOWED_USERS` can start the loop: issues opened by anyone else are ignored, `ready-to-implement`
must come from an allowed user, the factory's bot may only continue a chain an allowed user started, and PRs from
forks never trigger a station. To take an outsider's issue, an allowed user applies `ready-to-spec` to it.

## Design rules

- Only the Dev (Implement) agent writes to GitHub, and only to its own branch and PR: it pushes so its work builds a
  Vercel preview it can test, and reads CI results and review comments. Deterministic workflow steps do every other
  write (Spec's commit, PR creation, labels, comments, marking the PR ready).
- Triage and Review run in-process (libfx) with read-only GitHub tools. Spec and Implement run fx inside a
  Vercel Sandbox through `@ai-sdk/harness-fx`.
- No secret enters the sandbox. The AI Gateway credential and a short-lived read-only GitHub token are
  injected by the sandbox firewall; the GitHub rule is removed as soon as the clone and install finish.
- Dev's GitHub token stays on the host too: the firewall injects it on this repo's git endpoints and a few API calls
  only (`lib/github-access.ts`, `github-dev` skill). GitHub enforces what the firewall can't see: rulesets confine bot
  pushes to `factory/**` branches and keep `main` behind reviewed PRs, and the token has no `workflows` scope. Spec's
  changes are committed by the host through the Git Data API, only if the rules allow every path; for Dev, the
  orchestrator checks the PR's whole diff against the same rules (no `.github/`, no lockfiles)
  before marking it ready.
- Sandbox agents get read-only Vercel access to the project through the `vercel-debug` skill (`factory/skills/`):
  deployments, build logs, runtime logs and requests to the branch preview and production. The project-scoped
  `FACTORY_VERCEL_TOKEN` and the automation bypass stay on the host; the firewall adds them only to the GET
  endpoints in `lib/vercel.ts` and to the project's own hosts, and answers 403 to everything else.

## Business rules: functional core, imperative shell

Who may start what, what each agent may reach and change, and when the orchestrator may act are
[Cedar](https://www.cedarpolicy.com) policies, kept apart from the code that talks to GitHub, Vercel and sandboxes:

| Rules                            | Decide                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `core/rules/triggers.cedar`      | who may start each station (allowed users, the bot continuing their chains, no forks) |
| `core/rules/agents.cedar`        | which sandbox station may read Vercel or push, and which paths each may change     |
| `core/rules/orchestrator.cedar`  | when a PR may be marked ready, sent back to Dev (3 rounds) or its sandbox deleted  |

Each policy's `@id` is its name, and the name is the reason the factory reports when a rule refuses something
("Spec is blocked: … `app/page.tsx` (Spec changes only specs)"). `pnpm bundle` validates the policies against
`core/rules/factory.cedarschema` and fails the build on an error, an unnamed policy or a duplicate name.

The code follows [gdp-ts](https://github.com/rauchg/gdp-ts) (Ghosts of Departed Proofs) in three layers:

- **Core** (`core/`): pure. Turns a webhook payload into a trigger, asks the rules a question, returns a decision. No
  I/O and no shell imports (lint enforces both); tested as a decision table in `core/*.test.ts`.
- **Proofs** (`proofs/`): the only place a proof can be made. Each module gathers the facts it needs, asks the core,
  and returns a proof about the exact values it checked, or `null`.
- **Shell** (`lib/`, `workflows/`, `app/`): does the I/O. Every sensitive function demands a proof as an argument:
  starting a station, firewall rules for Vercel or GitHub push, committing Spec's changes, marking a PR ready,
  sending it back to Dev, deleting a sandbox. Forgetting a check or using a proof about another value doesn't
  compile; `test/mistakes.ts` keeps a list of such mistakes that must keep failing to type-check.

`lib/handlers.ts` holds the decision points the workflow steps call: name the values, obtain the proof, act or
report why not. Cedar runs as wasm on the host only: workflow files never import it.

## Layout

```
app/api/github/webhook/route.ts   # HMAC check → core/events trigger → MayStart proof → start()
core/rules/*.cedar                # the business rules, with their schema
core/{events,questions}.ts        # pure: payload → trigger; questions to the rules → decisions
proofs/*.ts                       # the only modules that may make proofs
factory/stations/*.md             # one prompt template per station (bundled at build time)
factory/skills/*/SKILL.md         # skills for the sandbox agents: vercel-debug, github-dev
lib/                              # host-only code: GitHub, Connect tokens, libfx, harness, sandbox, commit
lib/handlers.ts                   # decision points: obtain the proof, then act
workflows/steps.ts                # the step boundary: lazy-loads lib/ inside "use step" bodies
workflows/{triage,coding-station,review,cleanup}.ts
scripts/bundle.mjs                # bundles stations, skills and rules (validated) into generated JSON
scripts/verify                    # bundle, lint, type-check, tests
test/mistakes.ts                  # code that must not compile
```

Workflow functions run in a VM without Node.js, and the workflow bundle keeps every module a workflow file
imports. Workflows therefore import only `lib/config.ts`, `lib/stations.ts` and `workflows/steps.ts`; every
step in `steps.ts` loads its host module with a dynamic `import()`, which the workflow build strips.

## Configuration

| Env var                 | Value                                                                            |
| ----------------------- | -------------------------------------------------------------------------------- |
| `GITHUB_WEBHOOK_SECRET` | Random string, also set on the GitHub webhook                                    |
| `FACTORY_OWNER`         | Target repository owner                                                          |
| `FACTORY_REPO`          | Target repository name                                                           |
| `FACTORY_VERCEL_TOKEN`  | Optional. Project-scoped Vercel token for the vercel-debug skill (sensitive)       |
| `FACTORY_VERCEL_TEAM_ID`, `FACTORY_VERCEL_PROJECT_ID` | The target's Vercel team and project, for the vercel-debug skill |
| `FACTORY_ALLOWED_USERS` | Comma-separated GitHub logins allowed to trigger stations. Empty: every event is ignored |
| `FACTORY_MODEL`         | Optional AI Gateway model ID (default `anthropic/claude-opus-5.5`)               |
| `FACTORY_CONNECTOR`     | Optional Vercel Connect connector UID (default `github/factory`)                 |
| `AI_GATEWAY_API_KEY`    | Optional. Without it the project's Vercel OIDC token authenticates to AI Gateway |

GitHub access comes from a Vercel Connect GitHub connector, created from the factory's linked project with
`vercel connect create github --name <name>` and set as `FACTORY_CONNECTOR=github/<name>`. Its GitHub App is
installed on the target repository only. Tokens are minted at runtime through the project's OIDC token and narrowed
to one repo and explicit permissions (`lib/github.ts`).

## Setting up a target

The factory works on one target repo and its Vercel project, never on itself.

1. **Repo:** public, or on GitHub Pro/Team/Enterprise (rulesets). It needs pnpm with a committed lockfile, an
   executable `scripts/verify` (lint, type-check, tests), dependencies from the public npm registry only (the sandbox
   can't reach anything else), and an `AGENTS.md` with its conventions.
2. **GitHub App:** add the repo to the connector's GitHub App installation (repository access).
3. **Labels:** `ready-to-spec`, `needs-info`, `ready-to-implement`, `factory:running`, `factory:blocked`,
   `factory:changes-requested`.
4. **Webhook:** `https://<factory>/api/github/webhook`, `application/json`, Issues and Pull requests events, secret
   `GITHUB_WEBHOOK_SECRET`.
5. **Rulesets** (admin role may bypass):
   - default branch: require a pull request with a code-owner review, block force-pushes and deletion;
   - branches `~ALL` excluding `~DEFAULT_BRANCH` and `refs/heads/factory/**`: restrict creation, update, deletion;
   - tags `~ALL`: restrict creation, update, deletion.
   Plus a `CODEOWNERS` naming the human reviewers.
6. **Vercel project** connected to the repo, so every push builds a preview. Create a project-scoped token for it,
   and a "Protection Bypass for Automation" secret (the factory injects it on the project's own hosts).
7. **Factory env vars:** `FACTORY_OWNER`, `FACTORY_REPO`, `FACTORY_VERCEL_PROJECT_ID`, `FACTORY_VERCEL_TOKEN`, then
   redeploy the factory.
8. **Check it:** `pnpm check tokens`, `pnpm check sandbox`, then `pnpm check e2e`.

## Checks and debugging

`pnpm check <name>` runs a check from `checks/` against the configured target, with the real `lib/` code and
real sandboxes (it needs `.env.local` from `vercel env pull`, and `FACTORY_VERCEL_TOKEN` for Vercel access):

| Check | What it proves |
| --- | --- |
| `tokens` | GitHub tokens reach only the target and are narrowed: the read token can't write |
| `sandbox` | Template with fx, brokered clone, lockdown, AI Gateway brokering, no secret in the sandbox, an agent turn, verify |
| `vercel <branch>` | The vercel-debug allowlist: allowed endpoints, blocked ones, the protected preview, no secret in the sandbox |
| `dev` | Dev push/PR access on a throwaway branch: pushes, what GitHub and the firewall refuse, cleanup |
| `deliveries` | Recent webhook deliveries and why the factory started or ignored each one |
| `cleanup <factory-url>` | On the deployed factory: a merged PR deletes its issue's sandbox, an unmerged one keeps it (needs `FACTORY_WEBHOOK_SECRET`) |
| `e2e` | Opens a test issue and follows it through every station (`--cleanup <issue>` closes it afterwards) |

See [docs/platform-notes.md](docs/platform-notes.md) for platform behavior these checks guard against, and
[docs/decisions.md](docs/decisions.md) for why the factory works the way it does.

## Development

```sh
pnpm install
vercel link && vercel env pull   # OIDC token for Connect, Sandbox and AI Gateway
pnpm dev
pnpm verify                      # bundle + lint + type-check + tests
pnpm check tokens                # see "Checks and debugging"
```
