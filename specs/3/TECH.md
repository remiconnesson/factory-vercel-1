# Health check endpoint: technical design (issue #3)

## Context (from the code)

- App Router project on Next.js `16.3.8`. The only existing route handler is
  `app/api/github/webhook/route.ts` (exports `POST`, imports `config`/`repoFull` from `@/lib/config`).
- `lib/config.ts` already exports `repoFull = \`${config.owner}/${config.repo}\`` built from
  `FACTORY_OWNER`/`FACTORY_REPO`. It has no Node-only imports, so any route can import it safely.
- `next.config.ts` does not enable `cacheComponents`, so route segment config such as `dynamic` is allowed.
- Bundled Next docs (`node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`):
  "Route Handlers are not cached by default", and unsupported methods return `405`.
- However, `node_modules/next/dist/server/route-modules/app-route/helpers/auto-implement-methods.js`
  shows that Next **auto-implements** `HEAD` (by reusing `GET`, so it answers 200) and `OPTIONS` (answers 204
  with an `Allow` header) when the module does not export them. Its built-in 405 also has no `Allow` header.
  To meet "any other method returns 405", the route must export these handlers itself.

## Design

New file `app/api/health/route.ts`:

```ts
import { repoFull } from '@/lib/config';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ ok: true, repo: repoFull }, { headers: { 'Cache-Control': 'no-store' } });
}

const methodNotAllowed = () => new Response(null, { status: 405, headers: { Allow: 'GET' } });
export { methodNotAllowed as POST, methodNotAllowed as PUT, methodNotAllowed as PATCH,
         methodNotAllowed as DELETE, methodNotAllowed as HEAD, methodNotAllowed as OPTIONS };
```

(The export style is up to the implementer. Separate `export const POST = methodNotAllowed;` lines work too,
as long as lint and typecheck pass.)

Notes:

- Import only `@/lib/config`. Do not import `workflow/api`, `workflows/*` or other `lib/*` modules: they are
  not needed, and they would pull heavy host code into this route.
- No caching, enforced twice: `dynamic = 'force-dynamic'` keeps Next from prerendering the GET at build time,
  and `Cache-Control: no-store` keeps the CDN and clients from storing it. The handler takes no `Request`
  argument because it doesn't use one.
- No authentication logic and no changes to `proxy`/middleware (none exists).

## Files to touch

| File                        | Change                                  |
| --------------------------- | --------------------------------------- |
| `app/api/health/route.ts`   | New: route handler described above      |
| `README.md` (optional)      | Add `app/api/health/route.ts` to Layout |

No other files. Do not change `lib/config.ts`, the webhook, workflows or station prompts. No
`pnpm stations` regeneration is needed.

## Data / model changes

None. No new env vars, no storage, no schema changes. The endpoint reuses `FACTORY_OWNER`/`FACTORY_REPO`.

## Test plan

The repo has no unit-test runner (no vitest/jest in `package.json`), and adding one is out of scope.

1. `./scripts/verify` (stations, lint, typecheck) must pass.
2. Manual / end-to-end against `pnpm dev` (or the deployment), with `FACTORY_OWNER=acme FACTORY_REPO=widgets`:
   - `curl -i localhost:3000/api/health` returns `200`, `content-type: application/json`,
     `cache-control: no-store`, body `{"ok":true,"repo":"acme/widgets"}`.
   - For each of `POST PUT PATCH DELETE OPTIONS`: `curl -i -X <M> localhost:3000/api/health` returns `405`
     with `allow: GET`.
   - `curl -I localhost:3000/api/health` (HEAD) returns `405`.
3. Optional build check: in `pnpm build` output, `/api/health` shows as dynamic (`ƒ`), not static (`○`).
4. Regression: a `POST` to `/api/github/webhook` with no signature still returns `401 bad signature`.

## Risks

- **Auto-implemented HEAD/OPTIONS.** If the explicit `HEAD`/`OPTIONS` exports are left out, those methods
  answer 200/204 instead of 405 and the acceptance criteria fail. Returning 405 for `HEAD` is stricter than
  HTTP norms (HEAD usually mirrors GET), and some uptime monitors use HEAD. This follows the issue as written;
  see open questions.
- **Missing env vars.** `config.owner`/`config.repo` use non-null assertions. If they are unset, `repoFull` is
  `"undefined/undefined"` and the endpoint still reports `ok: true`. This matches current config behavior,
  but it could hide a misconfiguration.
- **Information disclosure.** The unauthenticated endpoint reveals the target repo name. That's acceptable
  for this factory (the issue asks for it), but worth knowing if the target repo is private.
- **Future `cacheComponents`.** If `cacheComponents` is enabled later, the `dynamic` segment config must be
  removed. The `Cache-Control: no-store` header, plus the default non-cached GET, still guarantee
  freshness.
