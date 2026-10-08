// Mistakes the type checker must keep rejecting (gdp-ts). Every `@ts-expect-error` below is a line that must not
// compile: if one starts compiling, tsc reports the unused directive. This file never runs.
import { name } from '@gdp-ts/core';
import type { SandboxStation } from '@/core/types';
import { githubDevRules } from '@/lib/github-access';
import { markPrReady } from '@/lib/github';
import { IssueNumber, PrNumber } from '@/lib/ids';
import { destroyIssueSandbox } from '@/lib/sandbox';
import { vercelRules, type VercelContext } from '@/lib/vercel';
import { sandboxDeletable } from '@/proofs/sandbox-deletable';
import { stationMayPush } from '@/proofs/station-may-push';
import { stationMayReadVercel } from '@/proofs/station-may-read-vercel';

declare const ctx: VercelContext;

export async function mistakes(token: string, a: SandboxStation, b: SandboxStation) {
  // @ts-expect-error Dev's firewall rules without the rules' say-so
  githubDevRules(token, 1);

  name(a, b, (s, t) => {
    const read = stationMayReadVercel(s);
    const push = stationMayPush(s);
    if (!read || !push) return;
    // @ts-expect-error a Vercel proof is not a push proof
    githubDevRules(token, 1, read);
    // @ts-expect-error a push proof is not a Vercel proof
    vercelRules(ctx, push);
    const other = stationMayPush(t);
    if (!other) return;
    githubDevRules(token, 1, other); // fine: a proof about some station, used for rules that don't name one
  });

  await name(IssueNumber(1), IssueNumber(2), async (i, j) => {
    const proof = await sandboxDeletable(i);
    if (!proof) return;
    await destroyIssueSandbox(i, proof); // fine
    // @ts-expect-error a proof about issue 1 can't delete issue 2's sandbox
    await destroyIssueSandbox(j, proof);
    // @ts-expect-error a raw issue number is not a named one
    await destroyIssueSandbox(IssueNumber(1), proof);
  });

  await name(PrNumber(3), async (pr) => {
    // @ts-expect-error marking a PR ready needs the rules' say-so
    await markPrReady(pr);
  });
}
