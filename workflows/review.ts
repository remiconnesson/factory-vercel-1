import { config } from '@/lib/config';
import { botReviewCount, comment, postReview, runReview, setLabels } from './steps';

export async function reviewWorkflow({ pr, headSha, issue }: { pr: number; headSha: string; issue: number }) {
  'use workflow';
  const review = await runReview(pr, headSha, issue);
  await postReview(pr, headSha, review);
  if (review.verdict !== 'changes-requested') return;
  // Send it back to Dev (the label starts a revision on the issue's sandbox), up to maxReviewRounds.
  const rounds = await botReviewCount(pr);
  if (rounds < config.maxReviewRounds) {
    await setLabels(issue, [config.labels.changesRequested]);
  } else {
    await comment(issue, `Review still requests changes after ${rounds} rounds, so this goes to a human: see PR #${pr}. Apply \`${config.labels.changesRequested}\` to send it back to Dev.`);
  }
}
