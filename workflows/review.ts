import { postReview, runReview } from './steps';

export async function reviewWorkflow({ pr, headSha, issue }: { pr: number; headSha: string; issue: number }) {
  'use workflow';
  const review = await runReview(pr, headSha, issue);
  await postReview(pr, headSha, review);
}
