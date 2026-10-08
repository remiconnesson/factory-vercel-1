# Decisions

Why the factory is built the way it is, newest last. Each entry is short on purpose: the context, the decision, and
what it costs.

## Step boundary module instead of `'use step'` in `lib/`

The tutorial put `'use step'` functions in modules that import Sandbox, Connect and Octokit at the top level. The
workflow VM bundles every module a workflow file imports and has no Node.js, so every run failed on load.
**Decision:** workflows import only `lib/config`, `lib/stations` and `workflows/steps.ts`, whose steps load host code
with `await import()`. **Cost:** one wrapper per step.

## AI Gateway: OIDC fallback instead of a required API key

The project's OIDC token authenticates to AI Gateway, so no key has to be created or rotated. `AI_GATEWAY_API_KEY`
still wins when set.

## One HOME for the agent and the orchestrator

fx runs with its own HOME, so what setup cached was invisible to it (the agent couldn't run `./scripts/verify`).
Pinning a package-manager version in the template would have fixed one symptom for one repo. **Decision:** every
orchestrator command in the sandbox runs under the agent's HOME, so the environment the orchestrator verifies is the
agent's.

## Who may trigger the factory

The repos are public, so anyone could open an issue and start a sandbox run. **Decision:** only
`FACTORY_ALLOWED_USERS` can start a chain; the factory's bot may continue a chain an allowed user started;
`ready-to-implement` must come from an allowed user; fork PRs never trigger anything. An allowed user can opt in an
outsider's issue by applying `ready-to-spec`.

## Vercel access: our own skill, not the Vercel plugin

The plugin's skills are general Vercel knowledge, and several tell the agent to use the Vercel CLI, which can't run
in the sandbox. **Decision:** removed them; the `vercel-debug` skill teaches exactly the endpoints the agent can use.

## Vercel access: a project-scoped token, not the project's OIDC token

Both reach one project. The OIDC token is the project's whole identity (AI Gateway, Connect, Sandbox), so injecting
it would let an agent mint GitHub tokens through Connect. **Decision:** inject the project-scoped token, and only on
four read-only GET endpoints (`lib/vercel.ts`). **Cost:** one secret to rotate per target.

## Vercel access: `curl`, not the Vercel CLI

The CLI rejects project-scoped tokens (see platform notes), and with a broader token `vercel curl` would read the
project's bypass secret into the sandbox. **Decision:** plain REST calls; the firewall injects the bypass header only
on the project's own preview and production hosts.

## Dev pushes its own branch

Without pushes, the agent could only test locally: previews exist for pushed commits only. **Decision:** the Dev
token is injected by the firewall on this repo's git endpoints and a short API allowlist (`lib/github-access.ts`).
GitHub enforces what the firewall can't see: rulesets keep bots on `factory/**` branches and off tags, `main`
requires a reviewed PR, and the token has no `workflows` permission. **Cost:** protected paths (`.github/`,
lockfiles) are checked after the fact, on the PR's diff, instead of being filtered before the commit; a preview has
already built by then.

## Dev doesn't create PRs

A non-draft PR opened by the agent would start Review on every push. **Decision:** the orchestrator makes sure Dev's
PR exists and is a draft before Dev starts, and marks it ready after verifying. Dev can read and edit it.

## Separate target project

While the factory worked on its own repo, Vercel built previews of agent-pushed code with the factory's Preview env
vars (its secrets). **Decision:** the factory targets another repo and Vercel project; previews of agent code get the
target's env vars only.

## Public repos

Free GitHub plans allow rulesets on public repos only, and the push model depends on rulesets. **Decision:** both
repos are public, after a scan of the factory's full history for secrets. A private target needs GitHub Pro, Team or
Enterprise.

## One sandbox per issue, deleted on merge

Review and Dev need to go back and forth on a PR, and re-cloning and re-installing for every round wastes minutes.
**Decision:** each issue gets a sandbox named after the repo and issue. Every run resumes it, resets the checkout to
what's on GitHub, and stops it at the end (stopping snapshots the filesystem, so an idle sandbox costs storage, not
compute). It's deleted when the PR is merged. A PR closed without merging keeps its sandbox until the snapshot expires
(30 days), after which the next run starts fresh. **Cost:** one stored snapshot per open issue.

## Review sends the PR back to Dev

**Decision:** Review returns a verdict. "Changes requested" adds `factory:changes-requested`, which starts a revision
run of Dev on the issue's sandbox with the latest review in its prompt (`factory/stations/revise.md`). Dev's PR goes
back to draft for the revision, so its pushes don't trigger Review, and is marked ready again after verify, which
starts the next review. After three reviews (`core/rules/orchestrator.cedar`), the factory stops and a human decides; an allowed user can
always apply the label to send the PR back.

## Business rules in Cedar, enforced with proofs

The rules were spread over the code: an allow-list check in the webhook, protected and allowed paths in the commit
code, a round counter in the review workflow, and the firewall code deciding who gets push access. Nothing stopped a
new call site from skipping a check. **Decision:** the rules are Cedar policies (`core/rules/`), asked by a pure core
(`core/`); proofs of their answers can be made only in `proofs/` (gdp-ts), and each function that acts on GitHub,
Vercel or a sandbox demands the proof about the exact value it acts on. Cedar rather than TypeScript predicates: the
rules read as rules, are validated against a schema at build time, and name themselves when they refuse something.
**Cost:** a wasm dependency that must stay out of workflow bundles, a `name(...)` scope at each decision point, and
facts (like a PR's changed paths) fetched by the proof modules rather than passed in, so the shell can't hand them
stale ones.

## Wide events with evlog, in the Vercel runtime logs

Debugging a run meant guessing from GitHub comments and stray `console.log` lines. **Decision:** one wide event per
webhook delivery and per workflow step attempt (evlog), with the workflow run ID as the thread from a delivery to every
step it caused; `pnpm check logs <issue>` reads them back as a timeline. Events go to stdout, so the Vercel runtime logs
hold them; no drain yet. **Cost:** the runtime logs' retention limits how far back we can debug, and every step body
gains one `inStep` line.
