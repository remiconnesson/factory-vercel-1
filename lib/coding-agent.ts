import { HarnessAgent } from '@ai-sdk/harness/agent';
import { createFx } from '@ai-sdk/harness-fx';
import { isStepCount } from 'ai';
import { config } from './config';
import { gatewayKey } from './ai-gateway';

// The Vercel plugin (https://vercel.com/docs/agent-resources/vercel-plugin) has no fx integration, so its portable
// part, the Agent Skills plus the ecosystem graph, is baked into the template at a pinned commit. Bump to update.
const VERCEL_PLUGIN_SHA = '82fa491886796702df4727fd0845f0c7c1d3d16e';

const bootstrap = `set -euo pipefail
command -v pnpm >/dev/null || sudo env "PATH=$PATH" corepack enable
pnpm --version
# fx runs with its own HOME; its skills directory lives there.
home=$(ls -d "$HOME"/.ai-sdk-harness/.harness-bootstrap/*/implementation/home | head -1)
src=$(mktemp -d)
curl -fsSL https://codeload.github.com/vercel/vercel-plugin/tar.gz/${VERCEL_PLUGIN_SHA} | tar -xz -C "$src" --strip-components=1
mkdir -p "$home/.agents/skills" "$home/.vercel-plugin"
cp -R "$src/skills/." "$home/.agents/skills/"
cp "$src/vercel.md" "$src/LICENSE" "$home/.vercel-plugin/"
echo ${VERCEL_PLUGIN_SHA} > "$home/.vercel-plugin/VERSION"
rm -rf "$src"
echo "vercel-plugin skills: $(ls "$home/.agents/skills" | wc -l)"`;

// What the plugin's session-start hook injects in supported tools, adapted to fx.
const instructions = `The Vercel plugin is installed: its skills cover Vercel products and libraries (Next.js, AI SDK, AI Gateway, \
Workflow, Sandbox, Functions, Storage, CLI, deployments, and more). Use the matching skill for any Vercel-related work.
Before relying on what you remember about Vercel, read the knowledge-update skill: it corrects outdated knowledge.
The full Vercel ecosystem graph is in ~/.vercel-plugin/vercel.md.
Network access in this sandbox is restricted: use only the services the task says are available.`;

/**
 * Built per step so the Gateway credential (an API key or a short-lived OIDC token) is fresh.
 * The harness brokers it through the sandbox firewall: the sandbox only ever sees a placeholder.
 */
export async function createCodingAgent() {
  return new HarnessAgent({
    harness: createFx({ auth: { AI_GATEWAY_API_KEY: await gatewayKey() } }), // fx always talks to AI Gateway
    model: config.model,
    instructions,
    permissionMode: 'allow-all', // unattended: the sandbox firewall is the boundary
    stopWhen: isStepCount(40), // finish a "slice" every 40 steps so each workflow step stays short
    sandboxConfig: {
      workDir: 'repo', // relative to the sandbox's default working directory
      // Baked into the reusable template snapshot (rebuilt when the hash changes).
      // For heavier stacks (PHP + Composer, DB servers, Playwright), use a custom VCR image instead.
      bootstrapHash: `toolchain-v1+vercel-plugin-${VERCEL_PLUGIN_SHA.slice(0, 7)}`,
      onBootstrap: async ({ session, abortSignal }) => {
        const r = await session.run({ command: bootstrap, abortSignal });
        if (r.exitCode !== 0) throw new Error(`bootstrap failed: ${r.stderr}`);
      },
    },
  });
}
