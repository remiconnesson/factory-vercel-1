// Configuration (data). The business rules live in core/rules/*.cedar.
export const config = {
  connector: process.env.FACTORY_CONNECTOR ?? 'github/factory',
  owner: process.env.FACTORY_OWNER!,
  repo: process.env.FACTORY_REPO!,
  model: process.env.FACTORY_MODEL ?? 'anthropic/claude-opus-5.5',
  // The target's Vercel project, which sandbox agents may inspect read-only (see lib/vercel.ts).
  vercel: { teamId: process.env.FACTORY_VERCEL_TEAM_ID ?? '', projectId: process.env.FACTORY_VERCEL_PROJECT_ID ?? '' },
  // GitHub logins whose actions may trigger a station. Empty means nobody: the factory ignores every event.
  allowedUsers: (process.env.FACTORY_ALLOWED_USERS ?? '').split(',').map((u) => u.trim().toLowerCase()).filter(Boolean),
  labels: {
    readyToSpec: 'ready-to-spec',
    needsInfo: 'needs-info',
    readyToImplement: 'ready-to-implement',
    running: 'factory:running',
    blocked: 'factory:blocked',
    changesRequested: 'factory:changes-requested', // Review (or a human) sends the PR back to Dev
  },
  branch: (issue: number) => `factory/issue-${issue}`,
};
export const repoFull = `${config.owner}/${config.repo}`;
