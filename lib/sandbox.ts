import { Sandbox } from '@vercel/sandbox';
import { createError } from 'evlog';
import { createVercelNetworkSandboxSession, resumeVercelNetworkSandboxSession } from '@ai-sdk/sandbox-vercel';
import { createCodingAgent } from './coding-agent';
import { config } from './config';
import { name, type Named } from '@gdp-ts/core';
import type { SandboxStation } from '@/core/types';
import type { SandboxDeletable } from '@/proofs/sandbox-deletable';
import { stationMayPush } from '@/proofs/station-may-push';
import { stationMayReadVercel } from '@/proofs/station-may-read-vercel';
import { mintDevToken, mintReadToken } from './github';
import type { IssueNumber } from './ids';
import { githubDevRules, githubEnvFile } from './github-access';
import { gatewayKey } from './ai-gateway';
import { excerpt, note, tail, warn } from './log';
import { vercelContext, vercelEnabled, vercelEnvFile, vercelRules } from './vercel';

const SANDBOX_TIMEOUT_MS = 2 * 60 * 60_000; // per session (the default is 5 minutes); a stopped sandbox resumes on use
const SANDBOX_VCPUS = 4;
const SNAPSHOT_RETENTION_MS = 30 * 24 * 60 * 60_000; // a sandbox idle for longer than this is rebuilt on next use

// Brokered: the key is added to outbound requests by the firewall and never exists in the sandbox.
const gatewayRule = (key: string) => ({
  'ai-gateway.vercel.sh': [{ transform: [{ headers: { Authorization: `Bearer ${key}` } }] }],
});

/** Phase 1: clone and install. GitHub read access is brokered and exists only during this phase. */
function setupPolicy(gatewayKeyValue: string, githubReadToken: string) {
  const basic = Buffer.from(`x-access-token:${githubReadToken}`).toString('base64');
  return {
    allow: {
      ...gatewayRule(gatewayKeyValue),
      // Apex domain: '*.github.com' would NOT match github.com.
      'github.com': [{ transform: [{ headers: { Authorization: `Basic ${basic}` } }] }],
      'registry.npmjs.org': [],
      // No '*' catch-all: SSH and SNI-less traffic would otherwise bypass brokering.
    },
  };
}

/** Phase 2: the agent runs. The model endpoint is the only reachable destination. */
export const lockdownPolicy = (gatewayKeyValue: string) => ({ allow: { ...gatewayRule(gatewayKeyValue) } });

/** The harness session ID is the native sandbox's name. */
export const native = (sandboxId: string) => Sandbox.get({ name: sandboxId });

const repoDir = (sbx: Sandbox) => `${sbx.cwd}/repo`;

// The harness runs the agent with its own HOME (for install-command harnesses like fx). Every orchestrator command
// runs under that same HOME, so whatever setup installs or caches (package-manager versions, npm caches, browsers)
// is exactly what the agent sees, and the orchestrator's verify checks the agent's environment, not a different one.
const agentHomes = new Map<string, Promise<string | undefined>>();
function agentHome(sbx: Sandbox) {
  let home = agentHomes.get(sbx.name);
  if (!home) {
    home = sbx
      .runCommand({ cmd: 'bash', args: ['-c', 'ls -d "$HOME"/.ai-sdk-harness/.harness-bootstrap/*/implementation/home 2>/dev/null | head -1'] })
      .then(async (r) => (await r.stdout()).trim() || undefined);
    agentHomes.set(sbx.name, home);
  }
  return home;
}

async function run(sbx: Sandbox, cmd: string, args: string[], cwd = repoDir(sbx)) {
  const home = await agentHome(sbx);
  const r = await sbx.runCommand({ cmd, args, cwd, env: { GIT_TERMINAL_PROMPT: '0', CI: '1', ...(home ? { HOME: home } : {}) } });
  const [stdout, stderr] = await Promise.all([r.stdout(), r.stderr()]);
  return { exitCode: r.exitCode, stdout, stderr };
}
const sh = (sbx: Sandbox, script: string, cwd = repoDir(sbx)) => run(sbx, 'bash', ['-lc', script], cwd);

/**
 * One sandbox per issue, named after the repo and issue. Spec creates it; Implement and every revision reuse it
 * (the checkout and dependencies are already there). Runs end with stopSandbox, which snapshots the filesystem;
 * the sandbox is deleted only when the PR is merged (destroyIssueSandbox).
 */
