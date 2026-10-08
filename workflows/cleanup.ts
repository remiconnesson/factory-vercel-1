import { deleteSandboxIfMerged } from './steps';

/** The issue's PR was closed: if the rules agree it was merged, its sandbox (and snapshots) go. */
export async function cleanupWorkflow({ issue }: { issue: number }) {
  'use workflow';
  await deleteSandboxIfMerged(issue);
}
