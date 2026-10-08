// GitHub tokens reach only the target and carry only the permissions they ask for.
// Guards against Connect ignoring the requested permissions (see docs/platform-notes.md).
import { createOctokit, resolveGithubToken } from '@github-tools/sdk';
import { config, repoFull } from '../lib/config';
import { devToken, readToken, writeToken } from '../lib/github';
import { report } from './_lib';

const r = report(`tokens for ${repoFull}`);
try {
  for (const [label, provider] of [['read', readToken], ['write', writeToken], ['dev', devToken]] as const) {
    const o = createOctokit(await resolveGithubToken(provider));
    const repos = (await o.request('GET /installation/repositories')).data.repositories.map((x: { full_name: string }) => x.full_name);
    r.check(`${label} token reaches only ${repoFull}`, repos.length === 1 && repos[0] === repoFull, repos.join(', '));
  }
  // A write the read token must not be able to make; undone if it goes through.
  const { owner, repo } = config;
  const name = `factory-token-probe-${Date.now()}`;
  const ro = createOctokit(await resolveGithubToken(readToken));
  const wrote = await ro.rest.issues.createLabel({ owner, repo, name, color: 'ededed' }).then(() => true, (e: { status?: number }) => (e.status === 403 ? false : Promise.reject(e)));
  if (wrote) await createOctokit(await resolveGithubToken(writeToken)).rest.issues.deleteLabel({ owner, repo, name });
  r.check('read token is refused writes (403)', !wrote);
} catch (e) {
  r.fail('tokens', e);
}
r.done();
