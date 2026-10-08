import { config } from '@/lib/config';
import { comment, postReview, runReview, sendBackIfAllowed } from './steps';

export async function reviewWorkflow({ pr, headSha, issue }: { pr: number; headSha: string; issue: number }) {
  'use workflow';
  const review = await runReview(pr, headSha, issue);
  await postReview(pr, headSha, review);
  if (review.verdict !== 'changes-requested') return;
  // The rules decide whether Dev gets another round (core/rules/orchestrator.cedar).
  const { sentBack, rounds } = await sendBackIfAllowed(issue, pr, review.verdict);
  if (!sentBack) {
    await comment(issue, `Review still requests changes after ${rounds} rounds, so this goes to a human: see PR #${pr}. Apply \`${config.labels.changesRequested}\` to send it back to Dev.`);
  }
}
