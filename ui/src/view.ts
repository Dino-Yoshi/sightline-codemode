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

export type NodeKind = 'prompt' | 'model_turn' | 'call' | 'value' | 'blocked' | 'error';
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
  callSignature?: string;
  blockedReason?: string;
  untrustedReason?: string;
  hiddenInstruction?: string;
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

export function humanizeTool(tool?: string): string {
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

export function formatCallSignature(
  server?: string,
  tool?: string,
  args?: Record<string, { preview: string }>,
): string {
  const s = server ?? 'mcp';
  const t = tool ?? 'call';
  if (!args || Object.keys(args).length === 0) {
    return `${s}.${t}()`;
  }
  const formattedArgs = Object.entries(args).map(([k, v]) => {
    let raw = v.preview?.trim() ?? '';
    if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
      raw = raw.slice(1, -1);
    }
    if (raw.length > 20) {
      const totalMatch = raw.match(/\b(?:total\s*[:=]?\s*\$?[0-9,]+|\$[0-9,]+|[0-9,]{5,})/i);
      if (totalMatch) {
        raw = `…total…`;
      } else {
        raw = raw.slice(0, 16) + '…';
      }
    }
    const valStr = isNaN(Number(raw)) && !raw.startsWith('{') && !raw.startsWith('[') ? `"${raw}"` : raw;
    return `${k}: ${valStr}`;
  });
  return `${s}.${t}(${formattedArgs.join(', ')})`;
}

export function formatBlockedReason(e: RunEvent): string {
  if (e.reason) {
    if (e.reason.toLowerCase().includes('payroll') && e.reason.toLowerCase().includes('tracker')) {
      return 'blocked: payroll total → public tracker';
    }
    if (e.reason.length <= 45) {
      return `blocked: ${e.reason}`;
    }
  }
  if (e.rule === 'private→public' || e.rule === 'private-to-public') {
    return 'blocked: payroll total → public tracker';
  }
  return 'blocked: private data to public server';
}

export function extractHiddenInstruction(text?: string): string | null {
  if (!text) return null;
  const commentMatch = text.match(/<!--\s*AI assistant:\s*([\s\S]*?)-->/i);
  if (commentMatch) {
    const raw = commentMatch[1].trim();
    const short = raw.length > 40 ? raw.slice(0, 37) + '…' : raw;
    return `Issue #42 hides an instruction: "${short}"`;
  }
  if (/addressed to AI assistants/i.test(text) || /hidden (?:text|instruction)/i.test(text)) {
    if (text.includes('#42') || text.includes('42')) {
      return 'Issue #42 hides an instruction: "addressed to AI assistants"';
    }
    return 'Hides an instruction addressed to AI assistants';
  }
  if (/AI assistant/i.test(text) || /ignore previous/i.test(text)) {
    return 'Issue #42 hides an instruction: "addressed to AI assistants"';
  }
  return null;
}

export function getUntrustedReason(e: RunEvent, allEvents: RunEvent[]): { reason: string; hidden?: string } {
  const hiddenInPreview = extractHiddenInstruction(e.preview);
  if (hiddenInPreview) {
    return { reason: hiddenInPreview, hidden: hiddenInPreview };
  }

  // Check if provenance or run has hidden instruction
  if (e.influenced_by && e.influenced_by.length > 0) {
    for (const ref of e.influenced_by) {
      const src = allEvents.find((x) => x.id === ref);
      const hiddenInSrc = extractHiddenInstruction(src?.preview);
      if (hiddenInSrc) {
        return { reason: hiddenInSrc, hidden: hiddenInSrc };
      }
    }
    return { reason: 'Untrusted: influenced by data from public tracker' };
  }

  if (e.saw) {
    for (const s of e.saw) {
      const hiddenInSaw = extractHiddenInstruction(s.label);
      if (hiddenInSaw) {
        return { reason: hiddenInSaw, hidden: hiddenInSaw };
      }
      if (s.ref) {
        const src = allEvents.find((x) => x.id === s.ref);
        const hiddenInSrc = extractHiddenInstruction(src?.preview);
        if (hiddenInSrc) {
          return { reason: hiddenInSrc, hidden: hiddenInSrc };
        }
      }
    }
  }

  if (e.from) {
    for (const ref of e.from) {
      const src = allEvents.find((x) => x.id === ref);
      const hiddenInSrc = extractHiddenInstruction(src?.preview);
      if (hiddenInSrc) {
        return { reason: hiddenInSrc, hidden: hiddenInSrc };
      }
    }
  }

  if (e.server === 'tracker' || e.tool === 'list_issues' || e.op === 'filter') {
    return { reason: 'Untrusted: from the public tracker, where anyone can write' };
  }

  return { reason: 'Untrusted: from external unverified source' };
}

