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

  /**
   * Walk the lineage back to the call sites and collect the names of the private
   * sources (`server.tool`) that reached these refs. Used to name the source in
   * the block reason, e.g. "payroll.get_salaries". Order-preserving, de-duped.
   */
  const resolvePrivateSources = (refs: string[]): string[] => {
    const names: string[] = [];
    const seen = new Set<string>();
    const visit = (ref: string) => {
      if (ref === 'unknown' || seen.has(ref)) return;
      seen.add(ref);
      const site = analysis.sites.find((s) => s.id === ref);
      if (site) {
        if ((servers[site.server]?.source ?? 'private') === 'private') {
          const name = `${site.server}.${site.tool}`;
          if (!names.includes(name)) names.push(name);
        }
        return;
      }
      const deps = analysis.deps[ref];
      if (deps) for (const d of deps) visit(d);
    };
    for (const r of refs) visit(r);
    return names;
  };

  /** True if any value with untrusted taint is really in this lineage. */
  const resolveHasUntrusted = (refs: string[]): boolean => {    const seen = new Set<string>();
    const visit = (ref: string): boolean => {
      if (ref === 'unknown' || seen.has(ref)) return false;
      seen.add(ref);
      const site = analysis.sites.find((s) => s.id === ref);
      if (site) return (servers[site.server]?.taint ?? 'trusted') === 'untrusted';
      const deps = analysis.deps[ref];
      if (!deps) return false;
      return deps.some(visit);
    };
    return refs.some(visit);
  };

  /**
   * Pick a human-readable subject for the block reason: the named variable that
   * carries the private value (e.g. `total`), rather than the argument key the
   * script happened to use (e.g. `body`). Returns undefined if no such variable
   * is found, so the caller can fall back to the argument name.
   */
  const pickSubject = (refs: string[]): string | undefined => {
    const isPrivateVar = (ref: string): boolean => {
      if (ref === 'unknown') return false;
      // A variable (not a call site) whose resolved lineage is private.
      if (analysis.sites.some((s) => s.id === ref)) return false;
      if (!(ref in analysis.deps)) return false;
      return resolveSensitivity([ref]) === 'private';
    };
    return refs.find(isPrivateVar);
  };

  let step = options?.step ?? 0;
  const start = options?.start ?? Date.now();

  const makeTool =
    (server: string, policy: ServerPolicy, client: McpToolClient, tool: string) =>
    async (args: Record<string, unknown> = {}): Promise<unknown> => {
      const key = `${server}.${tool}`;
      const idx = used[key] ?? 0;
      used[key] = idx + 1;
      // BUG 1 fix: a (server, tool) call can have more runtime calls than static
      // sites (e.g. one post_comment site inside a for-of loop that runs many
      // times). Map any extra runtime call to the LAST static site matched for
      // that (server, tool), so a site inside a loop covers every iteration
      // instead of falling through to unknown lineage and a false block.
      const toolSites = sitesFor(server, tool);
      const site = toolSites[idx] ?? toolSites[toolSites.length - 1];
      const line = site?.line ?? 0;

      // Build per-argument lineage previews and compute the worst sensitivity.
      const argEvents: Record<string, { preview: string; from: string[] }> = {};
      let worst: Lineage['sensitivity'] = site ? 'public' : 'unknown';
      const allFrom: string[] = [];
      // Track which argument and sources drive the block, to name them in the reason.
      let blockingArg: string | undefined;
      let blockingRefs: string[] = [];
      for (const [name, value] of Object.entries(args)) {
        const rawFrom = site?.args[name] ?? [];
        const from = resolveFromIds(rawFrom);
        argEvents[name] = { preview: preview(value), from };
        allFrom.push(...rawFrom);
        const s = resolveSensitivity(rawFrom);
        if (s === 'unknown') {
          worst = 'unknown';
          if (!blockingArg) {
            blockingArg = name;
            blockingRefs = rawFrom;
          }
        } else if (s === 'private') {
          if (worst !== 'unknown') worst = 'private';
          // Prefer a concrete private arg as the one named in the reason.
          if (!blockingArg || !blockingRefs.length) {
            blockingArg = name;
            blockingRefs = rawFrom;
          }
        }
      }

      const lineage: Lineage = { sensitivity: worst, taint: policy.taint };
      // Name the value that carries the blocking lineage. Prefer the variable
      // the argument reads (e.g. `total`) over the argument key (e.g. `body`),
      // so the reason reads "total comes from payroll.get_salaries (private)…".
      const subject = pickSubject(blockingRefs) ?? blockingArg;
      const decision = check(lineage, policy, {
        argName: subject,
        sinkServer: server,
        sources: resolvePrivateSources(blockingRefs),
        untrusted: resolveHasUntrusted(blockingRefs),
      });
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
