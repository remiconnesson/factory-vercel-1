// Merging a factory PR deletes the issue's sandbox, on the deployed factory. Two throwaway issues, each with a sandbox:
// - A gets signed `pull_request.closed` events the factory must not act on: one unmerged, and one claiming a merge that
//   GitHub doesn't know about (the cleanup asks GitHub whether the PR is merged; it doesn't trust the event).
// - B's branch is really merged, into a throwaway `factory/check-base-*` branch rather than main, and GitHub's own
//   event must delete B's sandbox.
// Sandboxes and branches are deleted afterwards; the merged throwaway PR stays in the target's history.
// Usage: FACTORY_WEBHOOK_SECRET=… pnpm check cleanup <factory-url>
import { createHmac } from 'node:crypto';
import { createOctokit, resolveGithubToken } from '@github-tools/sdk';
import { Sandbox } from '@vercel/sandbox';
import { config, repoFull } from '../lib/config';
import { writeToken } from '../lib/github';
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
const { owner, repo } = config;
const a = 80000 + Math.floor(Math.random() * 9998);
const b = a + 1;
const refs = [config.branch(b), `factory/check-base-${b}`];
const o = createOctokit(await resolveGithubToken(writeToken));
const exists = (issue: number) => Sandbox.get({ name: issueSandboxName(issue) }).then(() => true, () => false);

async function send(issue: number, merged: boolean) {
  const body = JSON.stringify({
    action: 'closed',
    pull_request: { number: issue, merged, draft: false, head: { ref: config.branch(issue), sha: '0'.repeat(40), repo: { full_name: repoFull } } },
    repository: { full_name: repoFull },
    sender: { login: 'cleanup-check', type: 'User' },
  });
  const sig = 'sha256=' + createHmac('sha256', secret!).update(body).digest('hex');
  const res = await fetch(`${url}/api/github/webhook`, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-github-event': 'pull_request', 'x-hub-signature-256': sig } });
  return res.text();
}

try {
  await Promise.all([ensureSandbox(a), ensureSandbox(b)]);
  r.check('throwaway sandboxes exist', (await exists(a)) && (await exists(b)), `${issueSandboxName(a)}, ${issueSandboxName(b)}`);

  const unmerged = await send(a, false);
  r.check('a PR closed without merging is ignored', unmerged.startsWith('ignored'), unmerged);
  const forged = await send(a, true);
  r.check('an event claiming a merge starts the cleanup', forged === 'started cleanup', forged);

  // A real merge that leaves main alone: B's branch, one commit ahead, into a throwaway base branch.
  const main = (await o.rest.repos.get({ owner, repo })).data.default_branch;
  const sha = (await o.rest.git.getRef({ owner, repo, ref: `heads/${main}` })).data.object.sha;
  for (const ref of refs) await o.rest.git.createRef({ owner, repo, ref: `refs/heads/${ref}`, sha });
  await o.rest.repos.createOrUpdateFileContents({ owner, repo, branch: refs[0], path: `specs/${b}/PRODUCT.md`, message: 'check: throwaway spec', content: Buffer.from('Throwaway.\n').toString('base64') });
  const { data: pr } = await o.rest.pulls.create({ owner, repo, head: refs[0], base: refs[1], title: 'Merge cleanup check (throwaway)', body: 'Opened and merged by `pnpm check cleanup` into a throwaway branch, not main.' });
  await o.rest.pulls.merge({ owner, repo, pull_number: pr.number });
  r.info(`merged throwaway PR #${pr.number} into ${refs[1]}`);

  let gone = false;
  for (let i = 0; i < 24 && !gone; i++) {
    await new Promise((res) => setTimeout(res, 5000));
    gone = !(await exists(b));
  }
  r.check("GitHub's merge event deletes the merged issue's sandbox", gone, issueSandboxName(b));
  // Checked after B's cleanup ran, so A's (started earlier) had as long.
  r.check('the sandbox of an issue whose PR GitHub says is not merged is kept', await exists(a), issueSandboxName(a));
} catch (e) {
  r.fail('cleanup', e);
} finally {
  await Promise.all([a, b].map((i) => deleteCheckSandbox(i).catch(() => {})));
  for (const ref of refs) await o.rest.git.deleteRef({ owner, repo, ref: `heads/${ref}` }).catch(() => {});
}
r.done();
