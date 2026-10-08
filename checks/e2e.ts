// Opens a test issue on the target and follows it through every station, printing each change. The human
// checkpoint (`ready-to-implement`) is applied only with --approve-spec. With --revise, after the first review it
// requests changes (unless Review already did) and follows Dev's revision to the second review.
// Usage: pnpm check e2e [--approve-spec] [--revise] [--follow <issue>] [--cleanup <issue>] [--repo owner/name]
import { config, repoFull } from '../lib/config';
import { deleteCheckSandbox, gh, report } from './_lib';

const args = process.argv.slice(2);
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const repo = flag('--repo') ?? repoFull;
const { labels } = config;

async function cleanup(issue: number) {
  const prs: { number: number }[] = gh(['pr', 'list', '-R', repo, '--state', 'open', '--head', `factory/issue-${issue}`, '--json', 'number'], true);
  for (const { number } of prs) gh(['pr', 'close', String(number), '-R', repo, '--delete-branch', '--comment', 'Closing: end-to-end check.']);
  gh(['issue', 'close', String(issue), '-R', repo, '--comment', 'Closing: end-to-end check.']);
  // Closing without merging keeps the issue's sandbox (it could be reopened); a check doesn't need it.
  const deleted = repo === repoFull && (await deleteCheckSandbox(issue));
  console.log(`closed #${issue}${prs.length ? ` and PR ${prs.map((p) => `#${p.number}`).join(', ')}, with its branch` : ''}${deleted ? ', deleted its sandbox' : ''}`);
}

const cleanupIssue = flag('--cleanup');
if (cleanupIssue) {
  await cleanup(Number(cleanupIssue));
  process.exit();
}

const r = report(`end to end on ${repo}`);
let issue = Number(flag('--follow') ?? 0);
if (!issue) {
  const url = gh(['issue', 'create', '-R', repo, '--title', 'Add a version endpoint', '--body',
    'Add `GET /api/version` returning `{ "version": "<version from package.json>" }`, not cached, with a test.\n\nThis is an end-to-end check of the software factory.']);
  issue = Number(url.split('/').pop());
  r.info(`opened ${url}`);
}

type State = { labels: string[]; comments: number; pr?: { number: number; isDraft: boolean; commits: number }; reviews: number };
function state(): State {
  const i = gh(['issue', 'view', String(issue), '-R', repo, '--json', 'labels,comments'], true);
  const prs = gh(['pr', 'list', '-R', repo, '--state', 'all', '--head', `factory/issue-${issue}`, '--json', 'number,isDraft,commits'], true);
  const pr = prs[0] && { number: prs[0].number, isDraft: prs[0].isDraft, commits: prs[0].commits.length };
  const reviews = pr ? gh(['api', `repos/${repo}/pulls/${pr.number}/reviews`, '--jq', 'length']) : '0';
  return { labels: i.labels.map((l: { name: string }) => l.name), comments: i.comments.length, pr, reviews: Number(reviews) };
}

const deadline = Date.now() + 60 * 60_000;
const revise = args.includes('--revise');
let last = '';
let approved = false;
let revisionAsked = false;
let forced = false; // Review found nothing blocking, so the revision may rightly change nothing
let commitsAtFirstReview = 0;
let s = state();
while (Date.now() < deadline) {
  const line = `labels=[${s.labels.join(', ')}] comments=${s.comments} pr=${s.pr ? `#${s.pr.number}${s.pr.isDraft ? ' draft' : ' ready'} commits=${s.pr.commits}` : '-'} reviews=${s.reviews}`;
  if (line !== last) r.info(line);
  last = line;
  const running = s.labels.includes(labels.running);
  if (s.labels.includes(labels.blocked) && !running) break;
  if (s.labels.includes(labels.needsInfo) && !running) break;
  if (s.reviews > 0 && !revise) break;
  if (revise && s.reviews >= 2 && !running) break;
  if (revise && s.reviews === 1 && !revisionAsked && !running) {
    commitsAtFirstReview = s.pr?.commits ?? 0;
    if (!s.labels.includes(labels.changesRequested)) {
      await new Promise((res) => setTimeout(res, 15_000)); // give Review's own label a moment
      s = state();
      if (!s.labels.includes(labels.changesRequested) && !s.labels.includes(labels.running)) {
        gh(['issue', 'edit', String(issue), '-R', repo, '--add-label', labels.changesRequested]);
        forced = true;
        r.info(`Review found nothing blocking; applied ${labels.changesRequested} to exercise the revision`);
      }
    } else r.info('Review requested changes itself');
    revisionAsked = true;
  }
  const specDone = s.pr?.isDraft && !running && !s.labels.includes(labels.readyToImplement);
  if (specDone && !approved) {
    if (!args.includes('--approve-spec')) {
      r.info(`Spec is done: review PR #${s.pr!.number}, apply ${labels.readyToImplement}, then: pnpm check e2e --follow ${issue}`);
      break;
    }
    gh(['issue', 'edit', String(issue), '-R', repo, '--add-label', labels.readyToImplement]);
    approved = true;
    r.info(`applied ${labels.readyToImplement}`);
  }
  await new Promise((res) => setTimeout(res, 20_000));
  s = state();
}

r.check('triage commented', s.comments > 0);
r.check('spec opened a PR', Boolean(s.pr));
if (approved || s.labels.includes(labels.readyToImplement)) {
  r.check('implementation pushed (PR has more than the spec commit)', (s.pr?.commits ?? 0) > 1);
  r.check('PR marked ready', s.pr?.isDraft === false);
  r.check('review posted', s.reviews > 0);
  if (revise) {
    if (!forced) r.check('revision pushed more commits', (s.pr?.commits ?? 0) > commitsAtFirstReview, `${commitsAtFirstReview} → ${s.pr?.commits}`);
    r.check('second review posted', s.reviews >= 2);
  }
}
r.check('not blocked', !s.labels.includes(labels.blocked));
r.info(`done. Clean up with: pnpm check e2e --cleanup ${issue}${repo === repoFull ? '' : ` --repo ${repo}`}`);
r.done();
