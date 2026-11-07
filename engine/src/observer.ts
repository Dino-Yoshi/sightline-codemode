/**
 * observer.ts — the tool wrapper.
 *
 * Wraps every MCP tool that Code Mode can call. For each call it:
 *   1. resolves the static lineage of each argument (from the analysis),
 *   2. runs policy.check BEFORE forwarding,
 *   3. emits a `call` + `value` pair when allowed, or a `blocked` event when
 *      denied — and a denied call is NEVER sent to the server,
 *   4. emits an `error` event (never throws past the loop) on transport errors.
 *
 * Unknown lineage is treated as private (fail-closed) by policy.check.
 */
import type { Analysis, CallSite } from './lineage.js';
import { check, type ServerPolicy, type Lineage } from './policy.js';

export type RunEvent =
  | {
      type: 'call';
      id: string;
      server: string;
      tool: string;
      line: number;
      transport: string;
      args: Record<string, { preview: string; from: string[] }>;
      rpc: unknown;
      ms: number;
      t: number;
      step: number;
    }
  | {
      type: 'value';
      id: string;
      from: string[];
      op: string;
      line: number;
      preview: string;
      tokens: number;
      sensitivity: 'public' | 'private';
      taint: 'trusted' | 'untrusted';
      in_model_context: boolean;
      t: number;
      step: number;
    }
  | {
      type: 'blocked';
      id: string;
      server: string;
      tool: string;
      line: number;
      transport: string;
      args: Record<string, { preview: string; from: string[] }>;
      rpc: unknown;
      rule: string;
      reason: string;
      t: number;
      step: number;
    }
  | { type: 'error'; line: number; message: string; t: number; step: number };

/** Minimal shape of an MCP client that can forward a tool call. */
export interface McpToolClient {
  callTool(req: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
}
export type McpClients = Record<string, McpToolClient>;

/** The surface Code Mode calls: tools.<server>.<tool>(args). */
export type CodeModeTools = Record<
  string,
  Record<string, (args?: Record<string, unknown>) => Promise<unknown>>
>;

const approxTokens = (s: string): number => Math.max(1, Math.ceil(s.length / 4));

const preview = (v: unknown): string => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && s.length > 120 ? `${s.slice(0, 117)}…` : s ?? '';
};

function extractText(res: unknown): string {
  const content = (res as { content?: { type: string; text?: string }[] })?.content;
  if (Array.isArray(content)) return content.map((p) => p.text ?? '').join('');
  return typeof res === 'string' ? res : JSON.stringify(res ?? '');
}

