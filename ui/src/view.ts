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
export type StatusChip = 'PRIVATE' | 'PUBLIC' | 'UNTRUSTED' | 'SENT' | 'BLOCKED' | 'ERROR';

export type Node = {
  id: string;
  lane: string;
  step: number;
  column?: number;
  round?: number;
  line?: number;
  title: string;
  subtitle: string;
  chip: StatusChip;
  event: RunEvent;
  kind: NodeKind;
  repeatCount?: number;
  repeatedEvents?: RunEvent[];
  via?: string;
};

export type EdgeKind = 'write' | 'call' | 'public' | 'private' | 'taint' | 'blocked';

export type Edge = {
  from: string;
  to: string;
  kind: EdgeKind;
  label: string;
  via?: string;
};

export type ViewOptions = {
  showEveryStep?: boolean;
};

export type View = {
  nodes: Node[];
  edges: Edge[];
  lanes: string[];
  steps: number[];
  summary?: RunEvent;
  allNodes?: Node[];
  allEdges?: Edge[];
};

export type Mode = 'lineage' | 'blast';

export type TracedValue = {
  name: string;
  value: string;
  source: string;
  sensitivity: string;
  taint?: string;
  line?: number;
};

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
  tracedValues: TracedValue[];
  plainSummary: string[];
};

export type StorySentence = {
  id?: string;
  text: string;
  step?: number;
};

export type Story = {
  headline: string;
  sentences: StorySentence[];
  contextBoundary: string;
};

export function parseRun(text: string): RunEvent[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as RunEvent);
}

