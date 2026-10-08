// Dev push/PR access on a throwaway branch and draft PR, which are deleted afterwards: what Dev can do, what GitHub
// and the firewall refuse, the finish step, and no token in the sandbox.
import { createOctokit, resolveGithubToken } from '@github-tools/sdk';
import { config, repoFull } from '../lib/config';
import { mintDevToken, prChangedPaths, prepareDevPr, writeToken } from '../lib/github';
import { applyAgentPolicy, ensureSandbox, finishDevBranch, native, prepareRepo } from '../lib/sandbox';
import { deleteCheckSandbox, httpStatus, report, secretsAbsent, sh, why } from './_lib';

const r = report(`Dev access on ${repoFull}`);
const { owner, repo } = config;
const issue = 90000 + Math.floor(Math.random() * 9999);
const branch = config.branch(issue);
const o = createOctokit(await resolveGithubToken(writeToken));
const head = async () => (await o.rest.git.getRef({ owner, repo, ref: `heads/${branch}` })).data.object.sha;
let pr: number | undefined;
const sandboxId = await ensureSandbox(issue);
const sbx = await native(sandboxId);
try {
  // A branch with one commit, as Spec leaves it, and Dev's draft PR.
  const base = (await o.rest.repos.get({ owner, repo })).data.default_branch;
  const baseSha = (await o.rest.git.getRef({ owner, repo, ref: `heads/${base}` })).data.object.sha;
  await o.rest.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: baseSha });
  await o.rest.repos.createOrUpdateFileContents({ owner, repo, branch, path: `specs/${issue}/PRODUCT.md`, message: 'check: throwaway spec', content: Buffer.from('Throwaway.\n').toString('base64') });
  pr = await prepareDevPr(issue, branch, 'Dev access check (throwaway)');
  r.info(`throwaway branch ${branch}, draft PR #${pr}`);

  await prepareRepo(sandboxId, branch);
  await applyAgentPolicy(sandboxId, 'implement', { pr });
  const start = await head();
  const push = await sh(sbx, `mkdir -p docs && echo ok > docs/check.md && git add -A && git commit -qm "check: push" && git push -q origin HEAD:refs/heads/${branch} 2>&1`);
  r.check('push to its branch', push.code === 0 && (await head()) !== start, push.out);

  const refused = async (label: string, script: string) => {
    const res = await sh(sbx, `${script} 2>&1`);
    r.check(label, res.code !== 0, why(res.out));
  };
  await refused('push to the default branch refused', `git push origin HEAD:refs/heads/${base}`);
  await refused('push to another branch refused', 'git push origin HEAD:refs/heads/not-a-factory-branch');
  await refused('tag push refused', 'git tag check-tag && git push origin check-tag');
  const wf = await sh(sbx, `mkdir -p .github/workflows && printf 'on: push\\njobs: {}\\n' > .github/workflows/check.yml && git add .github && git commit -qm wf && git push origin HEAD:refs/heads/${branch} 2>&1`);
  r.check('workflow file push refused (no workflows permission)', wf.code !== 0, why(wf.out));
  await sh(sbx, 'git reset -q --hard HEAD~1');

  const gh = 'https://api.github.com';
  const R = `${gh}/repos/${owner}/${repo}`;
  r.check('allowed: read its PR', (await httpStatus(sbx, `${R}/pulls/${pr}`)) === '200');
  r.check('allowed: edit its PR description', (await httpStatus(sbx, `${R}/pulls/${pr}`, { method: 'PATCH', body: '{"body":"Dev access check (throwaway)."}' })) === '200');
  r.check('allowed: CI results for its commit', (await httpStatus(sbx, `${R}/commits/${await head()}/check-runs`)) === '200');
  for (const [label, method, url, body] of [
    ['merge', 'PUT', `${R}/pulls/${pr}/merge`, '{}'],
    ['approve', 'POST', `${R}/pulls/${pr}/reviews`, '{"event":"APPROVE"}'],
    ['GraphQL', 'POST', `${gh}/graphql`, '{"query":"{viewer{login}}"}'],
    ['comment', 'POST', `${R}/issues/${pr}/comments`, '{"body":"x"}'],
    ['another repo', 'GET', `${gh}/repos/vercel/next.js`, undefined],
    ['delete a branch', 'DELETE', `${R}/git/refs/heads/${branch}`, undefined],
  ] as const) {
    const code = await httpStatus(sbx, url, { method, body });
    r.check(`blocked: ${label}`, code === '403', code);
  }
  r.check('no Dev token in the sandbox', await secretsAbsent(sbx, [await mintDevToken()]));

  await sh(sbx, 'echo leftover > docs/leftover.md');
  const fin = await finishDevBranch(sandboxId, 'implement', { pr }, 'check: leftovers');
  r.check('finish step commits and pushes leftovers', fin.committedLeftovers && (await head()) === fin.headSha, fin.headSha.slice(0, 7));
  // GitHub updates a PR's file list shortly after a push.
  let paths: string[] = [];
  for (let i = 0; i < 10 && !paths.includes('docs/leftover.md'); i++) {
    if (i) await new Promise((res) => setTimeout(res, 2000));
    paths = await prChangedPaths(pr);
  }
  r.check("PR paths visible to the rules' path check, no workflow file", paths.includes('docs/leftover.md') && !paths.some((p) => p.startsWith('.github/')), paths.join(', '));
} catch (e) {
  r.fail('dev', e);
} finally {
  await deleteCheckSandbox(issue);
  if (pr) await o.rest.pulls.update({ owner, repo, pull_number: pr, state: 'closed' }).catch(() => {});
  await o.rest.git.deleteRef({ owner, repo, ref: `heads/${branch}` }).catch(() => {});
  r.info(`cleaned up PR #${pr ?? '-'} and ${branch}`);
}
r.done();