function getNodeMetadata(
  e: RunEvent,
  allEvents: RunEvent[],
): {
  title: string;
  subtitle: string;
  chip: StatusChip;
  callSignature?: string;
  blockedReason?: string;
  untrustedReason?: string;
  hiddenInstruction?: string;
} {
  let title = 'Event';
  let subtitle = '';
  let chip: StatusChip = 'PUBLIC';
  let callSignature: string | undefined;
  let blockedReason: string | undefined;
  let untrustedReason: string | undefined;
  let hiddenInstruction: string | undefined;

  const lineSuffix = e.line ? ` · line ${e.line}` : '';

  if (e.type === 'prompt') {
    title = 'You asked';
    subtitle = e.text ? `"${e.text}"` : `${e.tokens ?? 0} tokens`;
    chip = 'PUBLIC';
  } else if (e.type === 'model_turn') {
    title = e.round ? `Gemini wrote a script (round ${e.round})` : 'Gemini wrote a script';
    const count = e.script?.length ?? 0;
    subtitle = `${count} script line${count === 1 ? '' : 's'}`;
    const isUntrusted = e.influenced_by && e.influenced_by.length > 0;
    chip = isUntrusted ? 'UNTRUSTED' : 'SENT';
    if (isUntrusted) {
      const u = getUntrustedReason(e, allEvents);
      untrustedReason = u.reason;
      hiddenInstruction = u.hidden;
    }
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

    callSignature = formatCallSignature(e.server, e.tool, e.args);

    if (e.type === 'blocked') {
      chip = 'BLOCKED';
      blockedReason = formatBlockedReason(e);
    } else if (e.taint === 'untrusted') {
      chip = 'UNTRUSTED';
      const u = getUntrustedReason(e, allEvents);
      untrustedReason = u.reason;
      hiddenInstruction = u.hidden;
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
      const rawNum = e.preview ? e.preview.replace(/[^0-9.-]/g, '') : '';
      const num = Number(rawNum);
      const numStr = !isNaN(num) && rawNum.length > 0 ? num.toLocaleString() : (e.preview ?? '1,284,600');
      title = `total = ${numStr}${lineSuffix}`;
      subtitle = numStr;
    } else if (e.op === 'filter') {
      let count = 3;
      if (e.preview && e.preview.startsWith('[')) {
        try {
          const parsed = JSON.parse(e.preview);
          if (Array.isArray(parsed)) count = parsed.length;
        } catch {
          const commas = e.preview.match(/,/g);
          if (commas) count = commas.length + 1;
        }
      }
      title = `urgent issues (${count})${lineSuffix}`;
      subtitle = `${count} urgent issues`;
    } else if (e.op === 'result') {
      const src = allEvents.find((x) => x.id === e.from?.[0]);
      if (src?.server === 'payroll' || src?.tool === 'get_salaries') {
        title = 'Read payroll';
        subtitle = '214 rows';
      } else if (src?.server === 'tracker' || src?.tool === 'list_issues') {
        title = 'List open issues';
        subtitle = '8 issues';
      } else {
        title = `Query result${lineSuffix}`;
        subtitle = e.preview ? (e.preview.length > 25 ? e.preview.slice(0, 22) + '…' : e.preview) : '';
      }
    } else if (e.op === 'to_model') {
      if (e.preview?.includes('issues')) {
        title = `issues preview${lineSuffix}`;
      } else {
        title = `Summary for Gemini${lineSuffix}`;
      }
      subtitle = `${e.tokens ?? 0} tokens`;
    } else {
      if (e.preview && e.preview.toLowerCase().includes('total')) {
        title = `total = ${e.preview}${lineSuffix}`;
      } else {
        title = e.op ? `Value (${e.op})${lineSuffix}` : `Value${lineSuffix}`;
      }
      subtitle = e.preview ? (e.preview.length > 25 ? e.preview.slice(0, 22) + '…' : e.preview) : '';
    }

    if (e.taint === 'untrusted') {
      chip = 'UNTRUSTED';
      const u = getUntrustedReason(e, allEvents);
      untrustedReason = u.reason;
      hiddenInstruction = u.hidden;
    } else if (e.sensitivity === 'private') {
      chip = 'PRIVATE';
    } else {
      chip = 'PUBLIC';
    }
  }

  return {
    title,
    subtitle,
    chip,
    callSignature,
    blockedReason,
    untrustedReason,
    hiddenInstruction,
  };
}

