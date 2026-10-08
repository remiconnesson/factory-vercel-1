import { defineProof, type Named, type Proof } from '@gdp-ts/core';
import { mayMarkReady, refusedChanges } from '@/core/questions';
import type { SandboxStation } from '@/core/types';
import { prChangedPaths } from '@/lib/github';
import type { PrNumber } from '@/lib/ids';

const PrMayBeReady = defineProof('PrMayBeReady');
/** The rules let station S mark PR P ready: verified, every changed path allowed, and (first implementation) not empty. */
export interface PrMayBeReady<S, P> extends Proof<'PrMayBeReady', [S, P]> {}

/** Reads the PR's changed paths itself: what the agent pushed is not filtered on the way. */
export async function prMayBeReady<S, P>(
  station: Named<S, SandboxStation>,
  pr: Named<P, PrNumber>,
  facts: { verifyPassed: boolean; changedSomething: boolean },
): Promise<PrMayBeReady<S, P> | null> {
  const changesAllowed = refusedChanges(station.value, await prChangedPaths(pr.value)).length === 0;
  return mayMarkReady(station.value, { ...facts, changesAllowed }).allow ? PrMayBeReady.prove(station, pr) : null;
}
