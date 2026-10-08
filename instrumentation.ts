import type { Instrumentation } from 'next';
import type { createInstrumentation } from 'evlog/next/instrumentation/create';
import { redact, service } from '@/lib/log-config';

// Starts evlog once per server instance (the webhook function and the workflow functions) and reports unhandled
// request errors as structured events. Without captureOutput: it re-captures evlog's own events from stdout and wraps
// each one, escaped, in the `message` of another event.
//
// Not evlog's defineNodeInstrumentation: it loads this module with an import the bundler is told to ignore, so Vercel's
// file tracing never ships evlog with the functions and every request fails with "Cannot find package 'evlog'".
// A plain dynamic import gets bundled.
let evlog: ReturnType<typeof createInstrumentation> | undefined;

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { createInstrumentation } = await import('evlog/next/instrumentation/create');
  evlog = createInstrumentation({ service, redact });
  await evlog.register();
}

// Next's request and context types are looser than evlog's (header arrays, optional fields): flatten them to strings.
export const onRequestError: Instrumentation.onRequestError = (error, request, context) =>
  evlog?.onRequestError(
    error instanceof Error ? error : new Error(String(error)),
    { path: request.path, method: request.method, headers: Object.fromEntries(Object.entries(request.headers).map(([k, v]) => [k, [v ?? ''].flat().join(', ')])) },
    { routerKind: context.routerKind, routePath: context.routePath, routeType: context.routeType, renderSource: context.renderSource ?? '' },
  );
