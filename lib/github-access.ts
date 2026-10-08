import type { NetworkPolicyRule } from '@vercel/sandbox';
import { config } from './config';

// GitHub access for the Dev (Implement) agent (factory/skills/github-dev). The firewall injects the Dev token only on
// this repo's git endpoints and on the allowlisted API calls below, and answers 403 to everything else on those hosts.
// What it cannot see (which branch a push updates) is enforced by GitHub: the repo's rulesets let bots create, update
// or delete factory/** branches only, and the token has no `workflows` scope.

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const deny = (what: string): NetworkPolicyRule => ({
  response: {
    statusCode: 403,
    contentType: 'application/json',
    body: JSON.stringify({ message: `Blocked by the factory sandbox: ${what}` }),
  },
});

export function githubDevRules(token: string, pr: number): Record<string, NetworkPolicyRule[]> {
  const { owner, repo } = config;
  const r = `/repos/${esc(owner)}/${esc(repo)}`;
  const bearer = [{ headers: { Authorization: `Bearer ${token}` } }];
  const allow = (method: string, path: string): NetworkPolicyRule => ({ match: { method: [method], path: { regex: `^${r}${path}$` } }, transform: bearer });
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  return {
    'github.com': [
      {
        match: { path: { regex: `^/${esc(owner)}/${esc(repo)}(\\.git)?/(info/refs|git-upload-pack|git-receive-pack)$` } },
        transform: [{ headers: { Authorization: `Basic ${basic}` } }],
      },
      deny(`only git fetch and push for ${owner}/${repo} are allowed.`),
    ],
    'api.github.com': [
      allow('GET', `/pulls/${pr}(/(files|commits|comments|reviews))?`), // the PR, its diff, review comments, reviews
      allow('PATCH', `/pulls/${pr}`), // title and description
      allow('GET', `/issues/\\d+/comments`), // conversation comments
      allow('GET', `/commits/[^/]+/(check-runs|status|statuses)`), // CI results for a commit
      allow('GET', `/check-runs/\\d+(/annotations)?`),
      allow('GET', `/actions/runs(/\\d+(/jobs)?)?`),
      deny(`only reading PR #${pr}, its comments and CI results, and editing its description are allowed.`),
    ],
  };
}

/** What the agent reads in the sandbox: identifiers only, no credential. */
export function githubEnvFile(branch: string, pr: number) {
  return [`OWNER=${config.owner}`, `REPO=${config.repo}`, `BRANCH=${branch}`, `PR=${pr}`].join('\n') + '\n';
}
