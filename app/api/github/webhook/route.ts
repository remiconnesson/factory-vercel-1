import { createHmac, timingSafeEqual } from 'node:crypto';
import { start } from 'workflow/api';
import { config } from '@/lib/config';
import { triageWorkflow } from '@/workflows/triage';
import { codingStationWorkflow } from '@/workflows/coding-station';
import { reviewWorkflow } from '@/workflows/review';

function validSignature(body: string, signature: string | null) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export async function POST(req: Request) {
  const body = await req.text();
  if (!validSignature(body, req.headers.get('x-hub-signature-256'))) return new Response('bad signature', { status: 401 });

  const event = req.headers.get('x-github-event');
  const delivery = req.headers.get('x-github-delivery') ?? crypto.randomUUID();
  const p = JSON.parse(body);
  if (event === 'ping') return new Response('pong', { status: 200 });
  if (p.repository?.full_name !== `${config.owner}/${config.repo}`) return new Response('ignored', { status: 202 });

  if (event === 'issues' && p.action === 'opened') {
    await start(triageWorkflow, [{ issue: p.issue.number }]);
  }

  if (event === 'issues' && p.action === 'labeled') {
    const label = p.label?.name;
    if (label === config.labels.readyToSpec) {
      await start(codingStationWorkflow, [{ station: 'spec', issue: p.issue.number, runId: `spec-${p.issue.number}-${delivery}` }]);
    }
    // Human checkpoint: only a human may release implementation, never a bot (including ours).
    if (label === config.labels.readyToImplement && p.sender?.type === 'User') {
      await start(codingStationWorkflow, [{ station: 'implement', issue: p.issue.number, runId: `impl-${p.issue.number}-${delivery}` }]);
    }
  }

  if (event === 'pull_request' && ['ready_for_review', 'synchronize'].includes(p.action)) {
    const pr = p.pull_request;
    const match = /^factory\/issue-(\d+)$/.exec(pr.head.ref);
    if (match && !pr.draft) {
      await start(reviewWorkflow, [{ pr: pr.number, headSha: pr.head.sha, issue: Number(match[1]) }]);
    }
  }

  return new Response('ok', { status: 202 });
}
