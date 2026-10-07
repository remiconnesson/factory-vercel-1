// Step boundaries: the only host code that workflows import.
//
// Workflow functions run in a VM without Node.js, and the workflow bundle keeps every module a
// workflow file imports. So host code (Octokit, Connect, Sandbox, harnesses, libfx) is loaded
// lazily inside step bodies, which the workflow build replaces with step calls.
import type { StationResult } from '@/lib/github';
import type { Change } from '@/lib/sandbox';
import type { Review } from '@/lib/review';

// GitHub writes and reads (orchestrator only, write token never reaches an agent)

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

export async function commitChanges(a: { branch: string; baseSha: string; message: string; changes: Change[]; allowedPaths?: string[] }) {
  'use step';
  return (await import('@/lib/commit')).commitChanges(a);
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

export async function createRunSandbox(runId: string) {
  'use step';
  return (await import('@/lib/sandbox')).createRunSandbox(runId);
}

export async function prepareRepo(sandboxId: string, branch: string) {
  'use step';
  return (await import('@/lib/sandbox')).prepareRepo(sandboxId, branch);
}

export async function runAgentSlice(args: { sandboxId: string; sessionId: string; prompt?: string; continuation?: unknown }) {
  'use step';
  return (await import('@/lib/sandbox')).runAgentSlice(args);
}

export async function runVerify(sandboxId: string, command: string) {
  'use step';
  return (await import('@/lib/sandbox')).runVerify(sandboxId, command);
}

export async function readResult(sandboxId: string): Promise<StationResult> {
  'use step';
  return (await import('@/lib/sandbox')).readResult(sandboxId);
}

export async function readChanges(sandboxId: string) {
  'use step';
  return (await import('@/lib/sandbox')).readChanges(sandboxId);
}

export async function destroySandbox(sandboxId: string) {
  'use step';
  await (await import('@/lib/sandbox')).destroySandbox(sandboxId);
}
