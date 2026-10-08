import type { Named } from '@gdp-ts/core';
import { start } from 'workflow/api';
import type { Trigger } from '@/core/types';
import type { MayStart } from '@/proofs/may-start';
import { triageWorkflow } from '@/workflows/triage';
import { codingStationWorkflow } from '@/workflows/coding-station';
import { reviewWorkflow } from '@/workflows/review';
import { cleanupWorkflow } from '@/workflows/cleanup';

/** Starts the workflow a trigger asks for. Demands proof that the rules allow this exact trigger. */
export async function startStation<T>(trigger: Named<T, Trigger>, delivery: string, _proof: MayStart<T>) {
  const t = trigger.value;
  switch (t.action) {
    case 'startTriage':
      return start(triageWorkflow, [{ issue: t.issue }]);
    case 'startSpec':
      return start(codingStationWorkflow, [{ station: 'spec', issue: t.issue, runId: `spec-${t.issue}-${delivery}` }]);
    case 'startImplement':
      return start(codingStationWorkflow, [{ station: 'implement', issue: t.issue, runId: `impl-${t.issue}-${delivery}` }]);
    case 'startRevision':
      return start(codingStationWorkflow, [{ station: 'implement', issue: t.issue, runId: `rev-${t.issue}-${delivery}`, revision: true }]);
    case 'startReview':
      return start(reviewWorkflow, [{ pr: t.pr.number, headSha: t.pr.headSha, issue: t.issue }]);
    case 'startCleanup':
      return start(cleanupWorkflow, [{ issue: t.issue }]);
  }
}
