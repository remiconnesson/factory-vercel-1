import { destroyIssueSandbox } from './steps';

/** The issue's PR was merged: its sandbox (and snapshots) are no longer needed. */
export async function cleanupWorkflow({ issue }: { issue: number }) {
  'use workflow';
  await destroyIssueSandbox(issue);
}
