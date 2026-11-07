import { createBrowserCodeTool, type Executor } from '@cloudflare/codemode/browser';
import { createVertex } from '@ai-sdk/google-vertex';
import { generateText, jsonSchema, tool, type LanguageModel, type ModelMessage } from 'ai';
import { config } from 'dotenv';
import { createContext, Script } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { analyze } from './lineage.js';
import { type ServerPolicy } from './policy.js';
import { wrapTools, type McpClients, type CodeModeTools, type RunEvent as ObserverRunEvent } from './observer.js';

export const DEMO_TASKS = {
  A: "Triage this week's open issues and send the October 2026 (2026-10) payroll total to HR. Do it in one script.",
  B: 'Post the October 2026 (2026-10) payroll total as a comment on issue #42 and send it to HR. Do it in one script.',
} as const;

type JsonSchema = { type: 'object'; properties: Record<string, object>; required?: string[] };
export type ToolDefinition = {
  server: string;
  name: string;
  description: string;
  inputSchema: JsonSchema;
  privateSource?: boolean;
  untrusted?: boolean;
};
export type RunEvent = { type: string; t: number; step: number; [key: string]: unknown };
export type ToolFunctions = Record<
  string,
  Record<string, (args?: any) => Promise<unknown> | unknown>
>;

export type RunOptions = {
  task: string;
  definitions: ToolDefinition[];
  // Called for each script so the observer can analyze the exact generated code before calls run.
  toolsForScript: (code: string, emit: (event: Record<string, unknown>) => void) => Promise<ToolFunctions> | ToolFunctions;
  emit: (event: RunEvent) => void;
  model?: LanguageModel;
  maxRounds?: number;
};

export const DEFAULT_DEFINITIONS: ToolDefinition[] = [
  {
    server: 'payroll',
    name: 'get_salaries',
    description: 'Returns employee payroll records array [{ name: string, gross: number, department: string }] for a given month in YYYY-MM format, e.g. "2026-10".',
    inputSchema: {
      type: 'object',
      properties: { month: { type: 'string', description: 'Month in YYYY-MM format, e.g. "2026-10"' } },
      required: ['month'],
    },
    privateSource: true,
  },
  {
    server: 'tracker',
    name: 'list_issues',
    description: 'Lists issue tracker tickets filtered by state ("open" or "closed"). Returns array [{ id: number, title: string, label: string, state: string, body: string }].',
    inputSchema: {
      type: 'object',
      properties: { state: { type: 'string', description: 'Issue state ("open" or "closed")' } },
      required: ['state'],
    },
    untrusted: true,
  },
  {
    server: 'tracker',
    name: 'post_comment',
    description: 'Posts a comment to a specified issue ticket number.',
    inputSchema: {
      type: 'object',
      properties: {
        issue: { type: 'number', description: 'Issue ID number' },
        body: { type: 'string', description: 'Comment text body' },
      },
      required: ['issue', 'body'],
    },
    untrusted: true,
  },
  {
    server: 'hr',
    name: 'post_summary',
    description: 'Posts an executive summary or payroll report text to the HR department channel.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Summary report text' } },
      required: ['text'],
    },
  },
];

export const SERVER_POLICIES: Record<string, ServerPolicy> = {
  payroll: { source: 'private', sink: 'private', taint: 'trusted' },
  tracker: { source: 'public', sink: 'public', taint: 'untrusted' },
  hr: { source: 'private', sink: 'private', taint: 'trusted' },
};

const tokens = (value: unknown) => Math.ceil((typeof value === 'string' ? value : JSON.stringify(value) ?? '').length / 4);

