// Observability (evlog, https://www.evlog.dev): one wide event per unit of work, so a single JSON line on stdout
// (Vercel runtime logs) says what happened, to what, and why.
// - Webhook request: the route is wrapped in withEvlog; one event per delivery.
// - Workflow step: each step in workflows/steps.ts runs in inStep; one event per attempt, carrying the workflow run ID.
// Code running inside either adds facts with note(). Workflow functions run in a VM without Node.js and never log:
// their steps do.
import { AsyncLocalStorage } from 'node:async_hooks';
import { createLogger, type RequestLogger } from 'evlog';
import { createEvlog } from 'evlog/next';
import { redact, service } from './log-config';

export const { withEvlog, useLogger: requestLogger } = createEvlog({ service, redact });

const scope = new AsyncLocalStorage<RequestLogger>();

/** Runs fn with logger as the current wide event (see note). */
export const within = <T>(logger: RequestLogger, fn: () => T) => scope.run(logger, fn);

/** Adds facts to the current wide event. A no-op outside a request or step (e.g. in `pnpm check`). */
export function note(fields: Record<string, unknown>) {
  scope.getStore()?.set(fields);
}

/** Records a problem that didn't fail the unit of work: the event's level becomes warn. */
export function warn(message: string, fields?: Record<string, unknown>) {
  scope.getStore()?.warn(message, fields);
}

/** Keeps events small and readable: the start of a long text. */
export const excerpt = (s: string | undefined, n = 300) => (s && s.length > n ? `${s.slice(0, n)}…` : s);
/** The end of a long output, where errors usually are. */
export const tail = (s: string | undefined, n = 1500) => (s && s.length > n ? `…${s.slice(-n)}` : s);

const short = (name: string) => name.split('//').pop() ?? name; // "step//./workflows/steps//getIssue" → "getIssue"

/**
 * Runs a workflow step body as one wide event: the step, its attempt (steps are retried), the workflow run, the facts
 * passed here (issue, PR, station, sandbox) and whatever the code below notes, then the outcome and duration.
 */
export async function inStep<T>(fields: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
  const { getStepMetadata, getWorkflowMetadata } = await import('workflow');
  const step = getStepMetadata();
  const run = getWorkflowMetadata();
  const log = createLogger({
    operation: `step:${short(step.stepName)}`,
    workflow: { name: short(run.workflowName), runId: run.workflowRunId },
    step: { name: short(step.stepName), id: step.stepId, attempt: step.attempt },
    deployment: process.env.VERCEL_DEPLOYMENT_ID,
    ...fields,
  });
  try {
    const result = await within(log, fn);
    log.set({ outcome: 'ok' });
    return result;
  } catch (e) {
    log.error(e instanceof Error ? e : String(e));
    log.set({ outcome: 'error' }); // the workflow retries the step, up to its retry limit
    throw e;
  } finally {
    log.emit();
  }
}
