import { createHmac, timingSafeEqual } from 'node:crypto';
import { start } from 'workflow/api';
import { config, repoFull } from '@/lib/config';
import { triageWorkflow } from '@/workflows/triage';
import { codingStationWorkflow } from '@/workflows/coding-station';
import { reviewWorkflow } from '@/workflows/review';
import { cleanupWorkflow } from '@/workflows/cleanup';

function validSignature(body: string, signature: string | null) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

type Account = { login?: string; type?: string } | undefined;
const isAllowed = (a: Account) => !!a?.login && config.allowedUsers.includes(a.login.toLowerCase());
// GitHub Apps installed on the repo, including the factory's own Connect app.
const isBot = (a: Account) => a?.type === 'Bot';

export async function POST(req: Request) {
  const body = await req.text();
  if (!validSignature(body, req.headers.get('x-hub-signature-256'))) return new Response('bad signature', { status: 401 });

  const event = req.headers.get('x-github-event');
  const delivery = req.headers.get('x-github-delivery') ?? crypto.randomUUID();
  const p = JSON.parse(body);
  if (event === 'ping') return new Response('pong', { status: 200 });
  if (p.repository?.full_name !== repoFull) return ignored('other repository');

  // Every trigger must come from an allowed user, or be the factory's bot continuing a chain an allowed user started.
  const sender: Account = p.sender;

  if (event === 'issues' && p.action === 'opened') {
    if (!isAllowed(sender)) return ignored(`issue opened by ${sender?.login}`);
    await start(triageWorkflow, [{ issue: p.issue.number }]);
    return started('triage');
  }

  if (event === 'issues' && p.action === 'labeled') {
    const label = p.label?.name;
    if (label === config.labels.readyToSpec) {
      // Triage (the bot) labels issues an allowed user opened; an allowed user can also opt in anyone's issue.
      if (!isAllowed(sender) && !(isBot(sender) && isAllowed(p.issue.user))) return ignored(`${label} by ${sender?.login}`);
      await start(codingStationWorkflow, [{ station: 'spec', issue: p.issue.number, runId: `spec-${p.issue.number}-${delivery}` }]);
      return started('spec');
    }
    // Review asked for changes (the bot, on an issue an allowed user opened), or an allowed user sends it back.
    if (label === config.labels.changesRequested) {
      if (!isAllowed(sender) && !(isBot(sender) && isAllowed(p.issue.user))) return ignored(`${label} by ${sender?.login}`);
      await start(codingStationWorkflow, [{ station: 'implement', issue: p.issue.number, runId: `rev-${p.issue.number}-${delivery}`, revision: true }]);
      return started('revision');
    }
    // Human checkpoint: only an allowed user may release implementation, never a bot (including ours).
    if (label === config.labels.readyToImplement) {
      if (!isAllowed(sender)) return ignored(`${label} by ${sender?.login}`);
      await start(codingStationWorkflow, [{ station: 'implement', issue: p.issue.number, runId: `impl-${p.issue.number}-${delivery}` }]);
      return started('implement');
    }
  }

  // A merged factory PR: delete the issue's sandbox. Only someone with write access can merge, so any sender counts.
  if (event === 'pull_request' && p.action === 'closed') {
    const pr = p.pull_request;
    const match = /^factory\/issue-(\d+)$/.exec(pr.head.ref);
    if (!match || !pr.merged || pr.head.repo?.full_name !== repoFull) return ignored('not a merged factory PR');
    await start(cleanupWorkflow, [{ issue: Number(match[1]) }]);
    return started('cleanup');
  }

  if (event === 'pull_request' && ['ready_for_review', 'synchronize'].includes(p.action)) {
    const pr = p.pull_request;
    const match = /^factory\/issue-(\d+)$/.exec(pr.head.ref);
    if (!match || pr.draft) return ignored('not a ready factory PR');
    // Only branches in this repo: pushing one needs write access. Fork PRs never trigger the factory.
    if (pr.head.repo?.full_name !== repoFull) return ignored(`fork PR from ${pr.head.repo?.full_name}`);
    if (!isAllowed(sender) && !isBot(sender)) return ignored(`PR event by ${sender?.login}`);
    await start(reviewWorkflow, [{ pr: pr.number, headSha: pr.head.sha, issue: Number(match[1]) }]);
    return started('review');
  }

  return ignored(`${event}.${p.action}`);
}

const started = (station: string) => new Response(`started ${station}`, { status: 202 });
function ignored(reason: string) {
  console.log('[webhook] ignored:', reason);
  return new Response(`ignored: ${reason}`, { status: 202 });
}
