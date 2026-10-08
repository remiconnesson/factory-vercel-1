// Recent webhook deliveries to the factory and its answer to each (`started <station>` or `ignored: <reason>`).
// Usage: pnpm check deliveries [count] [--repo owner/name]
import { repoFull } from '../lib/config';
import { gh } from './_lib';

const args = process.argv.slice(2);
const repo = args.includes('--repo') ? args[args.indexOf('--repo') + 1] : repoFull;
const count = Number(args.find((a) => /^\d+$/.test(a)) ?? 15);
const hooks: { id: number; config: { url?: string } }[] = gh(['api', `repos/${repo}/hooks`], true);
const hook = hooks.find((h) => h.config.url?.endsWith('/api/github/webhook'));
if (!hook) {
  console.error(`No factory webhook on ${repo}.`);
  process.exit(1);
}
console.log(`${repo} → ${hook.config.url}`);
// Delivery ids exceed Number.MAX_SAFE_INTEGER: read them as text, never through JSON.parse.
const ids: string[] = gh(['api', `repos/${repo}/hooks/${hook.id}/deliveries?per_page=${count}`, '--jq', '.[].id']).split('\n').filter(Boolean);
for (const id of ids) {
  const d = gh(['api', `repos/${repo}/hooks/${hook.id}/deliveries/${id}`], true);
  const p = d.request?.payload ?? {};
  const what = [d.event, p.action].filter(Boolean).join('.');
  const subject = p.label?.name ?? (p.pull_request ? `PR #${p.pull_request.number}` : p.issue ? `#${p.issue.number}` : '');
  console.log(`${d.delivered_at}  ${String(d.status_code).padEnd(3)}  ${what.padEnd(30)} ${String(subject).padEnd(20)} by ${(p.sender?.login ?? '-').padEnd(24)} → ${d.response?.payload ?? ''}`);
}
