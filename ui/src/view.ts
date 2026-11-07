export type RunEvent = {
  type: string;
  t: number;
  step: number;
  id?: string;
  round?: number;
  text?: string;
  tokens?: number;
  server?: string;
  tool?: string;
  line?: number;
  transport?: string;
  args?: Record<string, { preview: string; from?: string[] }>;
  rpc?: Record<string, any>;
  ms?: number;
  from?: string[];
  op?: string;
  preview?: string;
  sensitivity?: 'public' | 'private';
  taint?: 'trusted' | 'untrusted';
  in_model_context?: boolean;
  rule?: string;
  reason?: string;
  message?: string;
  saw?: Array<{ label: string; ref?: string; tokens: number; untrusted?: boolean }>;
  script?: Array<{ n: number; code: string }>;
  influenced_by?: string[];
  model_tokens?: number;
  sandbox_tokens?: number;
  rounds?: number;
  [key: string]: any;
};

export type NodeKind = 'prompt' | 'model_turn' | 'script' | 'call' | 'value' | 'blocked' | 'error';

export type Node = {
  id: string;
  lane: string;
  step: number;
  line?: number;
  title: string;
  subtitle: string;
  event: RunEvent;
  kind: NodeKind;
};

export type EdgeKind = 'write' | 'call' | 'public' | 'private' | 'taint' | 'blocked';

export type Edge = {
  from: string;
  to: string;
  kind: EdgeKind;
  label: string;
};

export type View = {
  nodes: Node[];
  edges: Edge[];
  lanes: string[];
  steps: number[];
  summary?: RunEvent;
};

export type Mode = 'lineage' | 'blast';

export function parseRun(text: string): RunEvent[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as RunEvent);
}

export function view(run: RunEvent[]): View {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const addEdge = (from: string, to: string, kind: EdgeKind, label: string) => {
    if (!from || !to || from === to) return;
    if (!edges.some((e) => e.from === from && e.to === to && e.kind === kind)) {
      edges.push({ from, to, kind, label });
    }
  };

  const models = run.filter((e) => e.type === 'model_turn');

  // 1. Process regular events
  for (const e of run) {
    if (e.type === 'summary') continue;

    const id = e.id ?? `error-${e.step}-${nodes.length}`;
    let lane = 'SCRIPT';
    if (e.type === 'prompt') {
      lane = 'YOU';
    } else if (e.type === 'model_turn') {
      lane = 'MODEL';
    } else if (e.type === 'call' || e.type === 'blocked') {
      lane = e.server ?? 'SCRIPT';
    } else if (e.type === 'value' && e.op === 'result') {
      const sourceCall = run.find((x) => x.id === e.from?.[0]);
      lane = sourceCall?.server ?? 'SCRIPT';
    } else if (e.type === 'error') {
      lane = 'SCRIPT';
    }

    let title = 'Event';
    if (e.type === 'prompt') title = 'Your task';
    else if (e.type === 'model_turn') title = `Round ${e.round ?? 1}`;
    else if (e.type === 'call' || e.type === 'blocked') title = `${e.server}.${e.tool}`;
    else if (e.type === 'error') title = 'Analysis error';
    else if (e.type === 'value') title = e.op ? `Value (${e.op})` : 'Value';

    let subtitle = '';
    if (e.type === 'prompt') subtitle = `${e.tokens ?? 0} tokens`;
    else if (e.type === 'model_turn') {
      const count = e.script?.length ?? 0;
      subtitle = `${count} script line${count === 1 ? '' : 's'}`;
    } else if (e.type === 'call') subtitle = `${e.ms ?? 0} ms · ${e.transport ?? 'stdio'}`;
    else if (e.type === 'blocked') subtitle = 'Blocked before sending';
    else if (e.type === 'error') subtitle = e.message ?? 'Unknown error';
    else if (e.type === 'value') subtitle = e.preview ?? '';

    nodes.push({
      id,
      lane,
      step: e.step,
      line: e.line,
      title,
      subtitle,
      event: e,
      kind: e.type as NodeKind,
    });
  }

  // 2. Synthesize script line nodes from model turns
  for (const m of models) {
    if (!m.id || !m.script) continue;
    for (const l of m.script) {
      const lineNodeId = `line-${m.id}-${l.n}`;
      const related = run.filter((e) => e.line === l.n && e.type !== 'model_turn');
      const step = related.length ? Math.min(...related.map((e) => e.step)) : m.step;

      nodes.push({
        id: lineNodeId,
        lane: 'SCRIPT',
        step,
        line: l.n,
        title: `Line ${l.n}`,
        subtitle: l.code,
        event: {
          type: 'script',
          step: m.step,
          t: m.t,
          line: l.n,
          code: l.code,
          model: m.id,
        },
        kind: 'script',
      });

      // Model turn writes this script line
      addEdge(m.id, lineNodeId, 'write', l.code);

      // Connect script line to calls, blocks, errors on that line
      for (const e of related.filter((e) => e.type === 'call' || e.type === 'blocked' || e.type === 'error')) {
        const targetId = e.id ?? nodes.find((n) => n.event === e)?.id ?? '';
        if (targetId) {
          addEdge(
            lineNodeId,
            targetId,
            e.type === 'blocked' ? 'blocked' : 'call',
            e.type === 'blocked' ? 'Blocked' : `${e.server}.${e.tool}`,
          );
        }
      }
    }
  }

  // 3. Connect data dependencies and influence edges
  for (const e of run) {
    if (!e.id) continue;

    if (e.type === 'model_turn') {
      for (const s of e.saw ?? []) {
        if (s.ref) {
          addEdge(s.ref, e.id, s.untrusted ? 'taint' : 'write', s.label);
        }
      }
      for (const ref of e.influenced_by ?? []) {
        addEdge(ref, e.id, 'taint', 'Untrusted influence');
      }
    }

    if (e.type === 'value') {
      for (const ref of e.from ?? []) {
        addEdge(ref, e.id, e.taint === 'untrusted' ? 'taint' : e.sensitivity ?? 'public', e.preview ?? '');
      }
    }

    if (e.type === 'call' || e.type === 'blocked') {
      for (const arg of Object.values(e.args ?? {})) {
        for (const ref of arg.from ?? []) {
          const source = run.find((x) => x.id === ref);
          const kind: EdgeKind =
            e.type === 'blocked'
              ? 'blocked'
              : source?.taint === 'untrusted'
              ? 'taint'
              : (source?.sensitivity as EdgeKind) ?? 'public';
          addEdge(ref, e.id, kind, arg.preview ?? '');
        }
      }
    }
  }

  // Server lanes preservation and ordering
  const serverLanes: string[] = [];
  for (const n of nodes) {
    if (!['YOU', 'MODEL', 'SCRIPT'].includes(n.lane) && !serverLanes.includes(n.lane)) {
      serverLanes.push(n.lane);
    }
  }

  const validNodeIds = new Set(nodes.map((n) => n.id));
  const validEdges = edges.filter((e) => validNodeIds.has(e.from) && validNodeIds.has(e.to));
  const steps = [...new Set(run.map((e) => e.step))].sort((a, b) => a - b);
  const summary = run.find((e) => e.type === 'summary');

  return {
    nodes,
    edges: validEdges,
    lanes: ['YOU', 'MODEL', 'SCRIPT', ...serverLanes],
    steps,
    summary,
  };
}

