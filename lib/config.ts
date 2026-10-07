export const config = {
  connector: process.env.FACTORY_CONNECTOR ?? 'github/factory',
  owner: process.env.FACTORY_OWNER!,
  repo: process.env.FACTORY_REPO!,
  model: process.env.FACTORY_MODEL ?? 'anthropic/claude-opus-5.5',
  labels: {
    readyToSpec: 'ready-to-spec',
    needsInfo: 'needs-info',
    readyToImplement: 'ready-to-implement',
    running: 'factory:running',
    blocked: 'factory:blocked',
  },
  branch: (issue: number) => `factory/issue-${issue}`,
  // never committed, whatever the agent does
  protectedPaths: [/^\.github\//, /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|composer\.lock)$/],
};
export const repoFull = `${config.owner}/${config.repo}`;
