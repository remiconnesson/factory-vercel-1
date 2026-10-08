// Merging a factory PR deletes the issue's sandbox, on the deployed factory: creates a sandbox for a throwaway issue,
// sends the factory a signed `pull_request.closed` (merged) event for that issue's branch, and waits for the sandbox
// to disappear. Nothing is merged. Usage: FACTORY_WEBHOOK_SECRET=… pnpm check cleanup <factory-url>
import { createHmac } from 'node:crypto';
import { Sandbox } from '@vercel/sandbox';
import { config, repoFull } from '../lib/config';
import { ensureSandbox, issueSandboxName } from '../lib/sandbox';
import { deleteCheckSandbox, report } from './_lib';

const url = process.argv[2];
const secret = process.env.FACTORY_WEBHOOK_SECRET;
const r = report(`merge cleanup via ${url}`);
if (!url || !secret) {
  r.fail('usage', 'FACTORY_WEBHOOK_SECRET=… pnpm check cleanup https://<factory>');
  r.done();
  process.exit();
}
const issue = 80000 + Math.floor(Math.random() * 9999);
const exists = () => Sandbox.get({ name: issueSandboxName(issue) }).then(() => true, () => false);
try {
  await ensureSandbox(issue);
  r.check('throwaway sandbox exists', await exists(), issueSandboxName(issue));
  const send = async (merged: boolean) => {
    const body = JSON.stringify({
      action: 'closed',
      pull_request: { number: issue, merged, draft: false, head: { ref: config.branch(issue), sha: '0'.repeat(40), repo: { full_name: repoFull } } },
      repository: { full_name: repoFull },
      sender: { login: 'cleanup-check', type: 'User' },
    });
    const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    const res = await fetch(`${url}/api/github/webhook`, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-github-event': 'pull_request', 'x-hub-signature-256': sig } });
    return res.text();
  };
  const unmerged = await send(false);
  r.check('a PR closed without merging is ignored', unmerged.startsWith('ignored'), unmerged);
  r.check('…and its sandbox kept', await exists());
  const merged = await send(true);
  r.check('a merged PR starts the cleanup', merged === 'started cleanup', merged);
  let gone = false;
  for (let i = 0; i < 24 && !gone; i++) {
    await new Promise((res) => setTimeout(res, 5000));
    gone = !(await exists());
  }
  r.check('the sandbox is deleted', gone);
} catch (e) {
  r.fail('cleanup', e);
} finally {
  await deleteCheckSandbox(issue).catch(() => {});
}
r.done();
