---
name: vercel-debug
description: Inspect this project's Vercel deployments from the sandbox. Use to find the branch preview, read build logs and runtime logs, and send requests to the live preview or production deployment.
---

# Debug on Vercel

You have read-only access to this project's deployments. The sandbox firewall adds the credentials: send no
`Authorization` or `x-vercel-protection-bypass` header yourself, and don't look for a token, there is none here.

## Setup

```bash
source .factory/vercel.env   # TEAM_ID, PROJECT_ID, BRANCH, PREVIEW_URL, PRODUCTION_URL
```

If the file is missing, Vercel access isn't enabled for this run. `PREVIEW_URL` is the branch's preview alias,
which always serves the branch's latest deployment. It's empty until the branch has been pushed and deployed.

Your working tree is not deployed during this run: deployments contain only commits that were pushed before it.

## Find deployments

```bash
curl -s "https://api.vercel.com/v6/deployments?projectId=$PROJECT_ID&teamId=$TEAM_ID&limit=20" | node -e '
  const { deployments } = JSON.parse(require("fs").readFileSync(0, "utf8"));
  for (const d of deployments) console.log(d.uid, d.state, d.target ?? "preview", d.meta?.githubCommitRef, d.meta?.githubCommitSha?.slice(0, 7), d.url);'
```

`state` is `QUEUED`, `BUILDING`, `READY`, `ERROR` or `CANCELED`. For one deployment's details, including
`errorMessage` when a build failed and its `alias` list:

```bash
curl -s "https://api.vercel.com/v13/deployments/<id or url>?teamId=$TEAM_ID"
```

## Build logs

```bash
curl -s "https://api.vercel.com/v3/deployments/<id>/events?teamId=$TEAM_ID&limit=-1" | node -e '
  for (const e of JSON.parse(require("fs").readFileSync(0, "utf8"))) { const t = e.text ?? e.payload?.text; if (t) console.log(t); }' | tail -n 80
```

Build logs can be long: keep the `tail` (or `grep -i error`) so the output stays small.

## Send requests to a deployment

```bash
curl -si "$PREVIEW_URL/api/health"
curl -si "$PRODUCTION_URL/"
```

Deployment Protection is handled for you on these two hosts. No other deployment URL is reachable, so use
`PREVIEW_URL` rather than a deployment's own `*.vercel.zone` / `*.vercel.app` URL.

## Runtime logs

Runtime logs are a live tail of one deployment's function output: `console.log`, `console.error` and uncaught
errors. There are no past logs, so start the tail, then send the requests, then read:

```bash
curl -sN --max-time 30 "https://api.vercel.com/v1/projects/$PROJECT_ID/deployments/<id>/runtime-logs?format=lines&teamId=$TEAM_ID" > /tmp/runtime.log &
sleep 3
curl -s "$PREVIEW_URL/api/..." > /dev/null
wait
cat /tmp/runtime.log
```

Each line is a JSON object with `level`, `message`, `requestMethod`, `requestPath`, `domain` and `timestampInMs`.
The stream sends nothing, not even headers, until there is a line, so an empty file means the requests produced
no function output. Use the id of the deployment that `PREVIEW_URL` currently serves (the newest `READY` one for
`$BRANCH`).

## Not available

Everything else returns `403` from the firewall: other API paths, any method but `GET`, environment variables,
project settings and deploys.
