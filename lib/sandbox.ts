import { Sandbox } from '@vercel/sandbox';
import { createVercelNetworkSandboxSession, resumeVercelNetworkSandboxSession } from '@ai-sdk/sandbox-vercel';
import { createCodingAgent } from './coding-agent';
import { config } from './config';
import { mintReadToken } from './github';
import { gatewayKey } from './ai-gateway';
import { vercelContext, vercelEnabled, vercelEnvFile, vercelRules } from './vercel';

const SANDBOX_TIMEOUT_MS = 2 * 60 * 60_000; // the default is 5 minutes
const SANDBOX_VCPUS = 4;

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

export async function createRunSandbox(runId: string) {
  const agent = await createCodingAgent();
  const session = await createVercelNetworkSandboxSession({
    sandboxId: `factory-${runId}`.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
    ports: [4000], // the fx ACP bridge needs one exposed port
    template: await agent.getSandboxTemplate(),
    timeout: SANDBOX_TIMEOUT_MS,
    resources: { vcpus: SANDBOX_VCPUS },
  });
  return session.id;
}

export async function prepareRepo(sandboxId: string, branch: string) {
  const sbx = await native(sandboxId);
  const key = await gatewayKey();
  await sbx.update({ networkPolicy: setupPolicy(key, await mintReadToken()) });

  const url = `https://github.com/${config.owner}/${config.repo}.git`; // no token in the URL, ever
  // Clone the factory branch if it already exists (Implement), otherwise the default branch (Spec).
  const clone = await sh(sbx, `git clone --depth 50 --branch ${branch} ${url} repo || git clone --depth 50 ${url} repo`, sbx.cwd);
  if (clone.exitCode !== 0) throw new Error(`clone failed: ${clone.stderr}`);

  await sh(sbx, [
    `git checkout -B ${branch}`,
    'git tag factory-base',
    'echo ".factory/" >> .git/info/exclude', // the result file is never committed
    'mkdir -p .factory',
  ].join(' && '));
  const baseSha = (await sh(sbx, 'git rev-parse HEAD')).stdout.trim();

  const install = await sh(sbx, 'pnpm install --frozen-lockfile');
  if (install.exitCode !== 0) throw new Error(`install failed: ${install.stderr.slice(-4000)}`);

  // Lock down BEFORE the agent exists: no GitHub, no registries, no internet.
  await sbx.update({ networkPolicy: lockdownPolicy(key) });
  return { baseSha };
}

type Slice = { done: boolean; continuation?: unknown; text?: string };

/**
 * The agent's policy: lockdown plus read-only Vercel access to the project (when configured). Refreshed every slice,
 * so the preview host follows new deployments. Writes the identifiers the vercel-debug skill reads.
 */
async function agentPolicy(sbx: Sandbox, key: string) {
  const lockdown = lockdownPolicy(key);
  if (!vercelEnabled()) return lockdown;
  const ctx = await vercelContext((await sh(sbx, 'git branch --show-current')).stdout.trim());
  await sbx.writeFiles([{ path: `${repoDir(sbx)}/.factory/vercel.env`, content: Buffer.from(vercelEnvFile(ctx)) }]);
  return { allow: { ...lockdown.allow, ...vercelRules(ctx) } };
}

export async function runAgentSlice(args: { sandboxId: string; sessionId: string; prompt?: string; continuation?: unknown }): Promise<Slice> {
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
  await sbx.update({ networkPolicy: await agentPolicy(sbx, key) });

  const result = args.continuation
    ? await agent.continueGenerate({ session })
    : await agent.generate({ session, prompt: args.prompt! });

  if (session.hasUnfinishedTurn()) {
    return { done: false, continuation: await session.suspendTurn() };
  }
  await session.destroy(); // ends the harness runtime; the caller-owned sandbox survives
  return { done: true, text: result.text };
}

export async function runVerify(sandboxId: string, command: string) {
  const r = await sh(await native(sandboxId), command);
  return { ok: r.exitCode === 0, output: (r.stdout + '\n' + r.stderr).slice(-8000) };
}

export async function readResult(sandboxId: string) {
  const r = await sh(await native(sandboxId), 'cat .factory/result.json');
  try { return JSON.parse(r.stdout); } catch { return { summary: 'The agent did not write .factory/result.json.' }; }
}

export async function destroySandbox(sandboxId: string) {
  await (await resumeVercelNetworkSandboxSession({ sandboxId })).destroy();
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
    if (newMode === '120000') throw new Error(`Symlinks are not supported: ${path}`);
    const { stdout: b64 } = await run(sbx, 'base64', ['-w0', '--', path]); // argv, no shell
    changes.push({ path, mode: newMode, contentBase64: b64.trim() });
  }
  return changes;
}