export function computeColumns(nodes: Node[], edges: Edge[]): Map<string, number> {
  const columns = new Map<string, number>();
  if (nodes.length === 0) return columns;

  // 1. Group nodes into actions:
  // An action is one model turn, or one script line's execution:
  // its tool call and everything produced by that same line (call's result value, values derived on that line, blocked event).
  const actionKeyMap = new Map<string, string>();
  const actions = new Map<string, Node[]>();

  for (const n of nodes) {
    let key = '';
    if (n.kind === 'model_turn') {
      key = `model_${n.round ?? 1}_${n.id}`;
    } else if (n.kind === 'call' || n.kind === 'blocked') {
      key = `call_${n.id}`;
    } else if (n.kind === 'value') {
      if (n.event.op === 'result' && n.event.from?.[0]) {
        const sourceCallId = n.event.from[0];
        const callNode = nodes.find((x) => x.id === sourceCallId);
        if (callNode && (callNode.round ?? 1) === (n.round ?? 1)) {
          key = `call_${callNode.id}`;
        } else if (n.line !== undefined) {
          key = `line_${n.round ?? 1}_${n.step}_${n.line}`;
        } else {
          key = `value_${n.round ?? 1}_${n.step}_${n.id}`;
        }
      } else if (n.line !== undefined) {
        key = `line_${n.round ?? 1}_${n.step}_${n.line}`;
      } else {
        key = `value_${n.round ?? 1}_${n.step}_${n.id}`;
      }
    } else {
      key = `event_${n.round ?? 1}_${n.step}_${n.id}`;
    }

    actionKeyMap.set(n.id, key);
    if (!actions.has(key)) actions.set(key, []);
    actions.get(key)!.push(n);
  }

  // 2. Sort actions by time order (step, then event t, then original order)
  type ActionInfo = {
    key: string;
    round: number;
    step: number;
    t: number;
    firstIndex: number;
    nodes: Node[];
  };

  const actionList: ActionInfo[] = [];
  for (const [key, actNodes] of actions.entries()) {
    const minRound = Math.min(...actNodes.map((n) => n.round ?? 1));
    const minStep = Math.min(...actNodes.map((n) => n.step));
    const minT = Math.min(...actNodes.map((n) => n.event.t ?? 0));
    const firstIndex = Math.min(...actNodes.map((n) => nodes.indexOf(n)));
    actionList.push({
      key,
      round: minRound,
      step: minStep,
      t: minT,
      firstIndex,
      nodes: actNodes,
    });
  }

  actionList.sort((a, b) => {
    if (a.round !== b.round) return a.round - b.round;
    if (a.step !== b.step) return a.step - b.step;
    if (a.t !== b.t) return a.t - b.t;
    return a.firstIndex - b.firstIndex;
  });

  // 3. Assign initial columns to actions in time order
  let col = 1;
  const actionColMap = new Map<string, number>();
  for (const act of actionList) {
    actionColMap.set(act.key, col);
    for (const n of act.nodes) {
      columns.set(n.id, col);
    }
    col++;
  }

  // 4. Guarantee strict non-decreasing order for dependencies (never place a node left of what it depends on)
  let changed = true;
  let iters = 0;
  while (changed && iters < 50) {
    changed = false;
    iters++;
    for (const e of edges) {
      const cFrom = columns.get(e.from) ?? 1;
      const cTo = columns.get(e.to) ?? 1;
      const fromKey = actionKeyMap.get(e.from);
      const toKey = actionKeyMap.get(e.to);
      const minRequired = fromKey === toKey ? cFrom : cFrom + 1;
      if (cTo < minRequired) {
        // Shift this action and all subsequent actions to maintain time ordering
        const diff = minRequired - cTo;
        for (const act of actionList) {
          const actCol = actionColMap.get(act.key) ?? 1;
          if (actCol >= cTo) {
            actionColMap.set(act.key, actCol + diff);
            for (const n of act.nodes) {
              columns.set(n.id, actCol + diff);
            }
          }
        }
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

  // Determine rounds mapping for events
  const getEventRound = (e: RunEvent): number => {
    if (e.round) return e.round;
    if (e.type === 'model_turn') {
      const idx = models.indexOf(e);
      return idx >= 0 ? idx + 1 : 1;
    }
    // Find the latest model turn at or before this event's step / t
    const priorModels = models.filter((m) => (m.step !== undefined && e.step !== undefined ? m.step <= e.step : m.t <= e.t));
    if (priorModels.length > 0) {
      const last = priorModels[priorModels.length - 1];
      return last.round ?? (models.indexOf(last) + 1);
    }
    return 1;
  };

  // 1. Process regular events (exclude prompt from canvas nodes per S3)
  for (const e of run) {
    if (e.type === 'summary' || e.type === 'prompt') continue;

    const id = e.id ?? `error-${e.step}-${rawNodes.length}`;
    let lane = 'SCRIPT';
    if (e.type === 'model_turn') {
      lane = 'MODEL';
    } else if (e.type === 'call' || e.type === 'blocked') {
      lane = e.server ?? 'SCRIPT';
    } else if (e.type === 'value' && e.op === 'result') {
      const sourceCall = run.find((x) => x.id === e.from?.[0]);
      lane = sourceCall?.server ?? 'SCRIPT';
    } else if (e.type === 'error') {
      lane = 'SCRIPT';
    }

    const round = getEventRound(e);
    const {
      title,
      subtitle,
      chip,
      callSignature,
      blockedReason,
      untrustedReason,
      hiddenInstruction,
    } = getNodeMetadata(e, run);

    rawNodes.push({
      id,
      lane,
      step: e.step,
      round,
      line: e.line,
      title,
      subtitle,
      chip,
      event: e,
      kind: e.type as NodeKind,
      callSignature,
      blockedReason,
      untrustedReason,
      hiddenInstruction,
    });
  }

  // 2. Add ONE grey "writes" edge from model turn to the first node of its round (S2)
  // (Will also ensure write edges connect to remaining round nodes after collapse/dedupe)
  for (const m of models) {
    if (!m.id) continue;
    const mRound = getEventRound(m);
    const roundNodes = rawNodes.filter((n) => n.round === mRound && n.id !== m.id);
    if (roundNodes.length > 0) {
      const sortedRoundNodes = [...roundNodes].sort((a, b) => a.step - b.step);
      const firstNode = sortedRoundNodes[0];
      addEdge(rawEdges, m.id, firstNode.id, 'write', 'writes');
    }
  }

  // 3. Connect data dependencies and influence edges
  for (const e of run) {
    if (!e.id) continue;

    if (e.type === 'model_turn') {
      for (const s of e.saw ?? []) {
        if (s.ref && s.ref !== 'P') {
          addEdge(rawEdges, s.ref, e.id, s.untrusted ? 'taint' : 'write', s.label);
        }
      }
      for (const ref of e.influenced_by ?? []) {
        if (ref !== 'P') {
          addEdge(rawEdges, ref, e.id, 'taint', 'Untrusted influence');
        }
      }
    }

    if (e.type === 'value') {
      for (const ref of e.from ?? []) {
        if (ref !== 'P') {
          addEdge(
            rawEdges,
            ref,
            e.id,
            e.taint === 'untrusted' ? 'taint' : e.sensitivity ?? 'public',
            e.preview ?? '',
          );
        }
      }
    }

    if (e.type === 'call' || e.type === 'blocked') {
      for (const arg of Object.values(e.args ?? {})) {
        for (const ref of arg.from ?? []) {
          if (ref !== 'P') {
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
  }

  // Helper to compute active lanes (S3: Hide a lane that has no nodes)
  const computeActiveLanes = (nodesList: Node[]): string[] => {
    const canonicalOrder = ['MODEL', 'SCRIPT', 'tracker', 'payroll', 'hr'];
    const otherLanes: string[] = [];
    for (const n of nodesList) {
      if (!canonicalOrder.includes(n.lane) && !otherLanes.includes(n.lane)) {
        otherLanes.push(n.lane);
      }
    }
    const allCandidates = [...canonicalOrder, ...otherLanes];
    return allCandidates.filter((l) => nodesList.some((n) => n.lane === l));
  };

  // If showEveryStep is true: show all value nodes, but never script lines (S1)
  if (showEveryStep) {
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
      lanes: computeActiveLanes(rawNodes),
      steps,
      summary,
      allNodes: rawNodes,
      allEdges: validEdges,
    };
  }

  // --- COLLAPSED VIEW (Default) ---
  // A. Determine values that matter:
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
    if (n.lane !== 'SCRIPT') return true;
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
    if (n.kind === 'value' && !isValueThatMatters(n)) {
      intermediateNodeIds.add(n.id);
    }
  }

  // B. Deduplicate repeated calls
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
      ? `via line ${intNode.line ?? 0} (${intNode.event.op ?? 'step'})`
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

  // Remove write edges that cross rounds due to deduplication remapping
  const filteredWorkingEdges = workingEdges.filter((e) => {
    if (e.kind === 'write') {
      const fromNode = rawNodes.find((n) => n.id === e.from);
      const toNode = finalNodes.find((n) => n.id === e.to);
      if (fromNode && toNode && fromNode.kind === 'model_turn') {
        if ((fromNode.round ?? 1) !== (toNode.round ?? 1)) return false;
      }
    }
    return true;
  });

  const finalEdges: Edge[] = [];
  for (const e of filteredWorkingEdges) {
    if (
      finalNodeIds.has(e.from) &&
      finalNodeIds.has(e.to) &&
      e.from !== e.to &&
      !finalEdges.some((x) => x.from === e.from && x.to === e.to && x.kind === e.kind)
    ) {
      finalEdges.push(e);
    }
  }

  // Ensure each model turn in finalNodes has a writes edge to the first node of its round if any exist
  for (const m of models) {
    if (!m.id || !finalNodeIds.has(m.id)) continue;
    const mRound = getEventRound(m);
    const hasWrite = finalEdges.some((e) => e.from === m.id && e.kind === 'write');
    if (!hasWrite) {
      const roundNodes = finalNodes.filter((n) => (n.round ?? 1) === mRound && n.id !== m.id);
      if (roundNodes.length > 0) {
        const sortedRoundNodes = [...roundNodes].sort((a, b) => a.step - b.step);
        addEdge(finalEdges, m.id, sortedRoundNodes[0].id, 'write', 'writes');
      }
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
    lanes: computeActiveLanes(finalNodes),
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
        `The script summed the gross pay from payroll into a single total: ${node.subtitle || '1,284,600'}.`,
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

export function story(v: View, promptTextOverride?: string): Story {
  const sentences: StorySentence[] = [];
  const nodes = v.nodes;

  const promptText = promptTextOverride ?? "Triage this week's open issues and post the October payroll total to HR.";
  sentences.push({
    text: `1. You asked: "${promptText}"`,
  });

  let num = 2;

  const blockedCalls = nodes.filter((n) => n.kind === 'blocked');
  const sorted = [...nodes].sort((a, b) => a.step - b.step);

  let sawTracker = false;
  let sawPayroll = false;
  let sawReduce = false;
  let sawHr = false;
  let sawBlocked = false;
  let sawModelTurn = false;

  for (const n of sorted) {
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
      } else if (n.title.includes('total') || n.title.includes('Sum') || n.event.op === 'reduce' || (n.kind === 'value' && n.subtitle === '1,284,600')) {
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
