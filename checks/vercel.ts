// The vercel-debug allowlist, applied exactly as the agent gets it: allowed endpoints, blocked ones, the protected
// preview and production hosts, and no Vercel secret in the sandbox. Usage: pnpm check vercel <branch-with-a-preview>
import { config } from '../lib/config';
import { applyAgentPolicy, destroyIssueSandbox, ensureSandbox, native, prepareRepo } from '../lib/sandbox';
import { vercelContext, vercelEnabled } from '../lib/vercel';
import { httpStatus, report, secretsAbsent, sh } from './_lib';

const branch = process.argv[2];
const r = report(`vercel-debug access for ${branch}`);
if (!branch || !vercelEnabled()) {
  r.fail('usage', 'pnpm check vercel <branch>, with FACTORY_VERCEL_TOKEN, FACTORY_VERCEL_TEAM_ID and FACTORY_VERCEL_PROJECT_ID set');
  r.done();
  process.exit();
}
const issue = 80000 + Math.floor(Math.random() * 9999); // a throwaway sandbox, deleted at the end
const sandboxId = await ensureSandbox(issue);
const sbx = await native(sandboxId);
try {
  await prepareRepo(sandboxId, branch);
  await applyAgentPolicy(sandboxId);
  const env = await sh(sbx, 'cat .factory/vercel.env');
  const preview = /PREVIEW_URL=(\S+)/.exec(env.out)?.[1];
  const production = /PRODUCTION_URL=(\S+)/.exec(env.out)?.[1];
  r.check('.factory/vercel.env lists the branch preview and production', Boolean(preview && production), env.out);

  const { teamId, projectId } = config.vercel;
  const api = 'https://api.vercel.com';
  const ctx = await vercelContext(branch);
  const deployment = JSON.parse((await sh(sbx, `curl -s "${api}/v13/deployments/${ctx.previewHost}?teamId=${teamId}"`)).out);
  r.check('allowed: one deployment (by preview alias)', typeof deployment.id === 'string', deployment.id ?? JSON.stringify(deployment).slice(0, 120));
  r.check('allowed: list deployments', (await httpStatus(sbx, `${api}/v6/deployments?projectId=${projectId}&teamId=${teamId}&limit=5`)) === '200');
  r.check('allowed: build logs', (await httpStatus(sbx, `${api}/v3/deployments/${deployment.id}/events?teamId=${teamId}&limit=5`)) === '200');
  // A live tail with no traffic sends nothing: a timeout means allowed, an immediate 403 means blocked.
  const tail = await httpStatus(sbx, `${api}/v1/projects/${projectId}/deployments/${deployment.id}/runtime-logs?format=lines&teamId=${teamId}`, { maxTime: 5 });
  r.check('allowed: runtime logs (not blocked)', tail !== '403', tail);
  for (const [label, method, url] of [
    ['env vars', 'GET', `${api}/v10/projects/${projectId}/env?teamId=${teamId}`],
    ['project settings (holds the bypass secret)', 'GET', `${api}/v9/projects/${projectId}?teamId=${teamId}`],
    ['create a deployment', 'POST', `${api}/v13/deployments?teamId=${teamId}`],
    ['delete a deployment', 'DELETE', `${api}/v13/deployments/${deployment.id}?teamId=${teamId}`],
  ] as const) {
    const code = await httpStatus(sbx, url, { method, body: method === 'POST' ? '{}' : undefined });
    r.check(`blocked: ${label}`, code === '403', code);
  }
  r.check('preview reachable through Deployment Protection', (await httpStatus(sbx, `${preview}/`)) === '200');
  r.check('production reachable', (await httpStatus(sbx, `${production}/`)) === '200');
  r.check('other hosts still unreachable', (await httpStatus(sbx, 'https://example.com', { maxTime: 8 })) === '000');
  r.check('no Vercel token or bypass secret in the sandbox', await secretsAbsent(sbx, [process.env.FACTORY_VERCEL_TOKEN, ctx.bypass]));
} catch (e) {
  r.fail('vercel', e);
} finally {
  await destroyIssueSandbox(issue);
}
r.done();