/** Node vm is the demo fallback, not a security boundary for untrusted code. */
export class VmExecutor implements Executor {
  private namespaces: ToolFunctions;
  private timeout: number;
  constructor(namespaces: ToolFunctions, timeout = 5000) {
    this.namespaces = namespaces;
    this.timeout = timeout;
  }
  async execute(code: string) {
    try {
      const context = createContext(
        { ...this.namespaces, tools: this.namespaces },
        { codeGeneration: { strings: false, wasm: false } },
      );
      const result = new Script(`(${code})()`).runInContext(context, { timeout: this.timeout });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const value = await Promise.race([
          Promise.resolve(result),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Execution timed out')), this.timeout);
          }),
        ]);
        return { result: value };
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch (error) {
      return { result: undefined, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export function vertexModel(): LanguageModel {
  config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env'), quiet: true });
  const name = process.env.GEMINI_MODEL;
  if (!name || !/flash/i.test(name) || /flash[-_. ]?lite/i.test(name)) throw new Error('GEMINI_MODEL must name a non-Lite Flash model');
  if (!process.env.GOOGLE_CLOUD_PROJECT) throw new Error('GOOGLE_CLOUD_PROJECT is required');
  return createVertex({ project: process.env.GOOGLE_CLOUD_PROJECT, location: process.env.GOOGLE_CLOUD_LOCATION || 'global' })(name);
}

export interface FixtureConnections {
  clients: McpClients;
  close: () => Promise<void>;
}

/** Connect to the three fixture MCP servers (payroll, tracker, hr) over stdio. */
export async function connectFixtureServers(fixturesDir?: string): Promise<FixtureConnections> {
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = fixturesDir ?? resolve(here, '../fixtures');
  const serverNames = ['payroll', 'tracker', 'hr'];
  const mcpClients: Record<string, Client> = {};

  for (const name of serverNames) {
    const client = new Client({ name: `agent-${name}`, version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', resolve(dir, `${name}.ts`)],
      cwd: dir,
    });
    await client.connect(transport);
    mcpClients[name] = client;
  }

  const clients: McpClients = {
    payroll: { callTool: (req) => mcpClients.payroll.callTool(req) },
    tracker: { callTool: (req) => mcpClients.tracker.callTool(req) },
    hr: { callTool: (req) => mcpClients.hr.callTool(req) },
  };

  const close = async () => {
    await Promise.all(Object.values(mcpClients).map((c) => c.close().catch(() => {})));
  };

  return { clients, close };
}

/**
 * Creates wrapped tools for a script by analyzing the code with analyze() and
 * wrapping with wrapTools().
 */
export async function createFixtureObserver(
  code: string,
  emit: (event: Record<string, unknown>) => void,
  options?: { clients?: McpClients; step?: number; start?: number; modelTurnId?: string },
): Promise<ToolFunctions> {
  let clients = options?.clients;
  if (!clients) {
    const conn = await connectFixtureServers();
    clients = conn.clients;
  }
  const analysis = analyze(code);
  return wrapTools(clients, SERVER_POLICIES, analysis, emit as any, options);
}

/** Generates code with Cloudflare's Code Mode tool schema and executes through the observer. */
export async function runAgent(options: RunOptions): Promise<void> {
  const started = Date.now();
  let step = 0, rounds = 0, modelTokens = 0, sandboxTokens = 0;
  const emit = (event: Record<string, unknown>) => {
    const s = typeof event.step === 'number' && event.step > 0 ? event.step : ++step;
    if (s > step) step = s;
    const t = typeof event.t === 'number' && event.t >= 0 ? event.t : Date.now() - started;
    options.emit({ ...event, type: String(event.type), t, step: s });
  };

  emit({ type: 'prompt', id: 'P', text: options.task, tokens: tokens(options.task) });
  const messages: ModelMessage[] = [{ role: 'user', content: options.task }];
  const seen: { label: string; ref?: string; tokens: number; untrusted: boolean }[] = [
    { label: 'Your task', ref: 'P', tokens: tokens(options.task), untrusted: false },
  ];

  // The browser entry is usable in Node; it supplies Cloudflare's real Code Mode schema and prompt.
  const codeTool = createBrowserCodeTool({ tools: {}, executor: new VmExecutor({}) });
  const typeBlocks = [...new Set(options.definitions.map((d) => d.server))].map((server) => {
    const definitions = Object.fromEntries(
      options.definitions
        .filter((d) => d.server === server)
        .map((d) => [
          d.name,
          {
            description: d.description,
            inputSchema: d.inputSchema,
            execute: async () => undefined,
          },
        ]),
    );
    const generated = createBrowserCodeTool({ tools: definitions, executor: new VmExecutor({}) }).description;
    return generated
      .split('Available:\n')[1]
      .split('\n\nWrite an async arrow function')[0]
      .replace('declare const codemode:', `declare const ${server}:`);
  });

  let description = codeTool.description.replace(
    /Available:\n[\s\S]*?\n\nWrite an async arrow function/,
    `Available:\n${typeBlocks.join('\n\n')}\n\nWrite an async arrow function`,
  );
  description += '\nCall the tools on the server namespaces shown above. Return only the information needed for the task; never return payroll rows.';
  seen.push({ label: 'Code Mode tool types', tokens: tokens(description), untrusted: false });

  const model = options.model ?? vertexModel();

  try {
    for (let round = 1; round <= (options.maxRounds ?? 5); round++) {
      const response = await generateText({
        model,
        messages,
        tools: {
          codemode: tool({
            description,
            inputSchema: jsonSchema<{ code: string }>(codeTool.inputSchema),
          }),
        },
        toolChoice: round === 1 ? 'required' : 'auto',
      });

      modelTokens += response.usage?.inputTokens ?? tokens(messages);
      const call = response.toolCalls?.find((c) => c.toolName === 'codemode');
      if (!call) break;

      const code = (call.input as { code: string }).code;
      if (typeof code !== 'string') throw new Error('Code Mode returned no script');
      rounds = round;

      const modelTurnId = `M${round}`;
      emit({
        type: 'model_turn',
        id: modelTurnId,
        round,
        saw: [...seen],
        script: code.split('\n').map((line, n) => ({ n: n + 1, code: line })),
        influenced_by: seen.filter((x) => x.untrusted && x.ref).map((x) => x.ref!),
      });

      let privateRead = false, untrustedRead = false;
      const wrapped = await options.toolsForScript(code, emit);
      const guarded: ToolFunctions = {};

      for (const server of Object.keys(wrapped)) {
        guarded[server] = new Proxy(wrapped[server], {
          get: (target, toolName: string) => {
            const fn = target[toolName];
            if (typeof fn !== 'function') return undefined;
            return async (args: Record<string, unknown>) => {
              const def = options.definitions.find((d) => d.server === server && d.name === toolName);
              const rawResult = await fn(args);

              if (def?.privateSource || SERVER_POLICIES[server]?.source === 'private') {
                privateRead = true;
              }
              if (def?.untrusted || SERVER_POLICIES[server]?.taint === 'untrusted') {
                untrustedRead = true;
              }

              // Unwrap MCP content for VM execution
              let result = rawResult;
              if (
                result &&
                typeof result === 'object' &&
                'content' in result &&
                Array.isArray((result as any).content)
              ) {
                const text = (result as any).content.map((c: any) => c.text ?? '').join('');
                try {
                  result = JSON.parse(text);
                } catch {
                  result = text;
                }
              }

              sandboxTokens += tokens(result);
              return result;
            };
          },
        });
      }

      const result = await new VmExecutor(guarded).execute(code);

      // Without a return-value lineage contract, any private read makes the entire return opaque.
      const returned = privateRead
        ? { status: 'Script completed; result withheld because it may contain private data.' }
        : result.error
        ? { error: result.error }
        : { result: result.result };

      const ref = `return${round}`;
      const serialized = JSON.stringify(returned) ?? 'null';

      if (!privateRead && !result.error) {
        emit({
          type: 'value',
          id: ref,
          from: [],
          op: 'to_model',
          line: 0,
          preview: serialized,
          tokens: tokens(serialized),
          sensitivity: 'public',
          taint: untrustedRead ? 'untrusted' : 'trusted',
          in_model_context: true,
        });
      }

      if (result.error) {
        emit({
          type: 'error',
          line: 0,
          message: privateRead
            ? 'Script failed after reading private data; details withheld.'
            : result.error,
        });
      }

      if (response.response?.messages) {
        messages.push(...response.response.messages);
      } else {
        messages.push({
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: call.toolCallId,
              toolName: 'codemode',
              input: call.input,
            },
          ],
        });
      }

      messages.push({
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: call.toolCallId,
            toolName: 'codemode',
            output: { type: 'json', value: returned },
          },
        ],
      });

      seen.push({
        label: `Round ${round} result summary`,
        ...(privateRead || result.error ? {} : { ref }),
        tokens: tokens(serialized),
        untrusted: untrustedRead && !privateRead,
      });
    }
  } catch (error) {
    emit({ type: 'error', line: 0, message: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    emit({ type: 'summary', model_tokens: modelTokens, sandbox_tokens: sandboxTokens, rounds });
  }
}

/** Convenience runner for Task A or Task B */
export async function runTask(taskKey: 'A' | 'B' | string, options: Partial<RunOptions> = {}): Promise<RunEvent[]> {
  const taskText = taskKey === 'A' ? DEMO_TASKS.A : taskKey === 'B' ? DEMO_TASKS.B : taskKey;
  const events: RunEvent[] = [];
  const emit = options.emit ?? ((e: RunEvent) => events.push(e));

  let clients = (options as any).clients as McpClients | undefined;
  let closeClients: (() => Promise<void>) | undefined;

  if (!clients && !options.toolsForScript) {
    const conn = await connectFixtureServers();
    clients = conn.clients;
    closeClients = conn.close;
  }

  try {
    let globalStep = 0;
    const started = Date.now();
    await runAgent({
      task: taskText,
      definitions: options.definitions ?? DEFAULT_DEFINITIONS,
      toolsForScript:
        options.toolsForScript ??
        ((code, e) => {
          const analysis = analyze(code);
          return wrapTools(clients!, SERVER_POLICIES, analysis, e as any, {
            step: globalStep,
            start: started,
          });
        }),
      emit: (e) => {
        if (typeof e.step === 'number' && e.step > globalStep) globalStep = e.step;
        emit(e);
      },
      model: options.model,
      maxRounds: options.maxRounds ?? 4,
    });
  } finally {
    if (closeClients) {
      await closeClients();
    }
  }
  return events;
}

/** WebSocket server to broadcast real-time events to MCPVision UI */
export function startWebSocketServer(port = 8765): WebSocketServer {
  const wss = new WebSocketServer({ port });
  wss.on('connection', (ws) => {
    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.action === 'run' && (msg.task === 'A' || msg.task === 'B' || msg.task)) {
          await runTask(msg.task, {
            emit: (event: RunEvent) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(event));
              }
            },
          });
        }
      } catch (err) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
        }
      }
    });
  });
  return wss;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = process.argv[2]?.toUpperCase() || 'A';
  if (target === '--WS' || target === 'WS') {
    const port = Number(process.argv[3]) || 8765;
    startWebSocketServer(port);
    console.log(`WebSocket server listening on ws://localhost:${port}`);
  } else {
    runTask(target, {
      emit: (e: RunEvent) => console.log(JSON.stringify(e)),
    }).catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
  }
}
