import { createHmac, timingSafeEqual } from 'node:crypto';
import { name } from '@gdp-ts/core';
import { triggerFor } from '@/core/events';
import { mayStart as decideStart } from '@/core/questions';
import { config, repoFull } from '@/lib/config';
import { note, requestLogger, withEvlog, within } from '@/lib/log';
import { mayStart } from '@/proofs/may-start';
import { startStation } from './start';

function validSignature(body: string, signature: string | null) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/**
 * Shell: verify the signature, parse the event (core/events.ts), let the rules decide (core/rules/triggers.cedar), start.
 * One wide event per delivery: what GitHub sent, the trigger, the rules' decision, and the workflow run it started.
 */
export const POST = withEvlog((req: Request) => within(requestLogger(), () => handle(req)));

async function handle(req: Request) {
  const body = await req.text();
  const event = req.headers.get('x-github-event');
  const delivery = req.headers.get('x-github-delivery') ?? crypto.randomUUID();
  note({ github: { event, delivery } });
  if (!validSignature(body, req.headers.get('x-hub-signature-256'))) return outcome('rejected', 'bad signature', 401);
  if (event === 'ping') return outcome('pong', 'ping', 200);

  const payload = JSON.parse(body);
  note({
    github: {
      action: payload.action,
      repository: payload.repository?.full_name,
      sender: payload.sender?.login,
      issue: payload.issue?.number,
      pr: payload.pull_request?.number,
      label: payload.label?.name,
    },
  });
  const trigger = triggerFor(event, payload, { repo: repoFull, labels: config.labels });
  if ('ignore' in trigger) return outcome('ignored', trigger.ignore);
  note({ trigger: { action: trigger.action, issue: trigger.issue, actor: trigger.actor, pr: 'pr' in trigger ? trigger.pr : undefined } });

  return name(trigger, async (t) => {
    const proof = mayStart(t);
    if (!proof) {
      const { reasons } = decideStart(t.value, config.allowedUsers); // a forbid rule names itself; no permit names nothing
      note({ decision: { allow: false, reasons } });
      return outcome('ignored', `${t.value.action} by ${t.value.actor.login} not allowed${reasons.length ? ` (${reasons.join('; ')})` : ''}`);
    }
    note({ decision: { allow: true } });
    const run = await startStation(t, delivery, proof);
    note({ started: { workflowRunId: run.runId } });
    return outcome('started', `started ${t.value.action.replace(/^start/, '').toLowerCase()}`);
  });
}

function outcome(kind: 'started' | 'ignored' | 'rejected' | 'pong', text: string, status = 202) {
  note({ outcome: kind, reason: kind === 'started' ? undefined : text });
  return new Response(kind === 'ignored' ? `ignored: ${text}` : text, { status });
}