export const issueSandboxName = (issue: number) =>
  `factory-${config.owner}-${config.repo}-issue-${issue}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');

const apiStatus = (e: unknown) => (e as { response?: { status?: number } }).response?.status;

export async function ensureSandbox(issue: number) {
  const sandboxId = issueSandboxName(issue);
  note({ sandbox: sandboxId });
  try {
    const id = (await resumeVercelNetworkSandboxSession({ sandboxId })).id;
    note({ sandboxState: 'resumed' });
    return id;
  } catch (e) {
    const status = apiStatus(e);
    if (status === 410) await (await Sandbox.get({ name: sandboxId })).delete(); // snapshot expired: rebuild
    else if (status !== 404) throw e;
    note({ sandboxState: status === 410 ? 'rebuilt: its snapshot had expired' : 'created' });
  }
  const agent = await createCodingAgent();
  const session = await createVercelNetworkSandboxSession({
    sandboxId,
    ports: [4000], // the fx ACP bridge needs one exposed port
    template: await agent.getSandboxTemplate(),
    timeout: SANDBOX_TIMEOUT_MS,
    resources: { vcpus: SANDBOX_VCPUS },
    keepLastSnapshots: { count: 1, expiration: SNAPSHOT_RETENTION_MS },
  });
  return session.id;
}

/** End of a run: stopping snapshots the filesystem, so the next run on this issue resumes where this one ended. */
export async function stopSandbox(sandboxId: string) {
  try {
    await (await Sandbox.get({ name: sandboxId })).stop();
  } catch (e) {
    warn('stopping the sandbox failed; its session will time out instead', { error: String(e) }); // never fail the run over it
  }
}

/** Deletes the issue's sandbox and its snapshots. Demands proof that the rules allow it (the PR was merged). */
export async function destroyIssueSandbox<I>(issue: Named<I, IssueNumber>, _proof: SandboxDeletable<I>) {
  const sbx = await Sandbox.get({ name: issueSandboxName(issue.value) }).catch((e) => (apiStatus(e) === 404 ? undefined : Promise.reject(e)));
  await sbx?.delete({ deleteOrphanSnapshots: true });
  note({ sandbox: issueSandboxName(issue.value), sandboxDeleted: Boolean(sbx) });
  return Boolean(sbx);
}

export async function prepareRepo(sandboxId: string, branch: string) {
  const sbx = await native(sandboxId);
  const key = await gatewayKey();
  await sbx.update({ networkPolicy: setupPolicy(key, await mintReadToken()) });

  const url = `https://github.com/${config.owner}/${config.repo}.git`; // no token in the URL, ever
  if ((await sh(sbx, 'test -d repo/.git', sbx.cwd)).exitCode !== 0) {
    // First run on this issue: clone the factory branch if it exists (Implement), otherwise the default branch (Spec).
    const clone = await sh(sbx, `git clone --depth 50 --branch ${branch} ${url} repo || git clone --depth 50 ${url} repo`, sbx.cwd);
    if (clone.exitCode !== 0) throw createError({ message: 'clone failed', why: tail(clone.stderr), fix: 'Check that the GitHub App can read the repo (pnpm check tokens).' });
    note({ checkout: 'fresh clone' });
    await sh(sbx, [
      'echo ".factory/" >> .git/info/exclude', // the result file is never committed
      // Identity for the Dev agent's own commits (the orchestrator's commits go through the API).
      'git config user.name "Software Factory"',
      'git config user.email "factory@users.noreply.github.com"',
    ].join(' && '));
  } else {
    // Reused sandbox: start from what's on GitHub (the branch, or the default branch before it exists), dropping
    // anything a previous run left uncommitted. Ignored files (node_modules, .factory/) stay.
    const sync = await sh(sbx, [
      'git reset -q --hard && git clean -fdq',
      `(git fetch -q --depth 50 origin refs/heads/${branch} || git fetch -q --depth 50 origin HEAD)`,
      'git checkout -q -B tmp-factory-sync FETCH_HEAD',
    ].join(' && '));
    if (sync.exitCode !== 0) throw createError({ message: 'sync failed', why: tail(sync.stderr), fix: 'Check that the GitHub App can read the repo (pnpm check tokens).' });
    note({ checkout: 'synced the reused sandbox with GitHub' });
  }
  await sh(sbx, [`git checkout -q -B ${branch}`, 'git branch -q -D tmp-factory-sync 2>/dev/null || true', 'git tag -f factory-base', 'mkdir -p .factory', 'rm -f .factory/result.json'].join(' && '));
  const baseSha = (await sh(sbx, 'git rev-parse HEAD')).stdout.trim();

  const installStart = Date.now();
  const install = await sh(sbx, 'pnpm install --frozen-lockfile');
  note({ baseSha, installMs: Date.now() - installStart });
  if (install.exitCode !== 0) {
    throw createError({ message: 'install failed', why: tail(install.stderr, 3000), fix: 'Run `pnpm install --frozen-lockfile` on the branch: the lockfile may be out of date or a package unreachable.' });
  }

  // Lock down BEFORE the agent exists: no GitHub, no registries, no internet.
  await sbx.update({ networkPolicy: lockdownPolicy(key) });
  return { baseSha };
}

