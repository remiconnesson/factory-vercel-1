import { execFileSync } from 'node:child_process';
import { Sandbox } from '@vercel/sandbox';
import { issueSandboxName } from '../lib/sandbox';

/** A check's output: one PASS/FAIL line per assertion, a summary, and a non-zero exit code on failure. */
export function report(title: string) {
  const t0 = Date.now();
  const fails: string[] = [];
  const ts = () => `${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s`;
  const fmt = (d: unknown) => (d === undefined || d === '' ? '' : `  (${String(d).replace(/\s+/g, ' ').slice(0, 180)})`);
  console.log(`check: ${title}`);
  const check = (name: string, ok: boolean, detail?: unknown) => {
    if (!ok) fails.push(name);
    console.log(`${ts()} ${ok ? 'PASS' : 'FAIL'}  ${name}${fmt(detail)}`);
    return ok;
  };
  return {
    check,
    info: (...a: unknown[]) => console.log(`${ts()} ....`, ...a),
    fail: (name: string, e: unknown) => check(name, false, e instanceof Error ? e.message : e),
    done() {
      console.log(fails.length ? `\n${fails.length} FAILED:\n - ${fails.join('\n - ')}` : '\nALL PASSED');
      process.exitCode = fails.length ? 1 : 0;
    },
  };
}

/** Runs a shell command in the sandbox (default: in the repo checkout). */
export async function sh(sbx: Sandbox, script: string, opts: { cwd?: string; sudo?: boolean } = {}) {
  const r = await sbx.runCommand({ cmd: 'bash', args: ['-lc', script], cwd: opts.cwd ?? `${sbx.cwd}/repo`, sudo: opts.sudo, env: { GIT_TERMINAL_PROMPT: '0' } });
  return { code: r.exitCode, out: ((await r.stdout()) + (await r.stderr())).trim() };
}

/** HTTP status of a request made from inside the sandbox (`000` when the host is unreachable). */
export async function httpStatus(sbx: Sandbox, url: string, opts: { method?: string; body?: string; maxTime?: number } = {}) {
  const body = opts.body ? `-H "content-type: application/json" -d '${opts.body}'` : '';
  const r = await sh(sbx, `curl -s -m ${opts.maxTime ?? 15} -o /dev/null -w "%{http_code}" -X ${opts.method ?? 'GET'} ${body} "${url}"`, { cwd: sbx.cwd });
  return r.out.slice(-3);
}

/** True when no secret appears in any sandbox process env or in the usual credential and config files. */
export async function secretsAbsent(sbx: Sandbox, secrets: (string | undefined)[]) {
  const procs = await sh(sbx, 'for p in /proc/[0-9]*; do tr "\\0" "\\n" < $p/environ 2>/dev/null; echo; done', { sudo: true, cwd: '/' });
  const files = await sh(sbx, 'for h in ~ ~/.ai-sdk-harness/.harness-bootstrap/*/implementation/home; do cat $h/.git-credentials $h/.gitconfig $h/.npmrc 2>/dev/null; done; cat repo/.git/config repo/.factory/*.env 2>/dev/null; true', { cwd: sbx.cwd });
  const blob = procs.out + files.out;
  return secrets.filter((s): s is string => Boolean(s)).every((s) => !blob.includes(s));
}

/** The first line of git's output that explains a rejection. */
export const why = (out: string) => out.split('\n').find((l) => /rule|declined|denied|reject|refus|workflow/i.test(l)) ?? out.slice(-160);

/** Calls the GitHub CLI as the signed-in user (the allowed human), returning parsed JSON when asked to. */
export function gh(args: string[], json = false) {
  const out = execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  return json ? JSON.parse(out || 'null') : out;
}

/**
 * Deletes a check's throwaway sandbox. Operator tooling: the factory itself deletes a sandbox only with the rules'
 * SandboxDeletable proof (its PR was merged).
 */
export async function deleteCheckSandbox(issue: number) {
  const sbx = await Sandbox.get({ name: issueSandboxName(issue) }).catch(() => undefined);
  await sbx?.delete({ deleteOrphanSnapshots: true });
  return Boolean(sbx);
}