export function wrapTools(
  clients: McpClients,
  servers: Record<string, ServerPolicy>,
  analysis: Analysis,
  emit: (e: RunEvent) => void,
  options?: { step?: number; start?: number; modelTurnId?: string },
): CodeModeTools {
  const sitesFor = (server: string, tool: string): CallSite[] =>
    analysis.sites.filter((s) => s.server === server && s.tool === tool);
  const used: Record<string, number> = {};
  const siteToValueId: Record<string, string> = {};

  /**
   * Resolve the sensitivity of a set of variable/site references by walking the
   * dependency graph. Fail-closed: any `unknown` in the chain makes the whole
   * result `unknown` (which policy.check treats as private).
   */
  const resolveSensitivity = (refs: string[]): Lineage['sensitivity'] => {
    const seen = new Set<string>();
    const visit = (ref: string): 'public' | 'private' | 'unknown' => {
      if (ref === 'unknown') return 'unknown';
      if (seen.has(ref)) return 'public'; // cycle guard
      seen.add(ref);
      const site = analysis.sites.find((s) => s.id === ref);
      if (site) return servers[site.server]?.source ?? 'unknown';
      const deps = analysis.deps[ref];
      if (!deps || deps.length === 0) return 'public'; // literal / external constant
      const parts = deps.map(visit);
      if (parts.includes('unknown')) return 'unknown';
      return parts.includes('private') ? 'private' : 'public';
    };
    if (refs.length === 0) return 'public';
    const parts = refs.map(visit);
    if (parts.includes('unknown')) return 'unknown';
    return parts.includes('private') ? 'private' : 'public';
  };

  const resolveFromIds = (refs: string[]): string[] => {
    const ids = new Set<string>();
    const seen = new Set<string>();
    const visit = (ref: string) => {
      if (seen.has(ref)) return;
      seen.add(ref);
      if (siteToValueId[ref]) {
        ids.add(siteToValueId[ref]);
        return;
      }
      const site = analysis.sites.find((s) => s.id === ref);
      if (site) {
        if (siteToValueId[site.id]) ids.add(siteToValueId[site.id]);
        return;
      }
      const deps = analysis.deps[ref];
      if (deps && deps.length > 0) {
        for (const d of deps) visit(d);
      }
    };
    for (const r of refs) visit(r);
    const result = Array.from(ids);
    if (result.length === 0 && options?.modelTurnId) {
      return [options.modelTurnId];
    }
    return result;
  };

  let step = options?.step ?? 0;
  const start = options?.start ?? Date.now();

  const makeTool =
    (server: string, policy: ServerPolicy, client: McpToolClient, tool: string) =>
    async (args: Record<string, unknown> = {}): Promise<unknown> => {
      const key = `${server}.${tool}`;
      const idx = used[key] ?? 0;
      used[key] = idx + 1;
      const site = sitesFor(server, tool)[idx];
      const line = site?.line ?? 0;

      // Build per-argument lineage previews and compute the worst sensitivity.
      const argEvents: Record<string, { preview: string; from: string[] }> = {};
      let worst: Lineage['sensitivity'] = site ? 'public' : 'unknown';
      const allFrom: string[] = [];
      for (const [name, value] of Object.entries(args)) {
        const rawFrom = site?.args[name] ?? [];
        const from = resolveFromIds(rawFrom);
        argEvents[name] = { preview: preview(value), from };
        allFrom.push(...rawFrom);
        const s = resolveSensitivity(rawFrom);
        if (s === 'unknown') worst = 'unknown';
        else if (s === 'private' && worst !== 'unknown') worst = 'private';
      }

      const lineage: Lineage = { sensitivity: worst, taint: policy.taint };
      const decision = check(lineage, policy);
      const rpc = {
        jsonrpc: '2.0',
        id: step + 1,
        method: 'tools/call',
        params: { name: tool, arguments: args },
      };

      step += 1;
      const callId = `c${step}`;
      const valId = `v${step}`;
      if (site) {
        siteToValueId[site.id] = valId;
      }

      if (!decision.allow) {
        // Blocked: emit and return WITHOUT forwarding to the server.
        emit({
          type: 'blocked',
          id: callId,
          server,
          tool,
          line,
          transport: 'stdio',
          args: argEvents,
          rpc,
          rule: decision.rule,
          reason: decision.reason,
          t: Date.now() - start,
          step,
        });
        return { blocked: true, rule: decision.rule, reason: decision.reason };
      }

      const t0 = Date.now();
      try {
        const res = await client.callTool({ name: tool, arguments: args });
        const ms = Math.max(1, Date.now() - t0);
        emit({
          type: 'call',
          id: callId,
          server,
          tool,
          line,
          transport: 'stdio',
          args: argEvents,
          rpc,
          ms,
          t: Date.now() - start,
          step,
        });
        const text = extractText(res);
        emit({
          type: 'value',
          id: valId,
          from: [callId],
          op: 'result',
          line,
          preview: preview(text),
          tokens: approxTokens(text),
          // The result carries this server's sensitivity. Private results are
          // never placed into the model context (in_model_context: false).
          sensitivity: policy.source,
          taint: policy.taint,
          in_model_context: false,
          t: Date.now() - start,
          step,
        });
        return res;
      } catch (err) {
        emit({
          type: 'error',
          line,
          message: (err as Error).message ?? String(err),
          t: Date.now() - start,
          step,
        });
        throw err;
      }
    };

  const tools: CodeModeTools = {};
  for (const [server, policy] of Object.entries(servers)) {
    const client = clients[server];
    // Route any tool name on this server through the wrapper via a Proxy, so the
    // wrapper works regardless of which tools the generated script references.
    tools[server] = new Proxy(
      {},
      {
        get: (_t, tool: string) => makeTool(server, policy, client, tool),
      },
    ) as Record<string, (args?: Record<string, unknown>) => Promise<unknown>>;
  }

  // Surface analyzer errors as error nodes (fail-closed, never a crash).
  for (const e of analysis.errors) {
    emit({ type: 'error', line: e.line, message: e.message, t: 0, step: 0 });
  }

  return tools;
}
