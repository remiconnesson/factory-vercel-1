import { connectGithubToken } from '@github-tools/sdk/connect';
import { createOctokit, resolveGithubToken } from '@github-tools/sdk';
import { config, repoFull } from './config';

// Read-only token narrowed to ONE repo: used by agents' tools and for the sandbox clone.
export const readToken = connectGithubToken(config.connector, {
  preset: 'repo-explorer',
  params: { repositories: [repoFull] },
});

// Write token narrowed to ONE repo: used only by orchestrator steps, never by an agent.
// Scope strings mirror GitHub App permissions (see PRESET_CONNECT_SCOPES in @github-tools/sdk/connect).
export const writeToken = connectGithubToken(config.connector, {
  params: {
    repositories: [repoFull],
    scopes: ['metadata:read', 'contents:write', 'pull_requests:write', 'issues:write'],
  },
});

export async function mintReadToken() {
  return resolveGithubToken(readToken);
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