export type ArgumentInspection = {
  name: string;
  preview: string;
  sources: Node[];
};

export type Inspection = {
  node?: Node;
  lit: Set<string>;
  edges: Edge[];
  arguments: ArgumentInspection[];
};

export function inspect(v: View, id: string, mode: Mode, step = Infinity): Inspection {
  const visibleNodes = v.nodes.filter((n) => n.step <= step);
  const visible = new Set(visibleNodes.map((n) => n.id));
  const node = v.nodes.find((n) => n.id === id && visible.has(n.id));

  if (!node) {
    return {
      node: undefined,
      lit: new Set<string>(),
      edges: [],
      arguments: [],
    };
  }

  const walk = (direction: 'up' | 'down') => {
    const seen = new Set<string>([id]);
    const queue = [id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const e of v.edges) {
        const next =
          direction === 'up' && e.to === current
            ? e.from
            : direction === 'down' && e.from === current
            ? e.to
            : null;
        if (next && visible.has(next) && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return seen;
  };

  const down = walk('down');
  const up = mode === 'lineage' ? walk('up') : new Set<string>([id]);
  const lit = new Set([...down, ...up]);

  // Edges that connect nodes in the lit set along the walk directions
  const edges = v.edges.filter(
    (e) =>
      visible.has(e.from) &&
      visible.has(e.to) &&
      ((down.has(e.from) && down.has(e.to)) || (up.has(e.from) && up.has(e.to))),
  );

  const args: ArgumentInspection[] = Object.entries(node.event.args ?? {}).map(([name, arg]) => ({
    name,
    preview: arg.preview,
    sources: (arg.from ?? [])
      .map((ref) => v.nodes.find((n) => n.id === ref))
      .filter((n): n is Node => n !== undefined && visible.has(n.id)),
  }));

  return {
    node,
    lit,
    edges,
    arguments: args,
  };
}
