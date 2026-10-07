# Issue #1: Health check endpoint (tech spec)

## Context (current code)

- Next.js `16.3.8` App Router. Route handlers live under `app/api/**/route.ts`. The only one today is `app/api/github/webhook/route.ts` (`POST` only).
- `lib/config.ts` reads `FACTORY_OWNER` / `FACTORY_REPO` into `config.owner` / `config.repo` (typed `string` through `!` assertions) and exports `repoFull = \`${config.owner}/${config.repo}\``. The webhook route already imports `repoFull` from `@/lib/config`.
- `next.config.ts` is `withWorkflow({})`. Cache Components is **not** enabled, so the "previous model" route segment config (`export const dynamic`) is still available (see `node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md`).
- Next auto-implements methods in `node_modules/next/dist/server/route-modules/app-route/helpers/auto-implement-methods.js`:
  - Methods that aren't exported get a bare `405` (no `Allow` header).
  - **If `GET` is exported and `HEAD` is not, `HEAD` is served by `GET` (200).**
  - **If `OPTIONS` is not exported, it returns `204` with an `Allow` header.**
  
  Because of this, exporting only `GET` would violate "any other method returns 405" for `HEAD` and `OPTIONS`, so they need explicit handlers.
- No test runner is installed (no vitest/jest). The definition of done is `./scripts/verify`: `pnpm run stations`, `pnpm run lint`, `pnpm run typecheck`.

## Design

Add one new file, `app/api/health/route.ts`:

```ts
import { repoFull } from '@/lib/config';

// Never prerender or cache: evaluate on every request.
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    { ok: true, repo: repoFull },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}

const methodNotAllowed = () =>
  new Response(null, { status: 405, headers: { Allow: 'GET', 'Cache-Control': 'no-store' } });

export const HEAD = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
```

Notes:

- `HEAD` and `OPTIONS` must be exported to override Next's automatic implementations. `POST`/`PUT`/`PATCH`/`DELETE` would already get a 405 from Next, but exporting them adds the `Allow: GET` header and makes the contract visible in one place. Methods Next doesn't route at all (for example `TRACE`, `CONNECT`) are handled by the framework or platform and aren't covered.
- Not cached, belt and braces:
  - `dynamic = 'force-dynamic'` stops build-time prerendering. Without it, a handler that only reads module-level config could be treated as static.
  - `Cache-Control: no-store` stops CDN and browser caching.
- No auth: don't check signatures or headers. The handler ignores the request entirely.
- `repoFull` is a module-level constant built from env at module load. That's fine because env is fixed for the lifetime of a deployment or process.
- Don't import anything heavy. Importing `@/lib/config` only reads `process.env`. Never import `workflow/api` or `@/workflows/*` here.

## Files to touch

| File | Change |
| --- | --- |
| `app/api/health/route.ts` | New: the handlers above. |

Nothing else. No changes to `lib/config.ts`, `workflows/`, `factory/stations/`, `lib/stations.generated.json`, or package files. `pnpm-lock.yaml` and `.github/` are protected paths anyway.

## Data / model changes

None. No storage, no new env vars, no config changes. The endpoint reads the existing `FACTORY_OWNER` / `FACTORY_REPO` through `repoFull`.

## Test plan

There is no unit test framework, and adding one (a dependency plus a lockfile change) is out of scope because the lockfile is a protected path. Verification:

1. Static checks: `./scripts/verify` must pass (stations, eslint, `tsc --noEmit`).
2. Manual or scripted HTTP checks against `pnpm dev` (or `pnpm build && pnpm start`) with `FACTORY_OWNER=acme FACTORY_REPO=widgets`:
   - `curl -si localhost:3000/api/health` returns `HTTP/1.1 200`, `content-type: application/json`, `cache-control: no-store`, and body `{"ok":true,"repo":"acme/widgets"}`.
   - `for m in POST PUT PATCH DELETE OPTIONS; do curl -s -o /dev/null -w "$m %{http_code}\n" -X $m localhost:3000/api/health; done` prints `405` for each.
   - `curl -sI localhost:3000/api/health` returns `405` and `allow: GET`.
   - With `pnpm build`, the build output lists `/api/health` as dynamic (`ƒ`), not static (`○`).
3. Regression: `POST /api/github/webhook` with a bad signature still returns `401 bad signature`.
4. After deploy (e2e): run the same `curl -si https://<deployment>/api/health` and confirm `repo` matches the deployment's configured repo.

## Risks

- **HEAD/OPTIONS auto-implementation.** If someone later drops the explicit `HEAD`/`OPTIONS` exports, Next silently returns 200/204 again. A comment in the file should explain why they exist.
- **Missing env vars.** If `FACTORY_OWNER` / `FACTORY_REPO` are unset, `repoFull` becomes `"undefined/undefined"` and the endpoint still returns `ok: true`. That's misleading, but it matches the issue's "liveness only" scope. See open questions.
- **Cache Components migration.** If `cacheComponents` is enabled in `next.config.ts` later, `export const dynamic` is no longer allowed and the build fails. The fix then is to drop it and opt into request-time rendering another way, for example `await connection()` from `next/server`. The `no-store` header still holds.
- **Information disclosure.** The endpoint publicly reveals which repo this factory serves. That's low sensitivity, since the webhook already only acts on that repo, and the issue asks for it explicitly.
- **Platform-level caching or protection.** Vercel Deployment Protection, if enabled, could put auth in front of the endpoint on preview deployments. That's outside app code.
