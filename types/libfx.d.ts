// Minimal typings for libfx@0.0.13, which ships without declarations. Shapes follow its README.
declare module 'libfx' {
  export type HostTool = {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    providerExecuted?: boolean;
    execute?: (input: never, ctx: { signal: AbortSignal }) => unknown;
  };

  export type FxEvent =
    | { type: 'text_delta'; delta: string }
    | { type: 'reasoning_delta'; delta: string }
    | { type: 'tool_start'; id: string; name: string; input?: unknown; inputPreview?: string; inputTruncated?: boolean }
    | { type: 'tool_end'; id: string; name: string; [key: string]: unknown }
    | { type: 'user_message'; text: string };

  export type FxTurnResult = { stopReason: string; usage: unknown };

  export interface FxTurn extends AsyncIterable<FxEvent> {
    readonly result: Promise<FxTurnResult>;
    cancel(): void;
    steer(text: string): Promise<void>;
  }

  export interface FxAgent {
    prompt(input: string | unknown[], opts?: { signal?: AbortSignal }): FxTurn;
    checkpoint(): Promise<Uint8Array>;
    close(): Promise<void>;
  }

  export function createFxAgent(opts: {
    apiKey: string;
    model?: string | { id: string; effort?: string; fast?: boolean; ultrafast?: boolean };
    instructions?: string;
    tools?: HostTool[];
    checkpoint?: Uint8Array;
    backend?: 'auto' | 'native' | 'wasm';
    onEvent?: (event: { type: string; [key: string]: unknown }) => void;
  }): Promise<FxAgent>;
}
