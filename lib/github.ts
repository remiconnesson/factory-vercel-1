import { connectGithubToken } from '@github-tools/sdk/connect';
import { createOctokit, resolveGithubToken } from '@github-tools/sdk';
import { config, repoFull } from './config';

// Every token is narrowed to ONE repo and to explicit GitHub App permissions. Connect applies `permissions` in the
// authorization details (format `name:level`); it ignores `scopes` for GitHub App tokens, which then carry the app's
// full permission set. Verified: a token minted with only read permissions gets 403 on writes.
const narrowed = (...permissions: string[]) => ({
  authorizationDetails: [{ type: 'github_app_installation' as const, repositories: [repoFull], permissions }],
});

// Read-only: agents' tools (Triage, Review) and the sandbox clone.
export const readToken = connectGithubToken(config.connector, {
  preset: 'repo-explorer',
  params: narrowed('metadata:read', 'contents:read', 'pull_requests:read', 'issues:read', 'checks:read', 'statuses:read', 'actions:read'),
});

// Orchestrator writes (commits, PRs, labels, comments); never reaches an agent.
export const writeToken = connectGithubToken(config.connector, {
  params: narrowed('metadata:read', 'contents:write', 'pull_requests:write', 'issues:write'),
});

// Dev (Implement): push the factory branch and work on its PR. Never handed to the agent: the sandbox firewall
// injects it on the allowlisted git and API paths only (lib/github-access.ts). Without the `workflows` permission,
// GitHub refuses pushes that touch .github/workflows. The repo's rulesets confine bot pushes to factory/** branches.
export const devToken = connectGithubToken(config.connector, {
  params: narrowed('metadata:read', 'contents:write', 'pull_requests:write', 'issues:read', 'checks:read', 'statuses:read', 'actions:read'),
});

export async function mintReadToken() {
  return resolveGithubToken(readToken);
}

export async function mintDevToken() {
  return resolveGithubToken(devToken);
}

export async function gh() {
  return createOctokit(await resolveGithubToken(writeToken));
}

/** Strip images and non-GitHub links before posting agent text: blocks image-beacon exfiltration. */
export function sanitizeMarkdown(md: string) {
  return md
    .replace(/!\[[^\]]*]\([^)]*\)/g, '[image removed]')
    .replace(/<img\b[^>]*>/gi, '[image removed]')
    .replace(/\[([^\]]+)]\((?!https:\/\/github\.com\/)[^)]*\)/g, '$1');
}

export async function comment(issue: number, body: string) {
  const o = await gh();
  await o.rest.issues.createComment({ owner: config.owner, repo: config.repo, issue_number: issue, body: sanitizeMarkdown(body) });
}

export async function setLabels(issue: number, add: string[], remove: string[] = []) {
  const o = await gh();
  const { owner, repo } = config;
  if (add.length) await o.rest.issues.addLabels({ owner, repo, issue_number: issue, labels: add });
  for (const name of remove) {
    await o.rest.issues.removeLabel({ owner, repo, issue_number: issue, name }).catch((e: { status?: number }) => {
      if (e.status !== 404) throw e;
    });
  }
}

export async function getIssue(issue: number) {
  const o = await gh();
  const { data } = await o.rest.issues.get({ owner: config.owner, repo: config.repo, issue_number: issue });
  return {
    title: data.title,
    body: data.body ?? '',
    labels: data.labels.map((l) => (typeof l === 'string' ? l : (l.name ?? ''))),
  };
}

export type StationResult = { summary?: string; deviationsFromSpec?: string[]; openQuestions?: string[] };

export async function upsertPr(station: 'spec' | 'implement', issue: number, branch: string, title: string, result: StationResult, verify?: { ok: boolean }) {
  const o = await gh();
  const { owner, repo } = config;
  const { data: open } = await o.rest.pulls.list({ owner, repo, head: `${owner}:${branch}`, state: 'open' });
  const body = sanitizeMarkdown([
    `Factory PR for #${issue}.`,
    `**Summary:** ${result.summary ?? ''}`,
    result.openQuestions?.length ? `**Open questions:**\n${result.openQuestions.map((q) => `- ${q}`).join('\n')}` : '',
    result.deviationsFromSpec?.length ? `**Deviations from spec:**\n${result.deviationsFromSpec.map((d) => `- ${d}`).join('\n')}` : '',
    verify ? `**Verification:** ${verify.ok ? 'passed' : 'FAILED'}` : '',
    station === 'implement' ? `Closes #${issue}` : '',
  ].filter(Boolean).join('\n\n'));

  let pr: { number: number; draft?: boolean; node_id: string } | undefined = open[0];
  if (!pr) {
    const base = (await o.rest.repos.get({ owner, repo })).data.default_branch;
    pr = (await o.rest.pulls.create({ owner, repo, head: branch, base, title: `[factory] ${title} (#${issue})`, body, draft: true })).data;
  } else {
    await o.rest.pulls.update({ owner, repo, pull_number: pr.number, body });
  }
  if (station === 'implement' && verify?.ok && pr.draft) {
    await o.graphql(`mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { clientMutationId } }`, { id: pr.node_id });
  }
  return pr.number;
}

/** Before Dev runs: its PR exists and is a draft, so its pushes don't start Review mid-run. */
export async function prepareDevPr(issue: number, branch: string, title: string) {
  const o = await gh();
  const { owner, repo } = config;
  const { data: open } = await o.rest.pulls.list({ owner, repo, head: `${owner}:${branch}`, state: 'open' });
  let pr: { number: number; draft?: boolean; node_id: string } | undefined = open[0];
  if (!pr) {
    const base = (await o.rest.repos.get({ owner, repo })).data.default_branch;
    pr = (await o.rest.pulls.create({ owner, repo, head: branch, base, title: `[factory] ${title} (#${issue})`, body: `Factory PR for #${issue}.`, draft: true })).data;
  } else if (!pr.draft) {
    await o.graphql(`mutation($id: ID!) { convertPullRequestToDraft(input: { pullRequestId: $id }) { clientMutationId } }`, { id: pr.node_id });
  }
  return pr.number;
}

/** Every path the PR changes (both sides of a rename), for the protected-path check after Dev pushed. */
export async function prChangedPaths(pr: number) {
  const o = await gh();
  const files = await o.paginate(o.rest.pulls.listFiles, { owner: config.owner, repo: config.repo, pull_number: pr, per_page: 100 });
  return files.flatMap((f) => [f.filename, ...(f.previous_filename ? [f.previous_filename] : [])]);
}