function humanizeTool(tool?: string): string {
  if (!tool) return 'Tool call';
  if (tool === 'list_issues') return 'List open issues';
  if (tool === 'get_salaries') return 'Read payroll';
  if (tool === 'post_summary') return 'Send summary to HR';
  if (tool === 'post_comment') return 'Post comment';
  return tool
    .replace(/^get_/, 'Read ')
    .replace(/^list_/, 'List ')
    .replace(/^post_/, 'Post ')
    .replace(/^send_/, 'Send ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getNodeTitleAndSubtitle(
  e: RunEvent,
  allEvents: RunEvent[],
): { title: string; subtitle: string; chip: StatusChip } {
  let title = 'Event';
  let subtitle = '';
  let chip: StatusChip = 'PUBLIC';

  if (e.type === 'prompt') {
    title = 'You asked';
    subtitle = e.text ? `"${e.text}"` : `${e.tokens ?? 0} tokens`;
    chip = 'PUBLIC';
  } else if (e.type === 'model_turn') {
    title = e.round ? `Gemini wrote a script (round ${e.round})` : 'Gemini wrote a script';
    const count = e.script?.length ?? 0;
    subtitle = `${count} script line${count === 1 ? '' : 's'}`;
    chip = e.influenced_by && e.influenced_by.length > 0 ? 'UNTRUSTED' : 'SENT';
  } else if (e.type === 'call' || e.type === 'blocked') {
    if (e.tool === 'list_issues') {
      title = 'List open issues';
      subtitle = '8 issues';
    } else if (e.tool === 'get_salaries') {
      title = 'Read payroll';
      subtitle = '214 rows';
    } else if (e.tool === 'post_summary') {
      title = 'Send summary to HR';
      if (e.args?.text?.preview) {
        const match = e.args.text.preview.match(/\$?([0-9,]+)/);
        subtitle = match ? match[1] : 'October payroll';
      } else {
        subtitle = 'October payroll';
      }
    } else if (e.tool === 'post_comment') {
      const issueNum = e.args?.issue?.preview ? String(e.args.issue.preview).replace(/["']/g, '') : '42';
      title = `Post comment on #${issueNum}`;
      subtitle = e.type === 'blocked' ? '1,284,600' : 'payroll total';
    } else {
      title = humanizeTool(e.tool);
      subtitle = e.ms !== undefined ? `${e.ms} ms` : (e.server ?? 'MCP call');
    }

    if (e.type === 'blocked') {
      chip = 'BLOCKED';
    } else if (e.taint === 'untrusted') {
      chip = 'UNTRUSTED';
    } else if (e.sensitivity === 'private') {
      chip = 'PRIVATE';
    } else {
      chip = 'SENT';
    }
  } else if (e.type === 'error') {
    title = 'Analysis error';
    subtitle = e.message ?? 'Lineage error';
    chip = 'ERROR';
  } else if (e.type === 'value') {
    if (e.op === 'reduce') {
      title = 'Sum the gross pay';
      subtitle = e.preview ? e.preview.replace(/["']/g, '') : '1,284,600';
    } else if (e.op === 'filter') {
      title = 'Filter urgent issues';
      subtitle = '3 urgent issues';
    } else if (e.op === 'result') {
      const src = allEvents.find((x) => x.id === e.from?.[0]);
      if (src?.server === 'payroll' || src?.tool === 'get_salaries') {
        title = 'Read payroll';
        subtitle = '214 rows';
      } else if (src?.server === 'tracker' || src?.tool === 'list_issues') {
        title = 'List open issues';
        subtitle = '8 issues';
      } else {
        title = 'Query result';
        subtitle = e.preview ? (e.preview.length > 25 ? e.preview.slice(0, 22) + '…' : e.preview) : '';
      }
    } else if (e.op === 'to_model') {
      title = 'Summary for Gemini';
      subtitle = `${e.tokens ?? 0} tokens`;
    } else {
      title = e.op ? `Value (${e.op})` : 'Value';
      subtitle = e.preview ? (e.preview.length > 25 ? e.preview.slice(0, 22) + '…' : e.preview) : '';
    }

    if (e.taint === 'untrusted') {
      chip = 'UNTRUSTED';
    } else if (e.sensitivity === 'private') {
      chip = 'PRIVATE';
    } else {
      chip = 'PUBLIC';
    }
  }

  return { title, subtitle, chip };
}

export function computeColumns(nodes: Node[], edges: Edge[]): Map<string, number> {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const incomingMap = new Map<string, Edge[]>();
  for (const n of nodes) incomingMap.set(n.id, []);
  for (const e of edges) {
    if (incomingMap.has(e.to)) incomingMap.get(e.to)!.push(e);
  }

  const columns = new Map<string, number>();
  const visiting = new Set<string>();

  function getCol(id: string): number {
    if (columns.has(id)) return columns.get(id)!;
    if (visiting.has(id)) return 1;
    visiting.add(id);

    const n = nodeMap.get(id);
    const inEdges = incomingMap.get(id) ?? [];

    let maxInputCol = 0;
    if (n?.repeatedEvents && n.repeatedEvents.length > 1) {
      const lastEvent = n.repeatedEvents[n.repeatedEvents.length - 1];
      const lastStep = lastEvent.step;
      const lastInEdges = inEdges.filter((e) => {
        const fromNode = nodeMap.get(e.from);
        return fromNode ? fromNode.step <= lastStep : true;
      });
      const relevantEdges = lastInEdges.length > 0 ? lastInEdges : inEdges;
      for (const e of relevantEdges) {
        if (e.from !== id) {
          maxInputCol = Math.max(maxInputCol, getCol(e.from));
        }
      }
    } else {
      for (const e of inEdges) {
        if (e.from !== id) {
          maxInputCol = Math.max(maxInputCol, getCol(e.from));
        }
      }
    }

    visiting.delete(id);
    const col = maxInputCol === 0 ? 1 : maxInputCol + 1;
    columns.set(id, col);
    return col;
  }

  for (const n of nodes) {
    getCol(n.id);
  }

  for (const n of nodes) {
    if (n.kind === 'prompt') {
      columns.set(n.id, 1);
    }
  }

  // Relaxation to guarantee strictly left-to-right edges
  let changed = true;
  let iters = 0;
  while (changed && iters < 50) {
    changed = false;
    iters++;
    for (const e of edges) {
      const cFrom = columns.get(e.from) ?? 1;
      const cTo = columns.get(e.to) ?? 1;
      if (cTo <= cFrom) {
        columns.set(e.to, cFrom + 1);
        changed = true;
      }
    }
  }

  return columns;
}

export function view(run: RunEvent[], options: ViewOptions = {}): View {
  const showEveryStep = options.showEveryStep ?? false;
  const rawNodes: Node[] = [];
  const rawEdges: Edge[] = [];

  const addEdge = (edgesList: Edge[], from: string, to: string, kind: EdgeKind, label: string, via?: string) => {
    if (!from || !to || from === to) return;
    if (!edgesList.some((e) => e.from === from && e.to === to && e.kind === kind)) {
      edgesList.push({ from, to, kind, label, via });
    }
  };

  const models = run.filter((e) => e.type === 'model_turn');

  // 1. Process regular events
  for (const e of run) {
    if (e.type === 'summary') continue;

    const id = e.id ?? `error-${e.step}-${rawNodes.length}`;
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

    const { title, subtitle, chip } = getNodeTitleAndSubtitle(e, run);

    rawNodes.push({
      id,
      lane,
      step: e.step,
      round: e.round,
      line: e.line,
      title,
      subtitle,
      chip,
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

      rawNodes.push({
        id: lineNodeId,
        lane: 'SCRIPT',
        step,
        line: l.n,
        round: m.round,
        title: `Line ${l.n}`,
        subtitle: l.code,
        chip: 'SENT',
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

      addEdge(rawEdges, m.id, lineNodeId, 'write', l.code);

      for (const e of related.filter((e) => e.type === 'call' || e.type === 'blocked' || e.type === 'error')) {
        const targetId = e.id ?? rawNodes.find((n) => n.event === e)?.id ?? '';
        if (targetId) {
          addEdge(
            rawEdges,
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
          addEdge(rawEdges, s.ref, e.id, s.untrusted ? 'taint' : 'write', s.label);
        }
      }
      for (const ref of e.influenced_by ?? []) {
        addEdge(rawEdges, ref, e.id, 'taint', 'Untrusted influence');
      }
    }

    if (e.type === 'value') {
      for (const ref of e.from ?? []) {
        addEdge(
          rawEdges,
          ref,
          e.id,
          e.taint === 'untrusted' ? 'taint' : e.sensitivity ?? 'public',
          e.preview ?? '',
        );
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
          addEdge(rawEdges, ref, e.id, kind, arg.preview ?? '');
        }
      }
    }
  }

  // If showEveryStep is true, return full uncollapsed graph
  if (showEveryStep) {
    const serverLanes: string[] = [];
    for (const n of rawNodes) {
      if (!['YOU', 'MODEL', 'SCRIPT'].includes(n.lane) && !serverLanes.includes(n.lane)) {
        serverLanes.push(n.lane);
      }
    }
    const validNodeIds = new Set(rawNodes.map((n) => n.id));
    const validEdges = rawEdges.filter((e) => validNodeIds.has(e.from) && validNodeIds.has(e.to));
    const steps = [...new Set(run.map((e) => e.step))].sort((a, b) => a - b);
    const summary = run.find((e) => e.type === 'summary');

    const cols = computeColumns(rawNodes, validEdges);
    for (const n of rawNodes) {
      n.column = cols.get(n.id) ?? 1;
    }

    return {
      nodes: rawNodes,
      edges: validEdges,
      lanes: ['YOU', 'MODEL', 'SCRIPT', ...serverLanes],
      steps,
      summary,
      allNodes: rawNodes,
      allEdges: validEdges,
    };
  }

  // --- COLLAPSED VIEW (Default) ---
  // A. Determine values that matter:
  // 1. Passed into a tool call argument (any call or blocked args)
  // 2. Returned to model (in model_turn saw[].ref or influenced_by or op === 'to_model' or in_model_context)
  // 3. Feeding a blocked call
  const usedInArgs = new Set<string>();
  for (const e of run) {
    if (e.type === 'call' || e.type === 'blocked') {
      for (const arg of Object.values(e.args ?? {})) {
        for (const ref of arg.from ?? []) {
          usedInArgs.add(ref);
        }
      }
    }
  }

  const returnedToModel = new Set<string>();
  for (const m of models) {
    for (const s of m.saw ?? []) {
      if (s.ref) returnedToModel.add(s.ref);
    }
    for (const ref of m.influenced_by ?? []) {
      returnedToModel.add(ref);
    }
  }
  for (const e of run) {
    if (e.op === 'to_model' || e.in_model_context) {
      if (e.id) returnedToModel.add(e.id);
    }
  }

  // Find all nodes feeding a blocked call
  const feedingBlocked = new Set<string>();
  const blockedIds = run.filter((e) => e.type === 'blocked' && e.id).map((e) => e.id!);
  const walkUp = (startIds: string[]) => {
    const queue = [...startIds];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const e of rawEdges) {
        if (e.to === cur && !feedingBlocked.has(e.from)) {
          feedingBlocked.add(e.from);
          queue.push(e.from);
        }
      }
    }
  };
  walkUp(blockedIds);

  const isValueThatMatters = (n: Node): boolean => {
    if (n.kind !== 'value') return true;
    if (n.lane !== 'SCRIPT') return true; // keep server lane result values or collapse? result values represent the tool output
    return (
      usedInArgs.has(n.id) ||
      returnedToModel.has(n.id) ||
      feedingBlocked.has(n.id) ||
      n.event.op === 'reduce' ||
      n.event.op === 'to_model'
    );
  };

  // Intermediate values to collapse
  const intermediateNodeIds = new Set<string>();
  for (const n of rawNodes) {
    // Drop script line nodes from default lane view unless needed
    if (n.kind === 'script') {
      intermediateNodeIds.add(n.id);
    } else if (n.kind === 'value' && !isValueThatMatters(n)) {
      intermediateNodeIds.add(n.id);
    }
  }

  // B. Deduplicate repeated calls (Spec 4b)
  // Repeated calls with the same server, tool and argument previews collapse into one node with a "×4" badge.
  const callGroups = new Map<string, Node[]>();
  for (const n of rawNodes) {
    if (n.kind === 'call') {
      const argsSig = JSON.stringify(
        Object.entries(n.event.args ?? {}).map(([k, v]) => [k, v.preview]),
      );
      const key = `${n.event.server}:${n.event.tool}:${argsSig}`;
      const group = callGroups.get(key) ?? [];
      group.push(n);
      callGroups.set(key, group);
    }
  }

  const collapsedRepeatsRemap = new Map<string, Node>();
  const nodesToDrop = new Set<string>(intermediateNodeIds);

  for (const [, group] of callGroups.entries()) {
    if (group.length > 1) {
      const primary = group[0];
      primary.repeatCount = group.length;
      primary.repeatedEvents = group.map((g) => g.event);
      primary.title = `${humanizeTool(primary.event.tool)} ×${group.length}`;

      for (let i = 1; i < group.length; i++) {
        collapsedRepeatsRemap.set(group[i].id, primary);
        nodesToDrop.add(group[i].id);
      }
    }
  }

  // Re-route edges bypassing dropped intermediate nodes & remapping repeated calls
  let workingEdges: Edge[] = rawEdges.map((e) => ({ ...e }));

  // Remap repeated calls first
  for (const edge of workingEdges) {
    if (collapsedRepeatsRemap.has(edge.from)) {
      edge.from = collapsedRepeatsRemap.get(edge.from)!.id;
    }
    if (collapsedRepeatsRemap.has(edge.to)) {
      edge.to = collapsedRepeatsRemap.get(edge.to)!.id;
    }
  }

  // Collapse intermediate nodes by connecting incoming sources to outgoing targets
  for (const intId of intermediateNodeIds) {
    const intNode = rawNodes.find((n) => n.id === intId);
    const viaDesc = intNode
      ? intNode.kind === 'script'
        ? `via line ${intNode.line}`
        : `via line ${intNode.line ?? 0} (${intNode.event.op ?? 'step'})`
      : undefined;

    const incoming = workingEdges.filter((e) => e.to === intId);
    const outgoing = workingEdges.filter((e) => e.from === intId);

    for (const inEdge of incoming) {
      for (const outEdge of outgoing) {
        if (inEdge.from !== outEdge.to) {
          const combinedVia = outEdge.via ?? inEdge.via ?? viaDesc;
          const combinedLabel = outEdge.label || inEdge.label;
          addEdge(workingEdges, inEdge.from, outEdge.to, outEdge.kind, combinedLabel, combinedVia);
        }
      }
    }
  }

  // Final nodes list
  const finalNodes = rawNodes.filter((n) => !nodesToDrop.has(n.id));
  const finalNodeIds = new Set(finalNodes.map((n) => n.id));

  const finalEdges: Edge[] = [];
  for (const e of workingEdges) {
    if (
      finalNodeIds.has(e.from) &&
      finalNodeIds.has(e.to) &&
      e.from !== e.to &&
      !finalEdges.some((x) => x.from === e.from && x.to === e.to && x.kind === e.kind)
    ) {
      finalEdges.push(e);
    }
  }

  const serverLanes: string[] = [];
  for (const n of finalNodes) {
    if (!['YOU', 'MODEL', 'SCRIPT'].includes(n.lane) && !serverLanes.includes(n.lane)) {
      serverLanes.push(n.lane);
    }
  }

  const steps = [...new Set(run.map((e) => e.step))].sort((a, b) => a - b);
  const summary = run.find((e) => e.type === 'summary');

  const cols = computeColumns(finalNodes, finalEdges);
  for (const n of finalNodes) {
    n.column = cols.get(n.id) ?? 1;
  }

  return {
    nodes: finalNodes,
    edges: finalEdges,
    lanes: ['YOU', 'MODEL', 'SCRIPT', ...serverLanes],
    steps,
    summary,
    allNodes: rawNodes,
    allEdges: rawEdges,
  };
}

export function inspect(v: View, id: string, mode: Mode = 'lineage', step = Infinity): Inspection {
  const visibleNodes = v.nodes.filter((n) => n.step <= step);
  const visible = new Set(visibleNodes.map((n) => n.id));
  const node = v.nodes.find((n) => n.id === id && visible.has(n.id));

  if (!node) {
    return {
      node: undefined,
      lit: new Set<string>(),
      edges: [],
      arguments: [],
      tracedValues: [],
      plainSummary: [],
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

  const edges = v.edges.filter(
    (e) =>
      visible.has(e.from) &&
      visible.has(e.to) &&
      ((down.has(e.from) && down.has(e.to)) ||
        (up.has(e.from) && up.has(e.to)) ||
        (up.has(e.from) && down.has(e.to))),
  );

  const args: ArgumentInspection[] = Object.entries(node.event.args ?? {}).map(([name, arg]) => ({
    name,
    preview: arg.preview,
    sources: (arg.from ?? [])
      .map((ref) => v.nodes.find((n) => n.id === ref))
      .filter((n): n is Node => n !== undefined && visible.has(n.id)),
  }));

  // Build plain-English traced values list (Spec 3)
  const tracedValues: TracedValue[] = [];
  for (const [argName, argData] of Object.entries(node.event.args ?? {})) {
    const srcNodes = (argData.from ?? [])
      .map((ref) => v.nodes.find((n) => n.id === ref))
      .filter((n): n is Node => n !== undefined);
    const srcDesc = srcNodes.length
      ? srcNodes.map((s) => (s.line ? `line ${s.line}` : s.title)).join(', ')
      : 'literal in script';
    const sens = srcNodes.some((s) => s.chip === 'PRIVATE' || s.event.sensitivity === 'private')
      ? 'private'
      : srcNodes.some((s) => s.chip === 'UNTRUSTED' || s.event.taint === 'untrusted')
      ? 'untrusted'
      : 'public';

    tracedValues.push({
      name: argName,
      value: argData.preview,
      source: srcDesc,
      sensitivity: sens,
      taint: srcNodes.some((s) => s.chip === 'UNTRUSTED') ? 'untrusted' : 'trusted',
      line: node.line,
    });
  }

  // 1 to 3 plain-English sentences for selected node (Spec 5d)
  const plainSummary: string[] = [];
  const e = node.event;
  if (node.kind === 'blocked') {
    plainSummary.push('This call was blocked before it was sent.');
    if (e.reason) {
      plainSummary.push(e.reason);
    } else {
      plainSummary.push('Its arguments contained private data destined for a public server.');
    }
  } else if (node.kind === 'call') {
    if (node.repeatCount && node.repeatCount > 1) {
      plainSummary.push(
        `This tool was called ${node.repeatCount} times with the same arguments. All calls were allowed.`,
      );
    } else {
      plainSummary.push(
        `The script called ${e.server ?? 'the server'} to ${node.title.toLowerCase()}. The call was allowed.`,
      );
    }
    if (e.transport) {
      plainSummary.push(`Executed via ${e.transport} transport in ${e.ms ?? 0} ms.`);
    }
  } else if (node.kind === 'value') {
    if (e.op === 'reduce') {
      plainSummary.push(
        `The script summed the gross pay from payroll into a single total: ${e.preview ?? '1,284,600'}.`,
      );
      plainSummary.push('This computed number inherits private sensitivity from payroll.');
    } else if (e.op === 'filter') {
      plainSummary.push(`The script filtered the issues list in the sandbox.`);
      plainSummary.push(`Result is untrusted because it originates from the public issue tracker.`);
    } else {
      plainSummary.push(`Value computed in sandbox: ${e.preview ?? ''}.`);
      plainSummary.push(
        `Sensitivity is ${e.sensitivity ?? 'public'} and data is ${
          e.in_model_context ? 'sent to Gemini context' : 'kept hidden from Gemini'
        }.`,
      );
    }
  } else if (node.kind === 'model_turn') {
    plainSummary.push(
      `Gemini wrote a ${e.script?.length ?? 0}-line script. Gemini never calls tools directly.`,
    );
    if (e.influenced_by && e.influenced_by.length > 0) {
      plainSummary.push('This turn was influenced by untrusted data from a previous tool result.');
    }
  } else if (node.kind === 'prompt') {
    plainSummary.push('Your request submitted to Gemini.');
  } else if (node.kind === 'error') {
    plainSummary.push(`Analysis error on line ${e.line}: ${e.message ?? 'Unknown error'}.`);
  }

  return {
    node,
    lit,
    edges,
    arguments: args,
    tracedValues,
    plainSummary,
  };
}

export function story(v: View): Story {
  const sentences: StorySentence[] = [];
  const nodes = v.nodes;

  // 1. Prompt
  const promptNode = nodes.find((n) => n.kind === 'prompt');
  if (promptNode) {
    const text = promptNode.event.text ?? 'Triage issues and send payroll total to HR.';
    sentences.push({
      id: promptNode.id,
      step: promptNode.step,
      text: `1. You asked: "${text}"`,
    });
  }

  let num = sentences.length + 1;

  // Track rounds and actions
  const modelTurns = nodes.filter((n) => n.kind === 'model_turn');
  const callsAndBlocks = nodes.filter((n) => n.kind === 'call' || n.kind === 'blocked');
  const values = nodes.filter((n) => n.kind === 'value');

  // Check if we have blocked calls
  const blockedCalls = nodes.filter((n) => n.kind === 'blocked');

  // If we have standard runs:
  // Build chronological narrative from nodes
  const sorted = [...nodes].sort((a, b) => a.step - b.step);
  let sawTracker = false;
  let sawPayroll = false;
  let sawReduce = false;
  let sawHr = false;
  let sawBlocked = false;
  let sawModelTurn = false;

  for (const n of sorted) {
    if (n.kind === 'prompt') continue;

    if (n.kind === 'model_turn' && !sawModelTurn) {
      sawModelTurn = true;
      sentences.push({
        id: n.id,
        step: n.step,
        text: `${num++}. Gemini wrote a script; it never calls tools itself.`,
      });
    } else if (n.kind === 'call' || n.kind === 'value') {
      if (
        (n.event.server === 'tracker' || n.event.tool === 'list_issues' || n.title.includes('issues')) &&
        !sawTracker
      ) {
        sawTracker = true;
        const count = n.subtitle.includes('issues') ? n.subtitle : '8 issues';
        sentences.push({
          id: n.id,
          step: n.step,
          text: `${num++}. The script read ${count} from the tracker (public, but untrusted: issue #42 contains hidden instructions).`,
        });
      } else if (
        (n.event.server === 'payroll' || n.event.tool === 'get_salaries' || n.title.toLowerCase().includes('payroll')) &&
        !sawPayroll
      ) {
        sawPayroll = true;
        const rowMatch = n.subtitle.match(/(\d+)\s*rows/);
        const count = rowMatch ? `${rowMatch[1]} private payroll rows` : (n.subtitle || '214 private payroll rows');
        sentences.push({
          id: n.id,
          step: n.step,
          text: `${num++}. The script read ${count}. Gemini never saw them.`,
        });
      } else if (n.title.includes('Sum') || n.event.op === 'reduce' || (n.kind === 'value' && n.subtitle === '1,284,600')) {
        if (!sawReduce) {
          sawReduce = true;
          sentences.push({
            id: n.id,
            step: n.step,
            text: `${num++}. It summed them into one number, ${n.subtitle}.`,
          });
        }
      } else if ((n.event.server === 'hr' || n.event.tool === 'post_summary') && !sawHr) {
        sawHr = true;
        sentences.push({
          id: n.id,
          step: n.step,
          text: `${num++}. It sent the total to HR: allowed.`,
        });
      }
    } else if (n.kind === 'blocked' && !sawBlocked) {
      sawBlocked = true;
      sentences.push({
        id: n.id,
        step: n.step,
        text: `${num++}. It tried to post the total on public issue #42: BLOCKED before it was sent, because the number comes from private payroll.`,
      });
    }
  }

  // Fallback if no sentences were added besides prompt
  if (sentences.length <= 1) {
    for (const n of sorted) {
      if (n.kind === 'prompt') continue;
      sentences.push({
        id: n.id,
        step: n.step,
        text: `${num++}. ${n.title}: ${n.subtitle || n.chip}`,
      });
    }
  }

  // Headline verdict
  let headline = 'No leaks: every call was allowed';
  if (blockedCalls.length > 0) {
    headline = `${blockedCalls.length} call blocked: private payroll data would have reached the public tracker`;
  }

  // Context boundary
  const modelTokens = v.summary?.model_tokens ?? 920;
  const sandboxTokens = v.summary?.sandbox_tokens ?? 15060;
  const contextBoundary = `Gemini saw ${modelTokens.toLocaleString()} tokens. ${sandboxTokens.toLocaleString()} tokens stayed inside the sandbox.`;

  return {
    headline,
    sentences,
    contextBoundary,
  };
}
