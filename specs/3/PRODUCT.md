# Health check endpoint (issue #3)

## Summary

Operators (and the factory's own end-to-end test) need a cheap, unauthenticated way to confirm that the
deployed factory app is up and which target repository it is configured for.

## User-facing behavior

`GET /api/health`

- Responds `200 OK` with `Content-Type: application/json` and body:

  ```json
  { "ok": true, "repo": "<owner>/<repo>" }
  ```

  where `<owner>` is `FACTORY_OWNER` and `<repo>` is `FACTORY_REPO`, as exposed by the factory config
  (`repoFull` in `lib/config.ts`).
- No authentication, signature, cookie or header is required.
- The response is never cached: each request is served fresh by the app, and the response carries
  `Cache-Control: no-store` so browsers, proxies and the Vercel CDN do not store it.

Any other method on `/api/health` (`POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`)

- Responds `405 Method Not Allowed` with an `Allow: GET` header and an empty body.

## Acceptance criteria

1. `curl -i https://<app>/api/health` returns status `200`, a JSON content type, and a body that parses to
   exactly `{ "ok": true, "repo": "<FACTORY_OWNER>/<FACTORY_REPO>" }` for the deployment's env vars.
2. The request succeeds with no credentials of any kind.
3. The `200` response includes `Cache-Control: no-store`. Changing `FACTORY_OWNER`/`FACTORY_REPO` and
   redeploying is reflected right away, and repeated requests are not served from a cache (no
   `x-vercel-cache: HIT`).
4. `curl -i -X POST` (and likewise `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`) on `/api/health` returns `405`
   with `Allow: GET`.
5. The existing webhook (`/api/github/webhook`) and every station behave exactly as before.
6. `./scripts/verify` passes.

## Out of scope

- Deep health checks (GitHub/Connect reachability, AI Gateway, Sandbox, Workflow status).
- Validating or reporting missing configuration (see open questions in `TECH.md`).
- Version, commit SHA, uptime or any other fields in the response.
- Rate limiting, authentication, CORS headers.
- UI changes, README changes beyond an optional one-line layout mention.
