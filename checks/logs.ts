// The factory's wide events (lib/log.ts) from Vercel's runtime logs, as a timeline: every webhook delivery and
// workflow step about an issue, a workflow run or a delivery, with what each found, decided and why, and its errors.
// Events of the workflow runs an issue started are included even when they don't name the issue (sandbox steps).
// Usage: pnpm check logs <issue | wrun_… | delivery id> [--since 24h] [--json]
// Reads the linked project through the Vercel CLI. Vercel keeps runtime logs for a limited time.
import { execFileSync } from 'node:child_process';

type Event = Record<string, unknown> & { timestamp?: string };
type Plain = { timestamp: number; text: string };

const args = process.argv.slice(2);
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const term = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!term) {
  console.log('usage: pnpm check logs <issue | wrun_… | delivery id> [--since 24h] [--json]');
  process.exit(1);
}

const raw = execFileSync('vercel', ['logs', '--json', '--since', flag('--since') ?? '24h', '--limit', '1000'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
const events: Event[] = [];
const plain: Plain[] = []; // what libraries print (Workflow's own errors name the run)
for (const line of raw.split('\n')) {
  if (!line.trim()) continue;
  const record = JSON.parse(line) as { timestamp: number; message?: string; logs?: { message?: string }[] };
  for (const { message = '' } of record.logs ?? [{ message: record.message }]) {
    if (message.startsWith('{')) {
      try {
        events.push(JSON.parse(message));
        continue;
      } catch { /* not ours */ }
    }
    if (message) plain.push({ timestamp: record.timestamp, text: message });
  }
}

const get = (e: Event, path: string) => path.split('.').reduce<unknown>((v, k) => (v as Record<string, unknown> | undefined)?.[k], e);
const runOf = (e: Event) => (get(e, 'workflow.runId') ?? get(e, 'started.workflowRunId')) as string | undefined;
const about = (e: Event) =>
  term.startsWith('wrun_') ? runOf(e) === term
  : /^\d{1,7}$/.test(term) ? [get(e, 'issue'), get(e, 'github.issue'), get(e, 'trigger.issue')].includes(Number(term))
  : get(e, 'github.delivery') === term;

const runs = new Set(events.filter(about).map(runOf).filter(Boolean));
const seen = new Set<string>(); // the CLI can return a record twice
const picked = events
  .filter((e) => about(e) || runs.has(runOf(e) ?? ''))
  .filter((e) => !seen.has(JSON.stringify(e)) && Boolean(seen.add(JSON.stringify(e))))
  .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
const notes = plain.filter((p) => p.text.includes(term) || [...runs].some((r) => p.text.includes(r!)));

if (args.includes('--json')) {
  for (const e of picked) console.log(JSON.stringify(e));
  process.exit(0);
}

const common = new Set(['operation', 'workflow', 'step', 'deployment', 'timestamp', 'level', 'service', 'environment', 'commitHash', 'region',
  'durationMs', 'duration', 'outcome', 'requestId', 'method', 'path', 'status', 'github', 'started', 'reason', 'error']);
const show = (v: unknown) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 400 ? `${s.slice(0, 400)}…` : s;
};
const time = (t: string | number | undefined) => new Date(t ?? 0).toISOString().slice(11, 23);

console.log(`${picked.length} events about ${term}${runs.size ? ` (runs: ${[...runs].join(', ')})` : ''}\n`);
for (const e of picked) {
  const flagged = e.level === 'error' ? 'ERROR ' : e.level === 'warn' ? 'WARN  ' : '';
  if (e.path) {
    const g = (e.github ?? {}) as Record<string, unknown>;
    const what = [`${g.event}${g.action ? `.${g.action}` : ''}`, g.issue && `#${g.issue}`, g.pr && `PR #${g.pr}`, g.label && `[${g.label}]`, g.sender && `by ${g.sender}`].filter(Boolean).join(' ');
    console.log(`${time(e.timestamp)}  ${flagged}webhook  ${what} → ${e.outcome}${e.reason ? `: ${e.reason}` : ''}${runOf(e) ? `  ${runOf(e)}` : ''}  (delivery ${g.delivery})`);
  } else {
    const w = (e.workflow ?? {}) as Record<string, unknown>;
    const s = (e.step ?? {}) as Record<string, unknown>;
    console.log(`${time(e.timestamp)}  ${flagged}${w.name} › ${s.name} (attempt ${s.attempt})  ${e.outcome}  ${e.duration ?? ''}`);
  }
  for (const [k, v] of Object.entries(e)) if (!common.has(k) && v !== undefined) console.log(`              ${k}: ${show(v)}`);
  const err = e.error as Record<string, unknown> | undefined;
  if (err) {
    console.log(`              error: ${err.message}`);
    if (err.why) console.log(`              why: ${show(err.why)}`);
    if (err.fix) console.log(`              fix: ${err.fix}`);
  }
}
if (notes.length) {
  console.log('\nOther log lines naming it:');
  for (const n of notes) console.log(`${time(n.timestamp)}  ${show(n.text)}`);
}
