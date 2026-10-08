import { createFxAgent, type HostTool } from 'libfx';
import { asSchema, type Tool } from 'ai';
import { createGithubTools, type GithubToolName } from '@github-tools/sdk';
import { z } from 'zod';
import { config, repoFull } from './config';
import { readToken } from './github';
import { gatewayKey } from './ai-gateway';
import { note, warn } from './log';

/** Hard budget for one host-agent turn. libfx has no implicit step cap, so the host enforces one. */
const MAX_TOOL_CALLS = 60;
const MAX_TURN_MS = 8 * 60_000;

async function lastValue(out: unknown) {
  if (out && typeof out === 'object' && Symbol.asyncIterator in out) {
    let last: unknown;
    for await (const v of out as AsyncIterable<unknown>) last = v;
    return last;
  }
  return out;
}

/** Convert AI SDK tools (GitHub Tools) to libfx host tools, with validation and a repo guard. */
async function toHostTools(tools: Record<string, Tool>): Promise<HostTool[]> {
  return Promise.all(
    Object.entries(tools).map(async ([name, t]) => {
      const schema = asSchema(t.inputSchema);
      return {
        name,
        description: typeof t.description === 'string' ? t.description : name,
        inputSchema: (await schema.jsonSchema) as Record<string, unknown>,
        async execute(input: unknown, { signal }: { signal: AbortSignal }) {
          const parsed = schema.validate ? await schema.validate(input) : { success: true as const, value: input };
          if (!parsed.success) throw new Error(`Invalid input for ${name}: ${parsed.error.message}`);
          const v = parsed.value as { owner?: string; repo?: string };
          if ((v.owner && v.owner !== config.owner) || (v.repo && v.repo !== config.repo)) {
            throw new Error(`This agent may only access ${repoFull}.`);
          }
          const out = await lastValue(
            await t.execute!(parsed.value, { toolCallId: crypto.randomUUID(), messages: [], abortSignal: signal, context: {} }),
          );
          return JSON.parse(JSON.stringify(out ?? null)); // JSON-serializable for libfx
        },
      };
    }),
  );
}

/** Read-only GitHub tools, cherry-picked from the read-only "repo-explorer" preset. */
export async function readOnlyGithubTools(names: GithubToolName[]) {
  const all = createGithubTools({
    token: readToken, // lazy provider: minted per call, narrowed to one repo
    preset: 'repo-explorer', // read-only preset: no write tool exists in it
    requireApproval: false,
    context: { owner: config.owner, repo: config.repo },
  }) as Record<string, Tool>;
  const picked = Object.fromEntries(Object.entries(all).filter(([n]) => (names as string[]).includes(n)));
  const missing = names.filter((n) => !(n in picked));
  if (missing.length) throw new Error(`Not in the repo-explorer preset: ${missing.join(', ')}`);
  return toHostTools(picked);
}

/** A "submit" tool: how a libfx agent returns structured output. */
export function submitTool<T extends z.ZodType>(name: string, description: string, schema: T, onSubmit: (v: z.infer<T>) => void): HostTool {
  return {
    name,
    description,
    inputSchema: z.toJSONSchema(schema) as Record<string, unknown>,
    execute(input: unknown) {
      const r = schema.safeParse(input);
      if (!r.success) throw new Error(r.error.message);
      onSubmit(r.data);
      return 'Submitted. Stop now.';
    },
  };
}

export async function runHostAgent(opts: { prompt: string; tools: HostTool[]; model?: string }) {
  const agent = await createFxAgent({
    apiKey: await gatewayKey(),
    model: opts.model ?? config.model,
    instructions: 'You are one station of a software factory. Use only the tools provided. Be concise.',
    tools: opts.tools,
  });
  const tools: Record<string, number> = {};
  let calls = 0;
  try {
    const turn = agent.prompt(opts.prompt, { signal: AbortSignal.timeout(MAX_TURN_MS) });
    for await (const e of turn) {
      if (e.type !== 'tool_start') continue;
      tools[e.name] = (tools[e.name] ?? 0) + 1;
      if (++calls > MAX_TOOL_CALLS) {
        warn(`the agent passed its budget of ${MAX_TOOL_CALLS} tool calls; its turn was cancelled`);
        turn.cancel();
        break;
      }
    }
    const result = await turn.result; // { stopReason, usage }
    note({ agent: { model: opts.model ?? config.model, toolCalls: calls, tools, stopReason: result.stopReason, usage: result.usage } });
    return result;
  } catch (e) {
    note({ agent: { model: opts.model ?? config.model, toolCalls: calls, tools } }); // how far it got
    throw e;
  } finally {
    await agent.close();
  }
}