type Slice = { done: boolean; continuation?: unknown; text?: string };

/** Dev (Implement) only: push its factory branch and work on its PR. */
export type DevAccess = { pr: number };

const currentBranch = async (sbx: Sandbox) => (await sh(sbx, 'git branch --show-current')).stdout.trim();

/**
 * The agent's policy: lockdown, plus what the rules let this station use (core/rules/agents.cedar): read-only Vercel
 * access, and for Dev, pushing its branch and working on its PR. Refreshed every slice, so credentials stay fresh and
 * the preview host follows new deployments. Writes the identifiers the vercel-debug and github-dev skills read.
 */
function agentPolicy(sbx: Sandbox, key: string, station: SandboxStation, dev?: DevAccess) {
  return name(station, async (st) => {
    const allow: Record<string, unknown> = { ...lockdownPolicy(key).allow };
    const branch = await currentBranch(sbx);
    const vercel = stationMayReadVercel(st);
    if (vercel && vercelEnabled()) {
      const ctx = await vercelContext(branch);
      await sbx.writeFiles([{ path: `${repoDir(sbx)}/.factory/vercel.env`, content: Buffer.from(vercelEnvFile(ctx)) }]);
      Object.assign(allow, vercelRules(ctx, vercel));
    }
    const push = dev ? stationMayPush(st) : null;
    if (push && dev) {
      await sbx.writeFiles([{ path: `${repoDir(sbx)}/.factory/github.env`, content: Buffer.from(githubEnvFile(branch, dev.pr)) }]);
      Object.assign(allow, githubDevRules(await mintDevToken(), dev.pr, push));
    }
    // What the agent can reach this slice (hosts only, never the injected credentials).
    note({ access: { branch, vercel: Boolean(vercel && vercelEnabled()), push: Boolean(push && dev), hosts: Object.keys(allow) } });
    return { allow } as Parameters<Sandbox['update']>[0]['networkPolicy'];
  });
}

/** Applies the agent's policy to a sandbox, as runAgentSlice does once the harness has started. Used by the checks. */
export async function applyAgentPolicy(sandboxId: string, station: SandboxStation, dev?: DevAccess) {
  const sbx = await native(sandboxId);
  await sbx.update({ networkPolicy: await agentPolicy(sbx, await gatewayKey(), station, dev) });
}

/**
 * Dev, at the end: commit what the agent left uncommitted and push the branch, through the same brokered access.
 * Returns the pushed head.
 */
export async function finishDevBranch(sandboxId: string, station: SandboxStation, dev: DevAccess, message: string) {
  const sbx = await native(sandboxId);
  const key = await gatewayKey();
  await sbx.update({ networkPolicy: await agentPolicy(sbx, key, station, dev) });
  try {
    const branch = await currentBranch(sbx);
    await sh(sbx, 'git add -A');
    const dirty = (await sh(sbx, 'git diff --cached --quiet')).exitCode !== 0;
    if (dirty) {
      const c = await run(sbx, 'git', ['commit', '-q', '-m', message]);
      if (c.exitCode !== 0) throw createError({ message: 'commit failed', why: tail(c.stderr) });
    }
    const push = await run(sbx, 'git', ['push', '-q', 'origin', `HEAD:refs/heads/${branch}`]);
    if (push.exitCode !== 0) {
      throw createError({ message: 'push failed', why: tail(push.stderr), fix: 'GitHub refuses bot pushes outside factory/** and to .github/workflows (pnpm check dev).' });
    }
    const headSha = (await sh(sbx, 'git rev-parse HEAD')).stdout.trim();
    note({ branch, headSha, committedLeftovers: dirty });
    return { headSha, committedLeftovers: dirty };
  } finally {
    await sbx.update({ networkPolicy: lockdownPolicy(key) });
  }
}

