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
