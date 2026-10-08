// The sandbox stations' mechanics, with the real lib/sandbox code: fx in the template, the brokered clone, lockdown,
// AI Gateway brokering, no secret inside, one agent turn, and the orchestrator's verify.
import { repoFull } from '../lib/config';
import { gatewayKey } from '../lib/ai-gateway';
import { mintReadToken } from '../lib/github';
import { destroyIssueSandbox, ensureSandbox, lockdownPolicy, native, prepareRepo, readChanges, readResult, runAgentSlice, runVerify, stopSandbox } from '../lib/sandbox';
import { httpStatus, report, secretsAbsent, sh } from './_lib';

const r = report(`sandbox stations on ${repoFull}`);
const issue = 80000 + Math.floor(Math.random() * 9999); // a throwaway issue number: its sandbox is deleted at the end
const runId = `check-sandbox-${issue}`;
const sandboxId = await ensureSandbox(issue);
const sbx = await native(sandboxId);
const completion = `https://ai-gateway.vercel.sh/v1/chat/completions`;
const completionBody = JSON.stringify({ model: 'anthropic/claude-haiku-4.5', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] });
try {
  const fx = await sh(sbx, 'f=$(ls -d ~/.ai-sdk-harness/.harness-bootstrap/fx/implementation/home/.local/bin/fx) && $f --version', { cwd: sbx.cwd });
  r.check('fx is installed in the template', fx.code === 0, fx.out);

  const { baseSha } = await prepareRepo(sandboxId, `factory/check-${Date.now()}`);
  const remote = await sh(sbx, 'git remote get-url origin; test -d node_modules && echo installed');
  r.check('repo cloned through the brokered read token and installed', remote.out.includes('installed'), `${baseSha.slice(0, 7)} ${remote.out.split('\n')[0]}`);
  r.check('remote URL carries no credential', /^https:\/\/github\.com\/[^@\s]+$/m.test(remote.out));

  for (const url of ['https://github.com', 'https://api.github.com', 'https://registry.npmjs.org', 'https://example.com', 'https://api.vercel.com']) {
    const code = await httpStatus(sbx, url, { maxTime: 8 });
    r.check(`lockdown: ${url} unreachable`, code === '000', code);
  }
  r.check('lockdown: AI Gateway works with no key sent from the sandbox', (await httpStatus(sbx, completion, { method: 'POST', body: completionBody, maxTime: 30 })) === '200');

  const key = await gatewayKey();
  const readTok = await mintReadToken();
  r.check('no secret in the sandbox (gateway credential, GitHub read token)', await secretsAbsent(sbx, [key, readTok]));

  // Control: the model is reachable only because the firewall injects the credential.
  await sbx.update({ networkPolicy: { allow: { 'ai-gateway.vercel.sh': [] } } });
  const gw = await httpStatus(sbx, completion, { method: 'POST', body: completionBody, maxTime: 30 });
  r.check('AI Gateway without the injected key: rejected', gw === '401' || gw === '403', gw);
  await sbx.update({ networkPolicy: lockdownPolicy(key) });

  const slice = await runAgentSlice({ sandboxId, sessionId: `${runId}-0`, prompt: [
    'This is a check. Create the file check.txt containing "ok". Then run `curl -s -m 5 https://example.com >/dev/null && echo REACHED || echo BLOCKED`.',
    'Write .factory/result.json: {"summary": "<the curl result>"}. Change nothing else.',
  ].join('\n') });
  r.check('agent turn completed', slice.done, (slice.text ?? '').slice(0, 160));
  const result = await readResult(sandboxId);
  r.check('result file read back', /BLOCKED/i.test(String(result.summary)), result.summary);
  const changes = await readChanges(sandboxId);
  r.check('changes read back (and .factory/ excluded)', changes.some((c) => c.path === 'check.txt') && !changes.some((c) => c.path.startsWith('.factory/')), changes.map((c) => c.path).join(', '));
  const verify = await runVerify(sandboxId, './scripts/verify');
  r.check('./scripts/verify passes under lockdown, in the agent environment', verify.ok, verify.ok ? '' : verify.output.slice(-300));

  // The next run on the same issue resumes the stopped sandbox: same checkout and dependencies, leftovers dropped.
  await sh(sbx, 'touch .git/factory-check-marker');
  await stopSandbox(sandboxId);
  r.check('the next run resumes the same sandbox by name', (await ensureSandbox(issue)) === sandboxId);
  await prepareRepo(sandboxId, `factory/check-${issue}-again`);
  const reused = await sh(await native(sandboxId), 'test -f .git/factory-check-marker && test -d node_modules && echo reused; test -e check.txt && echo leftover || echo clean');
  r.check('checkout and dependencies kept across the stop', reused.out.includes('reused'), reused.out);
  r.check('uncommitted leftovers of the previous run dropped', reused.out.includes('clean'), reused.out);
} catch (e) {
  r.fail('sandbox', e);
} finally {
  await destroyIssueSandbox(issue);
}
r.done();
