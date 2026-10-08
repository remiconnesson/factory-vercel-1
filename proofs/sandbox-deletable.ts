import { defineProof, type Named, type Proof } from '@gdp-ts/core';
import { mayDeleteSandbox } from '@/core/questions';
import { factoryPrState } from '@/lib/github';
import type { IssueNumber } from '@/lib/ids';

const SandboxDeletable = defineProof('SandboxDeletable');
/** The rules let the cleanup delete issue I's sandbox: its factory PR is merged. */
export interface SandboxDeletable<I> extends Proof<'SandboxDeletable', [I]> {}

/** Asks GitHub for the PR's state itself, rather than trusting the event that triggered the cleanup. */
export async function sandboxDeletable<I>(issue: Named<I, IssueNumber>): Promise<SandboxDeletable<I> | null> {
  const pr = await factoryPrState(issue.value);
  return pr && mayDeleteSandbox(pr).allow ? SandboxDeletable.prove(issue) : null;
}
