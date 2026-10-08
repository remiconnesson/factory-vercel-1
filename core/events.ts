// GitHub webhook payloads → the trigger they ask for. Pure: deciding whether it may run is the rules' job.
import type { Actor, Trigger } from './types';

type Labels = { readyToSpec: string; readyToImplement: string; changesRequested: string };
type Payload = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- GitHub's payloads, read defensively below

const actorOf = (p: Payload): Actor => ({ login: String(p.sender?.login ?? ''), kind: p.sender?.type === 'Bot' ? 'Bot' : 'User' });
const factoryIssue = (ref: unknown) => Number(/^factory\/issue-(\d+)$/.exec(String(ref))?.[1] ?? NaN);

export function triggerFor(event: string | null, p: Payload, target: { repo: string; labels: Labels }): Trigger | { ignore: string } {
  if (p.repository?.full_name !== target.repo) return { ignore: 'other repository' };
  const actor = actorOf(p);

  if (event === 'issues' && (p.action === 'opened' || p.action === 'labeled')) {
    const base = { actor, issue: Number(p.issue.number), issueAuthor: String(p.issue.user?.login ?? '') };
    if (p.action === 'opened') return { action: 'startTriage', ...base };
    const label = p.label?.name;
    if (label === target.labels.readyToSpec) return { action: 'startSpec', ...base };
    if (label === target.labels.readyToImplement) return { action: 'startImplement', ...base };
    if (label === target.labels.changesRequested) return { action: 'startRevision', ...base };
    return { ignore: `label ${label}` };
  }

  if (event === 'pull_request') {
    const pr = p.pull_request;
    const issue = factoryIssue(pr?.head?.ref);
    if (Number.isNaN(issue)) return { ignore: 'not a factory PR' };
    const fromFork = pr.head.repo?.full_name !== target.repo;
    if (p.action === 'ready_for_review' || p.action === 'synchronize') {
      return { action: 'startReview', actor, issue, pr: { number: pr.number, headSha: pr.head.sha, draft: Boolean(pr.draft), fromFork } };
    }
    if (p.action === 'closed') return { action: 'startCleanup', actor, issue, pr: { number: pr.number, merged: Boolean(pr.merged), fromFork } };
  }
  return { ignore: `${event}.${p.action}` };
}