export async function runAgentSlice(args: { sandboxId: string; station: SandboxStation; sessionId: string; prompt?: string; continuation?: unknown; dev?: DevAccess }): Promise<Slice> {
  const agent = await createCodingAgent();
  const sbx = await native(args.sandboxId);
  const key = await gatewayKey();
  // The harness refuses to start on a policy holding credential rules it did not add: start on plain lockdown.
  await sbx.update({ networkPolicy: lockdownPolicy(key) });
  const sandboxSession = await resumeVercelNetworkSandboxSession({ sandboxId: args.sandboxId });
  const session = await agent.createSession(
    args.continuation
      ? { sessionId: args.sessionId, continueFrom: args.continuation as never, sandboxSession }
      : { sessionId: args.sessionId, sandboxSession },
  );
  // Then replace whatever the harness configured with the agent's policy.
  await sbx.update({ networkPolicy: await agentPolicy(sbx, key, args.station, args.dev) });

  const result = args.continuation
    ? await agent.continueGenerate({ session })
    : await agent.generate({ session, prompt: args.prompt! });

  const tools: Record<string, number> = {};
  for (const call of result.steps.flatMap((st) => st.toolCalls)) tools[call.toolName] = (tools[call.toolName] ?? 0) + 1;
  const { inputTokens, outputTokens, totalTokens } = result.totalUsage;
  const agentFacts = { model: config.model, steps: result.steps.length, finishReason: result.finishReason, usage: { inputTokens, outputTokens, totalTokens }, tools };
  if (session.hasUnfinishedTurn()) {
    note({ agent: { ...agentFacts, done: false } }); // the next slice continues the turn
    return { done: false, continuation: await session.suspendTurn() };
  }
  await session.destroy(); // ends the harness runtime; the caller-owned sandbox survives
  note({ agent: { ...agentFacts, done: true, text: excerpt(result.text, 500) } });
  return { done: true, text: result.text };
}

export async function runVerify(sandboxId: string, command: string) {
  const started = Date.now();
  const r = await sh(await native(sandboxId), command);
  const output = (r.stdout + '\n' + r.stderr).slice(-8000);
  note({ verify: { ok: r.exitCode === 0, exitCode: r.exitCode, ms: Date.now() - started, output: r.exitCode === 0 ? undefined : tail(output, 3000) } });
  return { ok: r.exitCode === 0, output };
}

export async function readResult(sandboxId: string) {
  const r = await sh(await native(sandboxId), 'cat .factory/result.json');
  try {
    const result = JSON.parse(r.stdout);
    note({ result: { summary: excerpt(result.summary), openQuestions: result.openQuestions?.length ?? 0, deviations: result.deviationsFromSpec?.length ?? 0 } });
    return result;
  } catch {
    warn('the agent did not write a valid .factory/result.json', { stdout: excerpt(r.stdout, 200) });
    return { summary: 'The agent did not write .factory/result.json.' };
  }
}

export type Change = { path: string; mode: string; deleted?: boolean; contentBase64?: string };

export async function readChanges(sandboxId: string): Promise<Change[]> {
  const sbx = await native(sandboxId);
  await sh(sbx, 'git add -A');
  // -z: NUL-separated, safe for any file name. --raw gives the new file mode.
  const { stdout } = await run(sbx, 'git', ['diff', '--cached', '--raw', '--no-renames', '-z', 'factory-base']);
  const parts = stdout.split('\0').filter(Boolean);
  const changes: Change[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const [, newMode, , , status] = parts[i].slice(1).split(' '); // ":old new oldsha newsha S"
    const path = parts[i + 1];
    if (status === 'D') { changes.push({ path, mode: '100644', deleted: true }); continue; }
    if (newMode === '120000') throw createError({ message: 'Symlinks are not supported', why: `the agent created a symlink at ${path}`, fix: 'Ask for a regular file instead.' });
    const { stdout: b64 } = await run(sbx, 'base64', ['-w0', '--', path]); // argv, no shell
    changes.push({ path, mode: newMode, contentBase64: b64.trim() });
  }
  note({ changes: { count: changes.length, paths: changes.slice(0, 50).map((c) => (c.deleted ? `${c.path} (deleted)` : c.path)) } });
  return changes;
}
