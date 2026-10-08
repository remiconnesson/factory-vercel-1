import { describe, expect, it } from 'vitest';
import { triggerFor } from './events';

const target = { repo: 'acme/app', labels: { readyToSpec: 'ready-to-spec', readyToImplement: 'ready-to-implement', changesRequested: 'factory:changes-requested' } };
const repository = { full_name: 'acme/app' };
const sender = { login: 'alice', type: 'User' };
const issue = { number: 7, user: { login: 'alice' } };
const pr = (extra: object = {}) => ({ number: 9, draft: false, merged: false, head: { ref: 'factory/issue-7', sha: 'abc', repo: repository }, ...extra });

describe('webhook payload → trigger', () => {
  it('ignores other repositories', () => expect(triggerFor('issues', { action: 'opened', issue, sender, repository: { full_name: 'x/y' } }, target)).toEqual({ ignore: 'other repository' }));
  it('opened issue → triage', () =>
    expect(triggerFor('issues', { action: 'opened', issue, sender, repository }, target)).toEqual({ action: 'startTriage', actor: { login: 'alice', kind: 'User' }, issue: 7, issueAuthor: 'alice' }));
  it.each([
    ['ready-to-spec', 'startSpec'],
    ['ready-to-implement', 'startImplement'],
    ['factory:changes-requested', 'startRevision'],
  ])('label %s → %s', (label, action) => expect(triggerFor('issues', { action: 'labeled', label: { name: label }, issue, sender, repository }, target)).toMatchObject({ action, issue: 7 }));
  it('ignores other labels', () => expect(triggerFor('issues', { action: 'labeled', label: { name: 'bug' }, issue, sender, repository }, target)).toEqual({ ignore: 'label bug' }));
  it('ready factory PR → review', () =>
    expect(triggerFor('pull_request', { action: 'ready_for_review', pull_request: pr(), sender, repository }, target)).toMatchObject({ action: 'startReview', issue: 7, pr: { number: 9, draft: false, fromFork: false } }));
  it('marks fork PRs', () =>
    expect(triggerFor('pull_request', { action: 'synchronize', pull_request: pr({ head: { ref: 'factory/issue-7', sha: 'abc', repo: { full_name: 'mallory/app' } } }), sender, repository }, target)).toMatchObject({ pr: { fromFork: true } }));
  it('closed factory PR → cleanup', () =>
    expect(triggerFor('pull_request', { action: 'closed', pull_request: pr({ merged: true }), sender, repository }, target)).toMatchObject({ action: 'startCleanup', pr: { merged: true } }));
  it('ignores PRs that are not the factory\'s', () =>
    expect(triggerFor('pull_request', { action: 'closed', pull_request: pr({ head: { ref: 'feature/x', sha: 'abc', repo: repository } }), sender, repository }, target)).toEqual({ ignore: 'not a factory PR' }));
});
