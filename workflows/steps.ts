// Step boundaries: the only host code that workflows import.
//
// Workflow functions run in a VM without Node.js, and the workflow bundle keeps every module a
// workflow file imports. So host code (Octokit, Connect, Sandbox, harnesses, libfx, Cedar) is loaded
// lazily inside step bodies, which the workflow build replaces with step calls.
import type { SandboxStation, Verdict } from '@/core/types';
import type { StationResult } from '@/lib/github';
import type { Change, DevAccess } from '@/lib/sandbox';
import type { Review } from '@/lib/review';

// GitHub reads and orchestrator writes that need no decision

export async function getIssue(issue: number) {
  'use step';
  return (await import('@/lib/github')).getIssue(issue);
}

export async function comment(issue: number, body: string) {
  'use step';
  await (await import('@/lib/github')).comment(issue, body);
}

export async function setLabels(issue: number, add: string[], remove: string[] = []) {
  'use step';
  await (await import('@/lib/github')).setLabels(issue, add, remove);
}

export async function upsertPr(station: 'spec' | 'implement', issue: number, branch: string, title: string, result: StationResult, verify?: { ok: boolean }) {
  'use step';
  return (await import('@/lib/github')).upsertPr(station, issue, branch, title, result, verify);
}

export async function prepareDevPr(issue: number, branch: string, title: string) {
  'use step';
  return (await import('@/lib/github')).prepareDevPr(issue, branch, title);
}

export async function latestReview(pr: number) {
  'use step';
  return (await import('@/lib/github')).latestReview(pr);
}

// Decisions: each obtains the rules' proof before acting (lib/handlers.ts)

export async function commitStationChanges(station: SandboxStation, a: { branch: string; baseSha: string; message: string; changes: Change[] }) {
  'use step';
  return (await import('@/lib/handlers')).commitStationChanges(station, a);
}

export async function readyForReview(station: SandboxStation, pr: number, facts: { verifyPassed: boolean; changedSomething: boolean }) {
  'use step';
  return (await import('@/lib/handlers')).readyForReview(station, pr, facts);
}

export async function sendBackIfAllowed(issue: number, pr: number, verdict: Verdict) {
  'use step';
  return (await import('@/lib/handlers')).sendBackIfAllowed(issue, pr, verdict);
}

export async function deleteSandboxIfMerged(issue: number) {
  'use step';
  return (await import('@/lib/handlers')).deleteSandboxIfMerged(issue);
}

// Host stations (libfx, read-only GitHub tools)

export async function runTriage(issue: number) {
  'use step';
  return (await import('@/lib/triage')).runTriage(issue);
}

export async function runReview(pr: number, headSha: string, issue: number) {
  'use step';
  return (await import('@/lib/review')).runReview(pr, headSha, issue);
}

export async function postReview(pr: number, headSha: string, review: Review) {
  'use step';
  await (await import('@/lib/review')).postReview(pr, headSha, review);
}

// Sandbox stations (HarnessAgent + fx in a Vercel Sandbox)

export async function ensureSandbox(issue: number) {
  'use step';
  return (await import('@/lib/sandbox')).ensureSandbox(issue);
}

export async function stopSandbox(sandboxId: string) {
  'use step';
  await (await import('@/lib/sandbox')).stopSandbox(sandboxId);
}

export async function prepareRepo(sandboxId: string, branch: string) {
  'use step';
  return (await import('@/lib/sandbox')).prepareRepo(sandboxId, branch);
}

export async function runAgentSlice(args: { sandboxId: string; station: SandboxStation; sessionId: string; prompt?: string; continuation?: unknown; dev?: DevAccess }) {
  'use step';
  return (await import('@/lib/sandbox')).runAgentSlice(args);
}

export async function runVerify(sandboxId: string, command: string) {
  'use step';
  return (await import('@/lib/sandbox')).runVerify(sandboxId, command);
}

export async function finishDevBranch(sandboxId: string, station: SandboxStation, dev: DevAccess, message: string) {
  'use step';
  return (await import('@/lib/sandbox')).finishDevBranch(sandboxId, station, dev, message);
}

export async function readResult(sandboxId: string): Promise<StationResult> {
  'use step';
  return (await import('@/lib/sandbox')).readResult(sandboxId);
}

export async function readChanges(sandboxId: string) {
  'use step';
  return (await import('@/lib/sandbox')).readChanges(sandboxId);
}
