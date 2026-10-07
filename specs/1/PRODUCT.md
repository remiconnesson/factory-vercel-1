# Issue #1: Health check endpoint (product spec)

## Summary

The factory app gets a public, unauthenticated liveness endpoint at `GET /api/health`. It confirms the deployment is up and shows which GitHub repository this factory instance is set up to serve.

This is also an end-to-end test of the factory pipeline (spec, implement, review). The feature is small on purpose.

## User-facing behavior

### `GET /api/health`

- Status: `200 OK`
- Content type: `application/json`
- Body:

  ```json
  { "ok": true, "repo": "<owner>/<repo>" }
  ```

  `<owner>` and `<repo>` are the values of the `FACTORY_OWNER` and `FACTORY_REPO` environment variables, as exposed by the factory config (`repoFull` in `lib/config.ts`). Example: `{ "ok": true, "repo": "remiconnesson/factory-vercel-1" }`.
- No authentication, cookies, signature, or headers are needed.
- The response is never cached. Each request runs the handler at request time, and the response tells clients and CDNs not to store it (`Cache-Control: no-store`).
- Query strings are ignored. `GET /api/health?x=1` behaves the same as `GET /api/health`.

### Any other method

- `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, and `OPTIONS` on `/api/health` return `405 Method Not Allowed`.
- A 405 response includes `Allow: GET`.
- A 405 response body is empty (or not meaningful). Clients must rely only on the status code.

## Acceptance criteria

1. `curl -i https://<deployment>/api/health` returns `200`, `Content-Type: application/json`, and a body that parses as JSON and deep-equals `{ "ok": true, "repo": "<FACTORY_OWNER>/<FACTORY_REPO>" }` for the deployment's configured env vars.
2. The `200` response has `Cache-Control: no-store`. If the env vars change and the app is redeployed or restarted, the new value shows up with no stale cached body.
3. The request succeeds with no `Authorization` header, cookies, or other credentials.
4. `curl -i -X POST`, `-X PUT`, `-X PATCH`, `-X DELETE`, `-X OPTIONS`, and `-I` (HEAD) against `/api/health` each return `405` with `Allow: GET`.
5. Existing behavior is unchanged. In particular, `POST /api/github/webhook` works exactly as before.
6. `./scripts/verify` passes (stations build, lint, typecheck).

## Out of scope

- Deep health checks: probing GitHub, Vercel Sandbox, the workflow runtime, the AI gateway, or any other dependency.
- Version, commit SHA, uptime, or other metadata beyond `ok` and `repo`.
- Authentication, rate limiting, and CORS headers.
- Reporting `ok: false` or non-200 statuses for degraded states.
- Validating at startup that `FACTORY_OWNER` / `FACTORY_REPO` are set (see open questions).
- UI changes, documentation sites, monitoring or alerting integration.
