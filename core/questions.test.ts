// The business rules (core/rules/*.cedar) as a decision table.
import { describe, expect, it } from 'vitest';
import { mayDeleteSandbox, mayMarkReady, maySendBack, mayStart, mayUse, refusedChanges } from './questions';
import type { Actor, SandboxStation, Trigger } from './types';

const allowed = ['alice'];
const user = (login: string): Actor => ({ login, kind: 'User' });
const bot: Actor = { login: 'factory[bot]', kind: 'Bot' };
const onIssue = (action: 'startTriage' | 'startSpec' | 'startImplement' | 'startRevision', actor: Actor, issueAuthor = 'alice'): Trigger =>
  ({ action, actor, issue: 1, issueAuthor });
const review = (actor: Actor, pr: Partial<{ draft: boolean; fromFork: boolean }> = {}): Trigger =>
  ({ action: 'startReview', actor, issue: 1, pr: { number: 2, headSha: 'abc', draft: false, fromFork: false, ...pr } });
const cleanup = (pr: Partial<{ merged: boolean; fromFork: boolean }>): Trigger =>
  ({ action: 'startCleanup', actor: user('anyone'), issue: 1, pr: { number: 2, merged: false, fromFork: false, ...pr } });

describe('who may start a station (triggers.cedar)', () => {
  it.each<[string, Trigger, boolean]>([
    ['an allowed user opens an issue', onIssue('startTriage', user('alice')), true],
    ['logins match case-insensitively', onIssue('startTriage', user('Alice')), true],
    ['a stranger opens an issue', onIssue('startTriage', user('mallory'), 'mallory'), false],
    ["the bot labels an allowed user's issue ready-to-spec", onIssue('startSpec', bot), true],
    ["the bot labels a stranger's issue", onIssue('startSpec', bot, 'mallory'), false],
    ["an allowed user opts in a stranger's issue", onIssue('startSpec', user('alice'), 'mallory'), true],
    ['an allowed user releases implementation', onIssue('startImplement', user('alice')), true],
    ['no bot may release implementation', onIssue('startImplement', bot), false],
    ['the bot sends a PR back for revision', onIssue('startRevision', bot), true],
    ['an allowed user sends a PR back', onIssue('startRevision', user('alice')), true],
    ['a stranger sends a PR back', onIssue('startRevision', user('mallory')), false],
    ['the bot marks a PR ready', review(bot), true],
    ['an allowed user pushes to a ready PR', review(user('alice')), true],
    ['a stranger pushes to a ready PR', review(user('mallory')), false],
    ['drafts are not reviewed', review(bot, { draft: true }), false],
    ['fork PRs are not reviewed, even for allowed users', review(user('alice'), { fromFork: true }), false],
    ['a merged PR starts the cleanup', cleanup({ merged: true }), true],
    ['a PR closed without merging does not', cleanup({ merged: false }), false],
    ['a merged fork PR does not', cleanup({ merged: true, fromFork: true }), false],
  ])('%s', (_, trigger, allow) => expect(mayStart(trigger, allowed).allow).toBe(allow));
});

describe('what each agent may reach (agents.cedar)', () => {
  it.each<[SandboxStation, boolean, boolean]>([
    ['spec', true, false],
    ['implement', true, true],
    ['revise', true, true],
  ])('%s: Vercel %s, push %s', (station, vercel, push) => {
    expect(mayUse(station, 'vercel').allow).toBe(vercel);
    expect(mayUse(station, 'github-push').allow).toBe(push);
  });
});

describe('what each station may change (agents.cedar)', () => {
  it.each<[SandboxStation, string, boolean]>([
    ['spec', 'specs/1/PRODUCT.md', true],
    ['spec', 'app/page.tsx', false],
    ['spec', '.github/workflows/ci.yml', false],
    ['implement', 'app/api/health/route.ts', true],
    ['implement', 'specs/1/TECH.md', false],
    ['implement', '.github/CODEOWNERS', false],
    ['implement', 'pnpm-lock.yaml', false],
    ['revise', 'packages/web/package-lock.json', false],
    ['revise', 'lib/greeting.ts', true],
  ])('%s → %s: %s', (station, path, allow) => expect(refusedChanges(station, [path]).length === 0).toBe(allow));

  it('names the rule that refused a path', () => {
    expect(refusedChanges('implement', ['.github/workflows/ci.yml'])).toEqual([{ path: '.github/workflows/ci.yml', rules: ['no station changes CI'] }]);
  });
});

describe("the orchestrator's decisions (orchestrator.cedar)", () => {
  const ok = { verifyPassed: true, changesAllowed: true, changedSomething: true };
  it('marks a verified, allowed, non-empty implementation ready', () => expect(mayMarkReady('implement', ok).allow).toBe(true));
  it('blocks an empty first implementation', () => expect(mayMarkReady('implement', { ...ok, changedSomething: false }).allow).toBe(false));
  it('lets a revision that changed nothing go back to Review', () => expect(mayMarkReady('revise', { ...ok, changedSomething: false }).allow).toBe(true));
  it('blocks a failing verify', () => expect(mayMarkReady('revise', { ...ok, verifyPassed: false }).allow).toBe(false));
  it('blocks refused changes', () => expect(mayMarkReady('implement', { ...ok, changesAllowed: false }).allow).toBe(false));
  it('never lets Spec mark a PR ready', () => expect(mayMarkReady('spec', ok).allow).toBe(false));

  it.each<[string, number, boolean]>([
    ['changes-requested', 1, true],
    ['changes-requested', 2, true],
    ['changes-requested', 3, false],
    ['no-blocking-issues', 1, false],
  ])('send back: %s after %i rounds → %s', (verdict, reviewRounds, allow) =>
    expect(maySendBack({ verdict: verdict as 'changes-requested', reviewRounds }).allow).toBe(allow));

  it('deletes the sandbox of a merged PR only', () => {
    expect(mayDeleteSandbox({ merged: true, fromFork: false }).allow).toBe(true);
    expect(mayDeleteSandbox({ merged: false, fromFork: false }).allow).toBe(false);
    expect(mayDeleteSandbox({ merged: true, fromFork: true }).allow).toBe(false);
  });
});
