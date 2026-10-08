// The functional core's vocabulary. Pure types: no I/O, no SDKs.

export type Station = 'triage' | 'spec' | 'implement' | 'revise' | 'review' | 'cleanup';
/** Stations whose agent runs in a sandbox. */
export type SandboxStation = 'spec' | 'implement' | 'revise';
/** What a sandbox agent can reach beyond the model. */
export type Capability = 'vercel' | 'github-push';
export type Verdict = 'changes-requested' | 'no-blocking-issues';

export type Actor = { login: string; kind: 'User' | 'Bot' };

/** A webhook event the factory may act on, with the facts the rules need. */
export type Trigger =
  | { action: 'startTriage' | 'startSpec' | 'startImplement' | 'startRevision'; actor: Actor; issue: number; issueAuthor: string }
  | { action: 'startReview'; actor: Actor; issue: number; pr: { number: number; headSha: string; draft: boolean; fromFork: boolean } }
  | { action: 'startCleanup'; actor: Actor; issue: number; pr: { number: number; merged: boolean; fromFork: boolean } };

export type Decision = { allow: boolean; reasons: string[] };
