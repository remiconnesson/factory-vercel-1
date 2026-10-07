import type { NetworkPolicyRule } from '@vercel/sandbox';
import { config } from './config';

// Read-only Vercel access for sandbox agents (factory/skills/vercel-debug). FACTORY_VERCEL_TOKEN is a project-scoped
// token that stays on the host: the sandbox firewall adds it only to the GET endpoints below, and adds the project's
// automation bypass only on this project's own preview and production hosts.

const token = () => process.env.FACTORY_VERCEL_TOKEN ?? '';
export const vercelEnabled = () => Boolean(token() && config.vercel.teamId && config.vercel.projectId);

async function api<T>(path: string): Promise<T> {
  const url = new URL(path, 'https://api.vercel.com');
  url.searchParams.set('teamId', config.vercel.teamId);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
  if (!res.ok) throw new Error(`Vercel API ${res.status} on ${url.pathname}`);
  return (await res.json()) as T;
}

export type VercelContext = {
  teamId: string;
  projectId: string;
  branch: string;
  previewHost?: string; // the branch alias, which follows the branch's latest deployment
  productionHost?: string;
  bypass?: string; // host-only: injected by the firewall, never written into the sandbox
};

export async function vercelContext(branch: string): Promise<VercelContext> {
  const { teamId, projectId } = config.vercel;
  const project = await api<{ protectionBypass?: Record<string, { scope: string }>; targets?: { production?: { alias?: string[] } } }>(
    `/v9/projects/${projectId}`,
  );
  const bypass = Object.entries(project.protectionBypass ?? {}).find(([, v]) => v.scope === 'automation-bypass')?.[0];
  const { deployments } = await api<{ deployments: { uid: string; meta?: { githubCommitRef?: string } }[] }>(
    `/v6/deployments?projectId=${projectId}&limit=50`,
  );
  const latest = deployments.find((d) => d.meta?.githubCommitRef === branch);
  const previewHost = latest ? (await api<{ alias?: string[] }>(`/v13/deployments/${latest.uid}`)).alias?.find((a) => a.includes('-git-')) : undefined;
  return { teamId, projectId, branch, previewHost, productionHost: project.targets?.production?.alias?.[0], bypass };
}

/** What the agent reads in the sandbox: identifiers and URLs only, no credential. */
export function vercelEnvFile(ctx: VercelContext) {
  return [
    `TEAM_ID=${ctx.teamId}`,
    `PROJECT_ID=${ctx.projectId}`,
    `BRANCH=${ctx.branch}`,
    `PREVIEW_URL=${ctx.previewHost ? `https://${ctx.previewHost}` : ''}`,
    `PRODUCTION_URL=${ctx.productionHost ? `https://${ctx.productionHost}` : ''}`,
  ].join('\n') + '\n';
}

const readOnlyPaths = (projectId: string) => [
  '^/v6/deployments$', // deployments of the project
  '^/v13/deployments/[^/]+$', // one deployment: state, error, aliases
  '^/v3/deployments/[^/]+/events$', // build logs
  `^/v1/projects/${projectId}/deployments/[^/]+/runtime-logs$`, // runtime logs (live tail)
];

/** Firewall rules to add to the agent's lockdown policy. Rules apply in order; the last one answers everything else. */
export function vercelRules(ctx: VercelContext): Record<string, NetworkPolicyRule[]> {
  const auth = [{ headers: { Authorization: `Bearer ${token()}` } }];
  const rules: Record<string, NetworkPolicyRule[]> = {
    'api.vercel.com': [
      ...readOnlyPaths(ctx.projectId).map((regex): NetworkPolicyRule => ({ match: { method: ['GET'], path: { regex } }, transform: auth })),
      {
        response: {
          statusCode: 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Blocked by the factory sandbox: only the read-only deployment and log endpoints are allowed.' }),
        },
      },
    ],
  };
  for (const host of [ctx.previewHost, ctx.productionHost]) {
    if (host && ctx.bypass) rules[host] = [{ transform: [{ headers: { 'x-vercel-protection-bypass': ctx.bypass } }] }];
  }
  return rules;
}
