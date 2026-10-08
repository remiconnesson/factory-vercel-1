import { defineProof, type Named, type Proof } from '@gdp-ts/core';
import { maySendBack as decideSendBack } from '@/core/questions';
import type { Verdict } from '@/core/types';
import { botReviewCount } from '@/lib/github';
import type { PrNumber } from '@/lib/ids';

const MaySendBack = defineProof('MaySendBack');
/** The rules let Review send PR P back to Dev (changes requested, rounds left). */
export interface MaySendBack<P> extends Proof<'MaySendBack', [P]> {}

/** Counts the review rounds itself, from the reviews on the PR. */
export async function maySendBack<P>(pr: Named<P, PrNumber>, verdict: Verdict): Promise<MaySendBack<P> | null> {
  const reviewRounds = await botReviewCount(pr.value);
  return decideSendBack({ verdict, reviewRounds }).allow ? MaySendBack.prove(pr) : null;
}
