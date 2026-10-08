// The shell's decision points, called from workflow steps: name the values, obtain the proof the rules allow the
// action, then act, or report why not. Every sensitive function demands its proof, so none of this can be skipped.
// Each records its decision on the step's wide event (lib/log.ts): `decision: { allow, why }`.
import { name } from '@gdp-ts/core';
import { refusedChanges } from '@/core/questions';
import type { SandboxStation, Verdict } from '@/core/types';
import { changesAllowed } from '@/proofs/changes-allowed';
import { maySendBack } from '@/proofs/may-send-back';
import { prMayBeReady } from '@/proofs/pr-may-be-ready';
import { sandboxDeletable } from '@/proofs/sandbox-deletable';
import { commitChanges } from './commit';
import { botReviewCount, markPrReady, prChangedPaths, sendBackToDev } from './github';
import { IssueNumber, PrNumber } from './ids';
import { note } from './log';
import { destroyIssueSandbox, type Change } from './sandbox';

/** A path list for the wide event: the count and the first few, not hundreds of files. */
const summarize = (paths: string[]) => ({ count: paths.length, paths: paths.slice(0, 50) });

const describe = (refused: { path: string; rules: string[] }[]) =>
  refused.map((r) => `\`${r.path}\`${r.rules.length ? ` (${r.rules.join('; ')})` : ''}`).join(', ');

/** Spec: commit its changes from the host, if the rules allow every path. */
export function commitStationChanges(station: SandboxStation, a: { branch: string; baseSha: string; message: string; changes: Change[] }) {
  note({ changes: summarize(a.changes.map((c) => c.path)) });
  return name(station, a.changes, async (st, changes) => {
    const proof = changesAllowed(st, changes);
    if (!proof) {
      const refused = refusedChanges(station, a.changes.map((c) => c.path));
      note({ decision: { action: 'commit', allow: false, refused } });
      return { committed: false as const, why: `it changes paths it may not: ${describe(refused)}` };
    }
    const sha = await commitChanges(changes, a, proof);
    note({ decision: { action: 'commit', allow: true }, commit: sha });
    return { committed: true as const };
  });
}

/** Dev: mark its PR ready for review, if the rules allow it (verified, allowed paths only, not empty). */
export function readyForReview(station: SandboxStation, pr: number, facts: { verifyPassed: boolean; changedSomething: boolean }) {
  return name(station, PrNumber(pr), async (st, p) => {
    const proof = await prMayBeReady(st, p, facts);
    if (proof) {
      note({ decision: { action: 'markReady', allow: true } });
      await markPrReady(p, proof);
      return { ready: true as const };
    }
    const refused = refusedChanges(station, await prChangedPaths(pr));
    const why = [
      !facts.verifyPassed && 'verification still fails',
      refused.length > 0 && `the branch changes paths it may not: ${describe(refused)}`,
      !facts.changedSomething && station === 'implement' && 'it changed nothing',
    ].filter(Boolean).join('; ') || 'the rules did not allow it';
    note({ decision: { action: 'markReady', allow: false, why, refused } });
    return { ready: false as const, why };
  });
}

/** Review: send the PR back to Dev, if the rules allow it (changes requested, rounds left). */
export function sendBackIfAllowed(issue: number, pr: number, verdict: Verdict) {
  return name(PrNumber(pr), async (p) => {
    const proof = await maySendBack(p, verdict);
    if (proof) await sendBackToDev(IssueNumber(issue), p, proof);
    const rounds = await botReviewCount(pr);
    note({ decision: { action: 'sendBackToDev', allow: Boolean(proof) }, reviewRounds: rounds });
    return { sentBack: Boolean(proof), rounds };
  });
}

/** Cleanup: delete the issue's sandbox, if the rules allow it (its PR is merged). */
export function deleteSandboxIfMerged(issue: number) {
  return name(IssueNumber(issue), async (i) => {
    const proof = await sandboxDeletable(i);
    note({ decision: { action: 'deleteSandbox', allow: Boolean(proof) } }); // prState says why
    return proof ? { deleted: await destroyIssueSandbox(i, proof) } : { deleted: false };
  });
}
