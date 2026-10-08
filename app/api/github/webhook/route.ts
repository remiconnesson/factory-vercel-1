import { createHmac, timingSafeEqual } from 'node:crypto';
import { name } from '@gdp-ts/core';
import { triggerFor } from '@/core/events';
import { mayStart as decideStart } from '@/core/questions';
import { config, repoFull } from '@/lib/config';
import { mayStart } from '@/proofs/may-start';
import { startStation } from './start';

function validSignature(body: string, signature: string | null) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/** Shell: verify the signature, parse the event (core/events.ts), let the rules decide (core/rules/triggers.cedar), start. */
export async function POST(req: Request) {
  const body = await req.text();
  if (!validSignature(body, req.headers.get('x-hub-signature-256'))) return new Response('bad signature', { status: 401 });

  const event = req.headers.get('x-github-event');
  if (event === 'ping') return new Response('pong', { status: 200 });
  const delivery = req.headers.get('x-github-delivery') ?? crypto.randomUUID();

  const trigger = triggerFor(event, JSON.parse(body), { repo: repoFull, labels: config.labels });
  if ('ignore' in trigger) return ignored(trigger.ignore);

  return name(trigger, async (t) => {
    const proof = mayStart(t);
    if (!proof) {
      const { reasons } = decideStart(t.value, config.allowedUsers); // a forbid rule names itself; no permit names nothing
      return ignored(`${t.value.action} by ${t.value.actor.login} not allowed${reasons.length ? ` (${reasons.join('; ')})` : ''}`);
    }
    await startStation(t, delivery, proof);
    return new Response(`started ${t.value.action.replace(/^start/, '').toLowerCase()}`, { status: 202 });
  });
}

function ignored(reason: string) {
  console.log('[webhook] ignored:', reason);
  return new Response(`ignored: ${reason}`, { status: 202 });
}
