// The questions the factory asks its rules (core/rules/*.cedar), as pure functions of plain facts.
// Entities and context are built field by field: Cedar validates them against the schema and rejects any extra field,
// and callers often hold richer objects (a PR with its number, say).
import { decide, type Uid } from './decide';
import type { Capability, Decision, SandboxStation, Station, Trigger, Verdict } from './types';

type Entity = { uid: Uid; attrs: Record<string, string | boolean | { __entity: Uid }>; parents: Uid[] };

const uid = (type: string, id: string | number): Uid => ({ type: `Factory::${type}`, id: String(id) });
const ref = (u: Uid) => ({ __entity: u });
const station = (s: Station) => uid('Station', s);

function account(login: string, kind: string, allowedUsers: readonly string[]): Entity {
  const allowed = allowedUsers.includes(login.toLowerCase());
  return { uid: uid('Account', login), attrs: { kind }, parents: allowed ? [uid('Group', 'allowed')] : [] };
}

/** May this webhook event start what it asks for? */
export function mayStart(t: Trigger, allowedUsers: readonly string[]): Decision {
  const actor = account(t.actor.login, t.actor.kind, allowedUsers);
  if ('pr' in t) {
    const pr = { uid: uid('PullRequest', t.pr.number), parents: [], attrs: {
      fromFork: t.pr.fromFork, draft: 'draft' in t.pr ? t.pr.draft : false, merged: 'merged' in t.pr ? t.pr.merged : false,
    } };
    return decide({ principal: actor.uid, action: t.action, resource: pr.uid, entities: [actor, pr] });
  }
  const author = account(t.issueAuthor, 'User', allowedUsers);
  const issue = { uid: uid('Issue', t.issue), attrs: { author: ref(author.uid) }, parents: [] };
  return decide({ principal: actor.uid, action: t.action, resource: issue.uid, entities: [actor, author, issue] });
}

/** May this station's agent use this capability? */
export function mayUse(s: SandboxStation, c: Capability): Decision {
  return decide({ principal: station(s), action: 'use', resource: uid('Capability', c), entities: [] });
}

/** The paths this station may not change, with the rule that refused each. Empty means every change is allowed. */
export function refusedChanges(s: SandboxStation, paths: readonly string[]) {
  return paths.flatMap((path) => {
    const resource = uid('Path', path);
    const d = decide({ principal: station(s), action: 'change', resource, entities: [{ uid: resource, attrs: { path }, parents: [] }] });
    return d.allow ? [] : [{ path, rules: d.reasons }];
  });
}

/** May Dev's PR be marked ready for review? */
export function mayMarkReady(s: SandboxStation, facts: { verifyPassed: boolean; changesAllowed: boolean; changedSomething: boolean }): Decision {
  const pr = { uid: uid('PullRequest', 'pr'), attrs: { fromFork: false, draft: true, merged: false }, parents: [] };
  const { verifyPassed, changesAllowed, changedSomething } = facts;
  return decide({ principal: station(s), action: 'markReady', resource: pr.uid, context: { verifyPassed, changesAllowed, changedSomething }, entities: [pr] });
}

/** Should Review send the PR back to Dev? */
export function maySendBack(facts: { verdict: Verdict; reviewRounds: number }): Decision {
  const pr = { uid: uid('PullRequest', 'pr'), attrs: { fromFork: false, draft: false, merged: false }, parents: [] };
  const { verdict, reviewRounds } = facts;
  return decide({ principal: station('review'), action: 'sendBackToDev', resource: pr.uid, context: { verdict, reviewRounds }, entities: [pr] });
}

/** May the issue's sandbox be deleted, given its PR's state? */
export function mayDeleteSandbox(pr: { merged: boolean; fromFork: boolean }): Decision {
  const entity = { uid: uid('PullRequest', 'pr'), attrs: { merged: pr.merged, fromFork: pr.fromFork, draft: false }, parents: [] };
  return decide({ principal: station('cleanup'), action: 'deleteSandbox', resource: entity.uid, entities: [entity] });
}
