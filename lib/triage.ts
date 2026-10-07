import { z } from 'zod';
import { renderStation } from './stations';
import { readOnlyGithubTools, runHostAgent, submitTool } from './host-agent';
import { getIssue } from './github';
import { repoFull } from './config';

const Verdict = z.object({
  decision: z.enum(['ready', 'needs-info']),
  summary: z.string().max(2000),
  questions: z.array(z.string().max(500)).max(10).default([]),
  possibleDuplicates: z.array(z.number()).max(5).default([]),
});
export type Verdict = z.infer<typeof Verdict>;

export async function runTriage(issue: number) {
  const { title, body } = await getIssue(issue);
  const station = renderStation('triage', { repoFull, issue, issueTitle: title, issueBody: body });
  let verdict: Verdict | undefined;
  const tools = [
    ...(await readOnlyGithubTools(['getIssueContext', 'searchIssues', 'getRepositoryTree', 'getFileContent'])),
    submitTool('submit_triage', 'Submit the triage decision.', Verdict, (v) => (verdict = v)),
  ];
  await runHostAgent({ prompt: station.prompt, tools, model: station.model });
  if (!verdict) throw new Error('Triage agent did not submit a verdict');
  return verdict;
}
