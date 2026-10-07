import { config } from '@/lib/config';
import { comment, runTriage, setLabels } from './steps';

export async function triageWorkflow({ issue }: { issue: number }) {
  'use workflow';
  const v = await runTriage(issue);
  if (v.decision === 'ready') {
    await comment(issue, `**Triage:** ${v.summary}`);
    await setLabels(issue, [config.labels.readyToSpec], [config.labels.needsInfo]); // → triggers Spec
  } else {
    await comment(issue, `**Triage, more information needed:**\n\n${v.questions.map((q) => `- ${q}`).join('\n')}`);
    await setLabels(issue, [config.labels.needsInfo]);
  }
}
