import { z } from 'zod';
import { renderStation } from './stations';
import { readOnlyGithubTools, runHostAgent, submitTool } from './host-agent';
import { gh, sanitizeMarkdown } from './github';
import { config, repoFull } from './config';

const Review = z.object({
  summary: z.string().max(5000),
  comments: z.array(z.object({ path: z.string(), line: z.number().int().positive(), body: z.string().max(2000) })).max(30),
});
export type Review = z.infer<typeof Review>;

export async function runReview(pr: number, headSha: string, issue: number) {
  const station = renderStation('review', { repoFull, pr, headSha, issue });
  let review: Review | undefined;
  const tools = [
    ...(await readOnlyGithubTools(['getPullRequestContext', 'listPullRequestFiles', 'getFileContent', 'compareCommits'])),
    submitTool('submit_review', 'Submit the review.', Review, (r) => (review = r)),
  ];
  await runHostAgent({ prompt: station.prompt, tools, model: station.model });
  if (!review) throw new Error('Reviewer did not submit a review');
  return review;
}

export async function postReview(pr: number, headSha: string, r: Review) {
  const o = await gh();
  const { owner, repo } = config;
  const base = { owner, repo, pull_number: pr, commit_id: headSha, event: 'COMMENT' as const, body: sanitizeMarkdown(r.summary) };
  try {
    await o.rest.pulls.createReview({ ...base, comments: r.comments.map((c) => ({ path: c.path, line: c.line, side: 'RIGHT' as const, body: sanitizeMarkdown(c.body) })) });
  } catch (e) {
    if ((e as { status?: number }).status !== 422) throw e; // a comment pointed outside the diff: post the comments in the body instead
    const fallback = r.comments.map((c) => `- \`${c.path}:${c.line}\`: ${sanitizeMarkdown(c.body)}`).join('\n');
    await o.rest.pulls.createReview({ ...base, body: `${base.body}\n\n${fallback}` });
  }
}
