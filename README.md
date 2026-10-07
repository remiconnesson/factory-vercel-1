# Software factory on Vercel

Triage → Spec → Implement → Review, driven by GitHub labels and run on Vercel Workflow, Vercel Sandbox,
AI Gateway, Vercel Connect, the AI SDK fx harness, libfx and GitHub Tools.

| Label / event        | Station   | What it does                                                    | Next                                |
| -------------------- | --------- | --------------------------------------------------------------- | ----------------------------------- |
| issue opened         | Triage    | Checks the issue, flags questions                               | `ready-to-spec` or `needs-info`     |
| `ready-to-spec`      | Spec      | Writes `specs/<n>/PRODUCT.md` and `TECH.md`, opens a draft PR   | a human applies `ready-to-implement` |
| `ready-to-implement` | Implement | Implements the specs, runs the verification, marks the PR ready | the PR event triggers Review        |
| PR ready / updated   | Review    | Reviews the diff against the specs                              | posts review comments               |

A human merges.

Only `FACTORY_ALLOWED_USERS` can start the loop: issues opened by anyone else are ignored, `ready-to-implement`
must come from an allowed user, the factory's bot may only continue a chain an allowed user started, and PRs from
forks never trigger a station. To take an outsider's issue, an allowed user applies `ready-to-spec` to it.

## Design rules

- Agents never write to GitHub. Deterministic workflow steps do every write (commits, PRs, labels, comments).
- Triage and Review run in-process (libfx) with read-only GitHub tools. Spec and Implement run fx inside a
  Vercel Sandbox through `@ai-sdk/harness-fx`.
- No secret enters the sandbox. The AI Gateway credential and a short-lived read-only GitHub token are
  injected by the sandbox firewall; the GitHub rule is removed as soon as the clone and install finish.
- The sandbox never gets write authority: the host commits through the Git Data API, enforcing allowed and
  protected paths (`.github/`, lockfiles).

## Layout

```
app/api/github/webhook/route.ts   # HMAC check, label state machine → start()
factory/stations/*.md             # one prompt template per station (bundled at build time)
lib/                              # host-only code: GitHub, Connect tokens, libfx, harness, sandbox, commit
workflows/steps.ts                # the step boundary: lazy-loads lib/ inside "use step" bodies
workflows/{triage,coding-station,review}.ts
scripts/verify                    # definition of done for Implement (the orchestrator re-runs it)
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
| `FACTORY_ALLOWED_USERS` | Comma-separated GitHub logins allowed to trigger stations. Empty: every event is ignored |
| `FACTORY_MODEL`         | Optional AI Gateway model ID (default `anthropic/claude-opus-5.5`)               |
| `FACTORY_CONNECTOR`     | Optional Vercel Connect connector UID (default `github/factory`)                 |
| `AI_GATEWAY_API_KEY`    | Optional. Without it the project's Vercel OIDC token authenticates to AI Gateway |

GitHub access comes from a Vercel Connect GitHub connector (`vercel connect create github --name factory`),
with its GitHub App installed on the target repository only. Tokens are minted at runtime via OIDC.

The target repository needs the labels `ready-to-spec`, `needs-info`, `ready-to-implement`,
`factory:running` and `factory:blocked`, a webhook to `https://<app>/api/github/webhook`
(`application/json`, Issues and Pull requests events), a ruleset on the default branch that requires a
reviewed pull request, and an executable `scripts/verify`.

## Development

```sh
pnpm install
vercel link && vercel env pull   # OIDC token for Connect, Sandbox and AI Gateway
pnpm dev
pnpm verify                      # lint + type-check
```
