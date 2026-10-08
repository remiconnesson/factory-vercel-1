import { defineNodeInstrumentation } from 'evlog/next/instrumentation';
import { redact, service } from '@/lib/log-config';

// Starts evlog once per server instance: the webhook function and the workflow functions. On Vercel, whatever
// libraries print (Next.js, Workflow, the sandbox SDK) is captured as structured, redacted events too.
export const { register, onRequestError } = defineNodeInstrumentation({
  service,
  redact,
  captureOutput: process.env.VERCEL === '1',
});
