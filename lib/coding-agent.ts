import { HarnessAgent } from '@ai-sdk/harness/agent';
import { createFx } from '@ai-sdk/harness-fx';
import { isStepCount } from 'ai';
import { config } from './config';
import { gatewayKey } from './ai-gateway';
import skills from './skills.generated.json';

/**
 * Built per step so the Gateway credential (an API key or a short-lived OIDC token) is fresh.
 * The harness brokers it through the sandbox firewall: the sandbox only ever sees a placeholder.
 */
export async function createCodingAgent() {
  return new HarnessAgent({
    harness: createFx({ auth: { AI_GATEWAY_API_KEY: await gatewayKey() } }), // fx always talks to AI Gateway
    model: config.model,
    skills, // factory/skills/*, written into fx's skills directory for each session
    permissionMode: 'allow-all', // unattended: the sandbox firewall is the boundary
    stopWhen: isStepCount(40), // finish a "slice" every 40 steps so each workflow step stays short
    sandboxConfig: {
      workDir: 'repo', // relative to the sandbox's default working directory
      // Baked into the reusable template snapshot (rebuilt when the hash changes).
      // For heavier stacks (PHP + Composer, DB servers, Playwright), use a custom VCR image instead.
      bootstrapHash: 'toolchain-v1',
      onBootstrap: async ({ session, abortSignal }) => {
        const r = await session.run({
          command: 'command -v pnpm >/dev/null || sudo env "PATH=$PATH" corepack enable; pnpm --version',
          abortSignal,
        });
        if (r.exitCode !== 0) throw new Error(`bootstrap failed: ${r.stderr}`);
      },
    },
  });
}
