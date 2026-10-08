// Step boundaries: the only host code that workflows import.
//
// Workflow functions run in a VM without Node.js, and the workflow bundle keeps every module a workflow file
// imports. So host code (Octokit, Connect, Sandbox, harnesses, libfx, Cedar, evlog) is loaded lazily inside step
// bodies, which the workflow build replaces with step calls.
//
// Every step runs in inStep (lib/log.ts): one wide event per attempt, with the identifiers passed here.
import type { SandboxStation, Verdict } from '@/core/types';
import type { StationResult } from '@/lib/github';
import type { Change, DevAccess } from '@/lib/sandbox';
import type { Review } from '@/lib/review';

// GitHub reads and orchestrator writes that need no decision

export async function getIssue(issue: number) {
  'use step';
  const { inStep } = await import('@/lib/log');
  return inStep({ issue }, async () => (await import('@/lib/github')).getIssue(issue));
}

export async function comment(issue: number, body: string) {
  'use step';
  const { inStep } = await import('@/lib/log');
  await inStep({ issue }, async () => (await import('@/lib/github')).comment(issue, body));
}

export async function setLabels(issue: number, add: string[], remove: string[] = []) {
  'use step';
  const { inStep } = await import('@/lib/log');
  await inStep({ issue, labels: { add, remove } }, async () => (await import('@/lib/github')).setLabels(issue, add, remove));
}

export async function upsertPr(station: 'spec' | 'implement', issue: number, branch: string, title: string, result: StationResult, verify?: { ok: boolean }) {
  'use step';
  const { inStep } = await import('@/lib/log');
  return inStep({ issue, station, branch }, async () => (await import('@/lib/github')).upsertPr(station, issue, branch, title, result, verify));
}

export async function prepareDevPr(issue: number, branch: string, title: string) {
  'use step';
  const { inStep } = await import('@/lib/log');
  return inStep({ issue, branch }, async () => (await import('@/lib/github')).prepareDevPr(issue, branch, title));
}

export async function latestReview(pr: number) {
  'use step';
  const { inStep } = await import('@/lib/log');
  return inStep({ pr }, async () => (await import('@/lib/github')).latestReview(pr));
}

// Decisions: each obtains the rules' proof before acting (lib/handlers.ts)

export async function commitStationChanges(station: SandboxStation, a: { branch: string; baseSha: string; message: string; changes: Change[] }) {
  'use step';
  const { inStep } = await import('@/lib/log');
  return inStep({ station, branch: a.branch, baseSha: a.baseSha }, async () => (await import('@/lib/handlers')).commitStationChanges(station, a));
}

export async function readyForReview(station: SandboxStation, pr: number, facts: { verifyPassed: boolean; changedSomething: boolean }) {
  'use step';
  const { inStep } = await import('@/lib/log');
  return inStep({ station, pr, facts }, async () => (await import('@/lib/handlers')).readyForReview(station, pr, facts));
}

export async function sendBackIfAllowed(issue: number, pr: number, verdict: Verdict) {
  'use step';
  const { inStep } = await import('@/lib/log');
  return inStep({ issue, pr, verdict }, async () => (await import('@/lib/handlers')).sendBackIfAllowed(issue, pr, verdict));
}

export async function deleteSandboxIfMerged(issue: number) {
  'use step';
  const { inStep } = await import('@/lib/log');
  return inStep({ issue }, async () => (await import('@/lib/handlers')).deleteSandboxIfMerged(issue));
}

// Host stations (libfx, read-only GitHub tools)

export async function runTriage(issue: number) {
  'use step';
  const { inStep } = await import('@/lib/log');
  return inStep({ issue, station: 'triage' }, async () => (await import('@/lib/triage')).runTriage(issue));
}

export async function runReview(pr: number, headSha: string, issue: number) {
  'use step';
  const { inStep } = await import('@/lib/log');
  return inStep({ issue, pr, headSha, station: 'review' }, async () => (await import('@/lib/review')).runReview(pr, headSha, issue));
}

export async function postReview(pr: number, headSha: string, review: Review) {
  'use step';
  const { inStep } = await import('@/lib/log');
  await inStep({ pr, headSha }, async () => (await import('@/lib/review')).postReview(pr, headSha, review));
}

// Sandbox stations (HarnessAgent + fx in a Vercel Sandbox)

export async function ensureSandbox(issue: number) {
  'use step';
  const { inStep } = await import('@/lib/log');
  return inStep({ issue }, async () => (await import('@/lib/sandbox')).ensureSandbox(issue));
}

export async function stopSandbox(sandboxId: string) {
  'use step';
  const { inStep } = await import('@/lib/log');
  await inStep({ sandbox: sandboxId }, async () => (await import('@/lib/sandbox')).stopSandbox(sandboxId));
}

export async function prepareRepo(sandboxId: string, branch: string) {
  'use step';
  const { inStep } = await import('@/lib/log');
  return inStep({ sandbox: sandboxId, branch }, async () => (await import('@/lib/sandbox')).prepareRepo(sandboxId, branch));
}

export async function runAgentSlice(args: { sandboxId: string; station: SandboxStation; sessionId: string; prompt?: string; continuation?: unknown; dev?: DevAccess }) {
  'use step';
  const { inStep } = await import('@/lib/log');
  const fields = { sandbox: args.sandboxId, station: args.station, session: args.sessionId, pr: args.dev?.pr, continued: Boolean(args.continuation) };
  return inStep(fields, async () => (await import('@/lib/sandbox')).runAgentSlice(args));
}

export async function runVerify(sandboxId: string, command: string) {
  'use step';
  const { inStep } = await import('@/lib/log');
  return inStep({ sandbox: sandboxId, command }, async () => (await import('@/lib/sandbox')).runVerify(sandboxId, command));
}

export async function finishDevBranch(sandboxId: string, station: SandboxStation, dev: DevAccess, message: string) {
  'use step';
  const { inStep } = await import('@/lib/log');
  return inStep({ sandbox: sandboxId, station, pr: dev.pr }, async () => (await import('@/lib/sandbox')).finishDevBranch(sandboxId, station, dev, message));
}

export async function readResult(sandboxId: string): Promise<StationResult> {
  'use step';
  const { inStep } = await import('@/lib/log');
  return inStep({ sandbox: sandboxId }, async () => (await import('@/lib/sandbox')).readResult(sandboxId));
}

export async function readChanges(sandboxId: string) {
  'use step';
  const { inStep } = await import('@/lib/log');
  return inStep({ sandbox: sandboxId }, async () => (await import('@/lib/sandbox')).readChanges(sandboxId));
}
