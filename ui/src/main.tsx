import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import fakeRunText from '../../runs/fake-run.jsonl?raw';
import runAText from '../../runs/run-a.jsonl?raw';
import runBText from '../../runs/run-b.jsonl?raw';
import {
  inspect,
  parseRun,
  view,
  story,
  getRoundSummary,
  getInitialCollapsedRounds,
  buildLineageChains,
  type Node,
  type Edge,
  type RunEvent,
  type RoundSummary,
  type LineageChainStep,
} from './view';
import './style.css';

export const presetRuns: Record<string, { label: string; text: string }> = {
  fake: { label: 'Simulated: injection succeeds', text: fakeRunText },
  runA: { label: 'Recorded live: A (triage + HR)', text: runAText },
  runB: { label: 'Recorded live: B (honest mistake)', text: runBText },
};

const fmt = (n: number) => n.toLocaleString();

export const LANE_SUBTITLES: Record<string, string> = {
  MODEL: 'Gemini: writes code, never calls tools',
  SCRIPT: 'the code it wrote, running in a sandbox',
  payroll: 'private data',
  tracker: 'public, untrusted',
  hr: 'HR only',
};

export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 80;
export const CARD_GAP_Y = 14;
export const COLUMN_WIDTH = 290;
export const COLLAPSED_COLUMN_WIDTH = 160;
export const GUTTER_WIDTH = 70;
export const LEFT_OFFSET = 180;

export function orthogonalPath(points: Array<{ x: number; y: number }>, radius = 6): string {
  if (points.length < 2) return '';
  const pts: Array<{ x: number; y: number }> = [];
  for (const p of points) {
    if (
      pts.length === 0 ||
      Math.abs(pts[pts.length - 1].x - p.x) > 0.5 ||
      Math.abs(pts[pts.length - 1].y - p.y) > 0.5
    ) {
      pts.push(p);
    }
  }
  if (pts.length < 2) return '';
  if (pts.length === 2) {
    return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
  }

  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const pPrev = pts[i - 1];
    const pCur = pts[i];
    const pNext = pts[i + 1];

    const dx1 = pCur.x - pPrev.x;
    const dy1 = pCur.y - pPrev.y;
    const len1 = Math.hypot(dx1, dy1);

    const dx2 = pNext.x - pCur.x;
    const dy2 = pNext.y - pCur.y;
    const len2 = Math.hypot(dx2, dy2);

    const r = Math.min(radius, len1 / 2, len2 / 2);

    const startCornerX = pCur.x - (dx1 / len1) * r;
    const startCornerY = pCur.y - (dy1 / len1) * r;
    const endCornerX = pCur.x + (dx2 / len2) * r;
    const endCornerY = pCur.y + (dy2 / len2) * r;

    d += ` L ${startCornerX} ${startCornerY} Q ${pCur.x} ${pCur.y}, ${endCornerX} ${endCornerY}`;
  }
  d += ` L ${pts[pts.length - 1].x} ${pts[pts.length - 1].y}`;
  return d;
}

export function getNodesForLine(graphNodes: Node[], round: number, lineNum: number): Node[] {
  const matching = graphNodes.filter((n) => {
    const nodeRound = n.round ?? 1;
    if (nodeRound !== round) return false;
    if (n.line === lineNum) return true;
    if (n.event?.line === lineNum) return true;
    return false;
  });

  // Sort by priority: tool call or blocked first, then value, then other
  matching.sort((a, b) => {
    const priority = (kind: string) => {
      if (kind === 'call' || kind === 'blocked') return 1;
      if (kind === 'value') return 2;
      return 3;
    };
    return priority(a.kind) - priority(b.kind);
  });

  return matching;
}

export function computeLayout(
  graph: { nodes: Node[]; edges: Edge[]; lanes: string[] },
  collapsedRounds: Set<number> = new Set(),
) {
  const laneHeightMap: Record<string, number> = {};
  const laneTopMap: Record<string, number> = {};
  const pos: Record<string, { x: number; y: number; col: number }> = {};

  const maxCol = Math.max(1, ...graph.nodes.map((n) => n.column ?? 1));

  // Determine rounds and assign X positions to each column
  const allRounds = Array.from(new Set(graph.nodes.map((n) => n.round ?? 1))).sort((a, b) => a - b);
  const roundInfoList: Array<{
    round: number;
    startX: number;
    width: number;
    collapsed: boolean;
    summary: RoundSummary;
  }> = [];

  const colXMap = new Map<number, number>();
  const gutterBaseXMap = new Map<number, number>();

  let currentX = LEFT_OFFSET;

  for (const r of allRounds) {
    const rNodes = graph.nodes.filter((n) => (n.round ?? 1) === r);
    const rCols = Array.from(new Set(rNodes.map((n) => n.column ?? 1))).sort((a, b) => a - b);
    const summary = getRoundSummary(graph, r);
    const isCollapsed = collapsedRounds.has(r);

    if (isCollapsed) {
      const startX = currentX;
      const width = COLLAPSED_COLUMN_WIDTH;
      for (const col of rCols) {
        colXMap.set(col, startX);
        gutterBaseXMap.set(col, startX - GUTTER_WIDTH / 2);
      }
      gutterBaseXMap.set((rCols.at(-1) ?? 1) + 1, startX + width + GUTTER_WIDTH / 2);
      roundInfoList.push({
        round: r,
        startX,
        width,
        collapsed: true,
        summary,
      });
      currentX += width + GUTTER_WIDTH;
    } else {
      const startX = currentX - 20;
      for (const col of rCols) {
        colXMap.set(col, currentX);
        gutterBaseXMap.set(col, currentX - GUTTER_WIDTH / 2);
        currentX += COLUMN_WIDTH;
      }
      gutterBaseXMap.set((rCols.at(-1) ?? 1) + 1, currentX - GUTTER_WIDTH / 2);
      const width = Math.max(COLUMN_WIDTH, rCols.length * COLUMN_WIDTH);
      roundInfoList.push({
        round: r,
        startX,
        width,
        collapsed: false,
        summary,
      });
    }
  }

  // Calculate max stacked items in any column for each lane
  for (const lane of graph.lanes) {
    const laneNodes = graph.nodes.filter((n) => n.lane === lane);
    const colCounts: Record<number, number> = {};

    for (const node of laneNodes) {
      const c = node.column ?? 1;
      colCounts[c] = (colCounts[c] ?? 0) + 1;
    }

    const maxStack = Math.max(1, ...Object.values(colCounts), 1);
    const height = Math.max(130, 44 + maxStack * NODE_HEIGHT + Math.max(0, maxStack - 1) * CARD_GAP_Y + 24);
    laneHeightMap[lane] = height;
  }

  // Cumulative Y offsets with 32px gap between lanes (channel space)
  let currentTop = 24;
  for (const lane of graph.lanes) {
    laneTopMap[lane] = currentTop;
    currentTop += laneHeightMap[lane] + 32;
  }

  const totalHeight = currentTop + 60;

  // Position each node: within lane and column, ordered by time / event order
  for (const lane of graph.lanes) {
    const laneNodes = graph.nodes.filter((n) => n.lane === lane);
    const byCol = new Map<number, Node[]>();
    for (const node of laneNodes) {
      const c = node.column ?? 1;
      if (!byCol.has(c)) byCol.set(c, []);
      byCol.get(c)!.push(node);
    }

    for (const [col, colNodes] of byCol.entries()) {
      colNodes.forEach((node, stackIdx) => {
        const laneTop = laneTopMap[lane] ?? 24;
        const x = colXMap.get(col) ?? (LEFT_OFFSET + (col - 1) * COLUMN_WIDTH);
        const y = laneTop + 44 + stackIdx * (NODE_HEIGHT + CARD_GAP_Y);
        pos[node.id] = { x, y, col };
      });
    }
  }

  const totalWidth = Math.max(1100, currentX + 220);

  // --- H2 Orthogonal Edge Routing with Inter-Lane Channels & Vertical Gutter Tracks ---
  // 1. Determine incoming and outgoing edges per node
  const incomingMap = new Map<string, Edge[]>();
  const outgoingMap = new Map<string, Edge[]>();
  for (const n of graph.nodes) {
    incomingMap.set(n.id, []);
    outgoingMap.set(n.id, []);
  }
  for (const e of graph.edges) {
    if (incomingMap.has(e.to)) incomingMap.get(e.to)!.push(e);
    if (outgoingMap.has(e.from)) outgoingMap.get(e.from)!.push(e);
  }

  // 2. Identify channels and gutters used by edges
  const channelEdges = new Map<number, Edge[]>();
  const gutterEdges = new Map<number, Edge[]>();

  const getChannelBaseY = (chIdx: number): number => {
    if (graph.lanes.length === 0) return 20;
    if (chIdx < 0) return Math.max(12, (laneTopMap[graph.lanes[0]] ?? 24) - 16);
    if (chIdx >= graph.lanes.length - 1) {
      const lastLane = graph.lanes[graph.lanes.length - 1];
      return (laneTopMap[lastLane] ?? 24) + (laneHeightMap[lastLane] ?? 130) + 16;
    }
    const nextLane = graph.lanes[chIdx + 1];
    return (laneTopMap[nextLane] ?? 24) - 16;
  };

  const getGutterBaseX = (col: number): number => {
    if (gutterBaseXMap.has(col)) return gutterBaseXMap.get(col)!;
    return LEFT_OFFSET + (col - 1) * COLUMN_WIDTH - GUTTER_WIDTH / 2;
  };

  const edgeChannelMap = new Map<string, number>();

  for (const e of graph.edges) {
    const nodeFrom = graph.nodes.find((n) => n.id === e.from);
    const nodeTo = graph.nodes.find((n) => n.id === e.to);
    if (!nodeFrom || !nodeTo) continue;

    const laneFromIdx = graph.lanes.indexOf(nodeFrom.lane);
    const laneToIdx = graph.lanes.indexOf(nodeTo.lane);
    const pFrom = pos[e.from];
    const pTo = pos[e.to];
    if (!pFrom || !pTo) continue;

    // Determine target channel (gap just above or below target lane per H2(a))
    let ch = laneToIdx - 1;
    if (laneFromIdx > laneToIdx) {
      ch = laneToIdx; // just below target lane
    } else {
      ch = laneToIdx - 1; // just above target lane
    }
    edgeChannelMap.set(`${e.from}-${e.to}-${e.kind}`, ch);

    if (!channelEdges.has(ch)) channelEdges.set(ch, []);
    channelEdges.get(ch)!.push(e);

    // Vertical gutter left of target column
    const gIn = pTo.col;
    if (!gutterEdges.has(gIn)) gutterEdges.set(gIn, []);
    gutterEdges.get(gIn)!.push(e);

    // If source needs exit vertical run in gutter right of source column
    if (pTo.col > pFrom.col + 1 || laneFromIdx !== laneToIdx || pTo.col === pFrom.col) {
      const gOut = pFrom.col + 1;
      if (!gutterEdges.has(gOut)) gutterEdges.set(gOut, []);
      if (!gutterEdges.get(gOut)!.includes(e)) {
        gutterEdges.get(gOut)!.push(e);
      }
    }
  }

  // 3. Compute 6px track offsets for channel and gutter runs
  const edgeChannelTrackY = new Map<string, number>();
  for (const [ch, edges] of channelEdges.entries()) {
    const sorted = [...edges].sort((a, b) => {
      const yA = pos[a.to]?.y ?? 0;
      const yB = pos[b.to]?.y ?? 0;
      return yA - yB;
    });
    const baseY = getChannelBaseY(ch);
    const count = sorted.length;
    sorted.forEach((e, idx) => {
      const offset = (idx - (count - 1) / 2) * 6;
      edgeChannelTrackY.set(`${e.from}-${e.to}-${e.kind}`, baseY + offset);
    });
  }

  const edgeGutterTrackX = new Map<string, number>(); // key: `${gutter}-${from}-${to}-${kind}`
  for (const [g, edges] of gutterEdges.entries()) {
    const sorted = [...edges].sort((a, b) => {
      const yA = pos[a.to]?.y ?? 0;
      const yB = pos[b.to]?.y ?? 0;
      return yA - yB;
    });
    const baseX = getGutterBaseX(g);
    const count = sorted.length;
    sorted.forEach((e, idx) => {
      const offset = (idx - (count - 1) / 2) * 6;
      edgeGutterTrackX.set(`${g}-${e.from}-${e.to}-${e.kind}`, baseX + offset);
    });
  }

  // 4. Generate paths and line segments
  const edgePaths: Record<string, string> = {};
  const edgeSegments: Record<string, Array<{ x1: number; y1: number; x2: number; y2: number }>> = {};

  for (const e of graph.edges) {
    const pFrom = pos[e.from];
    const pTo = pos[e.to];
    if (!pFrom || !pTo) continue;

    const inList = incomingMap.get(e.to) ?? [];
    const inIdx = inList.indexOf(e);
    const inCount = Math.max(1, inList.length);

    // H2(c): Arrows into a node are spread across its left side instead of hitting one point
    const yEntry = pTo.y + ((inIdx + 1) * NODE_HEIGHT) / (inCount + 1);
    const xEntry = pTo.x;

    const outList = outgoingMap.get(e.from) ?? [];
    const outIdx = outList.indexOf(e);
    const outCount = Math.max(1, outList.length);
    const yExit = pFrom.y + ((outIdx + 1) * NODE_HEIGHT) / (outCount + 1);
    const xExit = pFrom.x + NODE_WIDTH;

    const edgeKey = `${e.from}-${e.to}-${e.kind}`;
    const ch = edgeChannelMap.get(edgeKey) ?? 0;
    const yChannel = edgeChannelTrackY.get(edgeKey) ?? getChannelBaseY(ch);

    const xIn = edgeGutterTrackX.get(`${pTo.col}-${edgeKey}`) ?? getGutterBaseX(pTo.col);
    const xOut = edgeGutterTrackX.get(`${pFrom.col + 1}-${edgeKey}`) ?? getGutterBaseX(pFrom.col + 1);

    const nodeFrom = graph.nodes.find((n) => n.id === e.from);
    const nodeTo = graph.nodes.find((n) => n.id === e.to);
    const sameLane = nodeFrom && nodeTo && nodeFrom.lane === nodeTo.lane;

    let points: Array<{ x: number; y: number }> = [];

    if (pTo.col > pFrom.col && pTo.col === pFrom.col + 1 && sameLane && Math.abs(yExit - yEntry) < 2) {
      // Direct horizontal neighbor in same lane
      points = [
        { x: xExit, y: yExit },
        { x: xEntry, y: yEntry },
      ];
    } else if (pTo.col > pFrom.col && pTo.col === pFrom.col + 1 && sameLane) {
      // Adjacent column, same lane: vertical turn in the gutter between them
      points = [
        { x: xExit, y: yExit },
        { x: xIn, y: yExit },
        { x: xIn, y: yEntry },
        { x: xEntry, y: yEntry },
      ];
    } else if (pTo.col > pFrom.col) {
      // Multiple columns or different lanes: exit to gutter -> channel -> entry gutter -> target
      points = [
        { x: xExit, y: yExit },
        { x: xOut, y: yExit },
        { x: xOut, y: yChannel },
        { x: xIn, y: yChannel },
        { x: xIn, y: yEntry },
        { x: xEntry, y: yEntry },
      ];
    } else {
      // Same column (e.g. call and result sharing a column)
      points = [
        { x: xExit, y: yExit },
        { x: xOut, y: yExit },
        { x: xOut, y: yChannel },
        { x: xIn, y: yChannel },
        { x: xIn, y: yEntry },
        { x: xEntry, y: yEntry },
      ];
    }

    edgePaths[edgeKey] = orthogonalPath(points, 6);

    // Save straight segments for geometry intersection verification
    const segments: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    for (let i = 0; i < points.length - 1; i++) {
      segments.push({
        x1: points[i].x,
        y1: points[i].y,
        x2: points[i + 1].x,
        y2: points[i + 1].y,
      });
    }
    edgeSegments[edgeKey] = segments;
  }

  return {
    pos,
    laneHeightMap,
    laneTopMap,
    totalHeight,
    totalWidth,
    edgePaths,
    edgeSegments,
    maxCol,
    roundInfoList,
  };
}

export function App() {
  const [source, setSource] = useState<'recorded' | 'live'>('recorded');
  const [recordedKey, setRecordedKey] = useState<'fake' | 'runA' | 'runB'>('fake');
  const [liveTask, setLiveTask] = useState<'A' | 'B'>('A');
  const [liveEvents, setLiveEvents] = useState<RunEvent[]>([]);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [wsStatus, setWsStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Feature Toggles (G2: 0.25x / 0.5x / 1x / 2x speed toggle, default 0.5x on live runs)
  const [userShowEveryStep, setUserShowEveryStep] = useState<boolean>(false);
  const [replaySpeed, setReplaySpeed] = useState<0.25 | 0.5 | 1 | 2>(1);
  const [isFit, setIsFit] = useState<boolean>(false);
  const [autoFollow, setAutoFollow] = useState<boolean>(true);
  const [showLegend, setShowLegend] = useState<boolean>(false);

  // Round collapsing state (G1a)
  const [collapsedRounds, setCollapsedRounds] = useState<Set<number>>(new Set());

  // Side Panes and Focus Mode (H5: draggable pane width)
  const [leftPaneWidth, setLeftPaneWidth] = useState<number>(320);
  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(false);
  const [rightCollapsed, setRightCollapsed] = useState<boolean>(false);
  const [focusMode, setFocusMode] = useState<boolean>(true);

  // Playback & Animation
  const [playing, setPlaying] = useState<boolean>(false);
  const [justRevealedId, setJustRevealedId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // Live queue ref
  const liveQueueRef = useRef<RunEvent[]>([]);

  const canvasScrollRef = useRef<HTMLDivElement>(null);
  const isAutoScrollingRef = useRef<boolean>(false);
  const scriptContainerRef = useRef<HTMLElement>(null);

  // Dynamic detail level during playback/streaming
  const effectiveShowEveryStep = playing || isStreaming ? true : userShowEveryStep;

  const rawEvents = useMemo(() => {
    if (source === 'live') return liveEvents;
    const txt = presetRuns[recordedKey]?.text ?? fakeRunText;
    return parseRun(txt);
  }, [source, liveEvents, recordedKey]);

  const promptEvent = rawEvents.find((e) => e.type === 'prompt');
  const promptText = promptEvent?.text ?? "Triage issues and send payroll total to HR.";

  const graph = useMemo(() => {
    return view(rawEvents, { showEveryStep: effectiveShowEveryStep });
  }, [rawEvents, effectiveShowEveryStep]);

  // Initialize collapsed rounds whenever graph changes (G1a)
  useEffect(() => {
    setCollapsedRounds(getInitialCollapsedRounds(graph));
  }, [graph]);

  const toggleRound = useCallback((roundNum: number) => {
    setCollapsedRounds((prev) => {
      const next = new Set(prev);
      if (next.has(roundNum)) {
        next.delete(roundNum);
      } else {
        next.add(roundNum);
      }
      return next;
    });
  }, []);

  const runStory = useMemo(() => {
    return story(graph, promptText);
  }, [graph, promptText]);

  const maxStep = graph.steps.at(-1) ?? 1;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [step, setStep] = useState<number>(maxStep);
  const [display, setDisplay] = useState<'graph' | 'strace'>('graph');

  // Sync step with maxStep when source or recorded preset changes (when not replaying/streaming)
  useEffect(() => {
    if (!playing && !isStreaming) {
      setStep(graph.steps.at(-1) ?? 1);
    }
  }, [recordedKey, source, graph.steps, playing, isStreaming]);

  // Live run WebSocket starter (G2: default to 0.5x speed on live runs)
  const startLiveRun = useCallback((taskKey: 'A' | 'B') => {
    setSource('live');
    setLiveTask(taskKey);
    setLiveEvents([]);
    liveQueueRef.current = [];
    setSelectedId(null);
    setErrorMessage(null);
    setIsStreaming(true);
    setWsStatus('connecting');
    setAutoFollow(true);
    setReplaySpeed(0.5);

    try {
      const ws = new WebSocket('ws://localhost:8765');
      ws.onopen = () => {
        setWsStatus('connected');
        ws.send(JSON.stringify({ action: 'run', task: taskKey }));
      };
      ws.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data) as RunEvent;
          liveQueueRef.current.push(event);
        } catch (err) {
          console.error('Error parsing live event', err);
        }
      };
      ws.onerror = (err) => {
        console.error('WebSocket error', err);
        setWsStatus('error');
        setErrorMessage('Cannot connect to ws://localhost:8765. Make sure the engine server is running.');
        setIsStreaming(false);
      };
      ws.onclose = () => {
        // Queue drainer will finish streaming once empty
      };
    } catch (err) {
      setWsStatus('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setIsStreaming(false);
    }
  }, []);

  // Live queue pacing timer
  useEffect(() => {
    if (!isStreaming && liveQueueRef.current.length === 0) return;

    const interval = Math.round(450 / replaySpeed);
    const timer = setInterval(() => {
      if (liveQueueRef.current.length > 0) {
        const nextEvent = liveQueueRef.current.shift()!;
        setLiveEvents((prev) => [...prev, nextEvent]);
        if (typeof nextEvent.step === 'number') {
          setStep(nextEvent.step);
          const nId = nextEvent.id ?? `step-${nextEvent.step}`;
          setJustRevealedId(nId);
        }
        if (nextEvent.type === 'summary') {
          setIsStreaming(false);
        }
      }
    }, interval);

    return () => clearInterval(timer);
  }, [isStreaming, replaySpeed]);

  const detail = useMemo(() => {
    if (!selectedId) return null;
    return inspect(graph, selectedId, 'lineage', step);
  }, [graph, selectedId, step]);

  const visibleNodes = useMemo(() => {
    return graph.nodes.filter((n) => n.step <= step);
  }, [graph.nodes, step]);

  const visibleNodeIds = useMemo(() => {
    return new Set(visibleNodes.map((n) => n.id));
  }, [visibleNodes]);

  // Layout computation & Orthogonal routing with collapsed rounds support (G1a)
  const layout = useMemo(() => {
    return computeLayout(graph, collapsedRounds);
  }, [graph, collapsedRounds]);

  // Replay timer
  useEffect(() => {
    if (!playing) return;
    if (step >= maxStep) {
      setPlaying(false);
      return;
    }
    const interval = Math.round(700 / replaySpeed);
    const timer = setTimeout(() => {
      setStep((s) => {
        const next = Math.min(maxStep, s + 1);
        const newestNode = graph.nodes.find((n) => n.step === next);
        if (newestNode) {
          setJustRevealedId(newestNode.id);
        }
        return next;
      });
    }, interval);
    return () => clearTimeout(timer);
  }, [playing, step, maxStep, replaySpeed, graph.nodes]);

  // Clear pulse highlight after animation
  useEffect(() => {
    if (!justRevealedId) return;
    const timer = setTimeout(() => {
      setJustRevealedId(null);
    }, 600);
    return () => clearTimeout(timer);
  }, [justRevealedId]);

  // Fit Scale (H3: in Fit mode graph keeps its fitted height and scrolls horizontally)
  const fitScale = useMemo(() => {
    if (!isFit || !canvasScrollRef.current) return 1;
    const container = canvasScrollRef.current;
    const availableHeight = container.clientHeight - 32;
    const scaleY = availableHeight / layout.totalHeight;
    return Math.min(1, Math.max(0.3, scaleY));
  }, [isFit, layout.totalHeight]);

  // Step navigation helper (G3: Arrow keys & replay buttons follow and center node, highlight line)
  const stepTo = useCallback(
    (newStep: number) => {
      setPlaying(false);
      const clamped = Math.max(1, Math.min(maxStep, newStep));
      setStep(clamped);

      // Find the active revealed node at this step (or last remaining)
      const stepNodes = graph.nodes.filter((n) => n.step === clamped);
      const targetNode = stepNodes.at(-1) ?? graph.nodes.filter((n) => n.step <= clamped).at(-1);
      if (targetNode) {
        setJustRevealedId(targetNode.id);
        setSelectedId(targetNode.id);
        const scrollContainer = canvasScrollRef.current;
        const nodePos = layout.pos[targetNode.id];
        if (scrollContainer && nodePos) {
          const scale = isFit ? fitScale : 1;
          const targetLeft = Math.max(0, (nodePos.x + NODE_WIDTH / 2) * scale - scrollContainer.clientWidth / 2);
          const targetTop = isFit ? 0 : Math.max(0, (nodePos.y + NODE_HEIGHT / 2) * scale - scrollContainer.clientHeight / 2);
          if (typeof scrollContainer.scrollTo === 'function') {
            scrollContainer.scrollTo({
              left: targetLeft,
              top: targetTop,
              behavior: 'smooth',
            });
          } else {
            scrollContainer.scrollLeft = targetLeft;
            scrollContainer.scrollTop = targetTop;
          }
        }
      }
    },
    [maxStep, graph.nodes, layout.pos, isFit, fitScale],
  );

  // Keyboard navigation (G3: ← / → centres revealed node and highlights script line)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        setAutoFollow(false);
        if (e.key === 'ArrowRight') {
          stepTo(step + 1);
        } else if (e.key === 'ArrowLeft') {
          stepTo(step - 1);
        }
      } else if (e.key === 'Escape') {
        setSelectedId(null);
        setShowLegend(false);
      } else if (e.key === ' ' && e.target === document.body) {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [step, stepTo]);

  // Deselect if current node is hidden by step
  useEffect(() => {
    if (selectedId && !visibleNodeIds.has(selectedId)) {
      setSelectedId(null);
    }
  }, [step, selectedId, visibleNodeIds]);

  // Auto-scroll centering newest node when replaying or streaming (H3: follow keeps newest column in view in Fit mode too)
  useEffect(() => {
    if (!autoFollow) return;
    const scrollContainer = canvasScrollRef.current;
    if (!scrollContainer) return;

    const activeNodes = visibleNodes.filter((n) => n.step === step);
    const targetNode = activeNodes.at(-1) ?? visibleNodes.at(-1);
    if (!targetNode) return;

    const nodePos = layout.pos[targetNode.id];
    if (!nodePos) return;

    isAutoScrollingRef.current = true;
    const scale = isFit ? fitScale : 1;
    const targetLeft = Math.max(0, (nodePos.x + NODE_WIDTH / 2) * scale - scrollContainer.clientWidth / 2);
    const targetTop = isFit ? 0 : Math.max(0, (nodePos.y + NODE_HEIGHT / 2) - scrollContainer.clientHeight / 2);

    if (typeof scrollContainer.scrollTo === 'function') {
      scrollContainer.scrollTo({
        left: targetLeft,
        top: targetTop,
        behavior: 'smooth',
      });
    } else {
      scrollContainer.scrollLeft = targetLeft;
      scrollContainer.scrollTop = targetTop;
    }

    const timeout = setTimeout(() => {
      isAutoScrollingRef.current = false;
    }, 400);
    return () => clearTimeout(timeout);
  }, [step, autoFollow, isFit, fitScale, visibleNodes, layout.pos]);

  // User manual input listeners for autoFollow cancellation
  const handleCanvasWheel = () => {
    if (autoFollow) setAutoFollow(false);
  };

  const handleCanvasPointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (
      target === canvasScrollRef.current ||
      target.classList.contains('canvas') ||
      target.classList.contains('lane-track') ||
      target.classList.contains('wires') ||
      target.tagName === 'svg'
    ) {
      if (autoFollow) setAutoFollow(false);
    }
  };

  const handleCanvasTouchMove = () => {
    if (autoFollow) setAutoFollow(false);
  };

  // H6: Select node and center canvas
  const selectNode = useCallback(
    (id: string) => {
      setSelectedId(id);
      const node = graph.nodes.find((n) => n.id === id);
      if (node) {
        if (node.step > step) {
          setStep(node.step);
        }
        // Expand the round if it was collapsed
        if (node.round && collapsedRounds.has(node.round)) {
          setCollapsedRounds((prev) => {
            const next = new Set(prev);
            next.delete(node.round!);
            return next;
          });
        }
        const scrollContainer = canvasScrollRef.current;
        const nodePos = layout.pos[id];
        if (scrollContainer && nodePos) {
          const scale = isFit ? fitScale : 1;
          const targetLeft = Math.max(0, (nodePos.x + NODE_WIDTH / 2) * scale - scrollContainer.clientWidth / 2);
          const targetTop = isFit ? 0 : Math.max(0, (nodePos.y + NODE_HEIGHT / 2) * scale - scrollContainer.clientHeight / 2);
          if (typeof scrollContainer.scrollTo === 'function') {
            scrollContainer.scrollTo({
              left: targetLeft,
              top: targetTop,
              behavior: 'smooth',
            });
          } else {
            scrollContainer.scrollLeft = targetLeft;
            scrollContainer.scrollTop = targetTop;
          }
        }
      }
    },
    [graph.nodes, step, layout.pos, isFit, fitScale, collapsedRounds],
  );

  // G3: Active revealed node during replay & streaming & manual stepping
  const activeRevealedNode = useMemo(() => {
    if (justRevealedId) {
      return graph.nodes.find((n) => n.id === justRevealedId);
    }
    const nodesAtStep = visibleNodes.filter((n) => n.step === step);
    return nodesAtStep.at(-1) ?? visibleNodes.at(-1) ?? null;
  }, [justRevealedId, graph.nodes, visibleNodes, step]);

  // H6: Auto-scroll revealed line in script pane during replay/live runs
  useEffect(() => {
    const targetLine = activeRevealedNode?.line ?? detail?.node?.line;
    const targetRound = activeRevealedNode?.round ?? detail?.node?.round ?? 1;
    if (!targetLine) return;
    const container = scriptContainerRef.current;
    if (!container) return;
    const lineEl = container.querySelector(
      `[data-round="${targetRound}"][data-line="${targetLine}"]`,
    ) as HTMLElement;
    if (lineEl && typeof lineEl.scrollIntoView === 'function') {
      lineEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [activeRevealedNode?.line, activeRevealedNode?.round, detail?.node?.line, detail?.node?.round]);

  // Focus Mode & Collapsed Side Panes
  const isFocusActive = focusMode && (playing || isStreaming);
  const isLeftCollapsed = isFocusActive || leftCollapsed;
  const isRightCollapsed = isFocusActive || rightCollapsed;

  // Placeholder for waiting on Gemini
  const waitingRound = (rawEvents.filter((e) => e.type === 'model_turn').length || 0) + 1;
  const isWaitingForGemini = isStreaming && liveQueueRef.current.length === 0;

  // H5: Drag handle resize listener
  const handleResizerPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const onPointerMove = (ev: PointerEvent) => {
      const minWidth = 220;
      const maxWidth = Math.max(220, Math.floor(window.innerWidth * 0.5));
      const newWidth = Math.min(maxWidth, Math.max(minWidth, ev.clientX));
      setLeftPaneWidth(newWidth);
    };
    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const SPEED_OPTIONS: Array<0.25 | 0.5 | 1 | 2> = [0.25, 0.5, 1, 2];

  return (
    <div className="app">
      {/* Top Header */}
      <header>
        <div className="brand">
          <span className="brand-icon">◈</span> Sight<span>Line</span>
          <small>/ STRACE FOR CODE MODE</small>
        </div>
        {/* G6: Run Picker with Honest Labels */}
        <div className="seg">
          <button
            className={source === 'recorded' && recordedKey === 'fake' ? 'active' : ''}
            onClick={() => {
              setSource('recorded');
              setRecordedKey('fake');
              setSelectedId(null);
            }}
          >
            Simulated: injection succeeds
          </button>
          <button
            className={source === 'recorded' && recordedKey === 'runA' ? 'active' : ''}
            onClick={() => {
              setSource('recorded');
              setRecordedKey('runA');
              setSelectedId(null);
            }}
          >
            Recorded live: A (triage + HR)
          </button>
          <button
            className={source === 'recorded' && recordedKey === 'runB' ? 'active' : ''}
            onClick={() => {
              setSource('recorded');
              setRecordedKey('runB');
              setSelectedId(null);
            }}
          >
            Recorded live: B (honest mistake)
          </button>
        </div>

        <div className="seg">
          <button
            className={source === 'live' && liveTask === 'A' ? 'active' : ''}
            onClick={() => startLiveRun('A')}
          >
            Live A
          </button>
          <button
            className={source === 'live' && liveTask === 'B' ? 'active' : ''}
            onClick={() => startLiveRun('B')}
          >
            Live B
          </button>
        </div>

        <button
          className="run-btn"
          onClick={() => {
            if (source === 'live') {
              startLiveRun(liveTask);
            } else {
              setSelectedId(null);
              setStep(1);
              setPlaying(true);
              setAutoFollow(true);
            }
          }}
        >
          ▶ <span>{source === 'live' ? (isStreaming ? 'Streaming...' : `Run live ${liveTask}`) : 'Run replay'}</span>
        </button>

        <div className="seg">
          <button
            className={display === 'graph' ? 'active' : ''}
            onClick={() => setDisplay('graph')}
          >
            Graph
          </button>
          <button
            className={display === 'strace' ? 'active' : ''}
            onClick={() => setDisplay('strace')}
          >
            strace
          </button>
        </div>
      </header>

      {/* G6: Honest Banner for Simulated Run */}
      {source === 'recorded' && recordedKey === 'fake' && (
        <div className="simulated-banner">
          <span className="simulated-banner-icon">⚠️</span>
          <span>Simulated run: shows what happens if the hidden instruction in issue #42 works. Recorded live runs: A and B.</span>
        </div>
      )}

      {/* Toolbar */}
      <div className="toolbar">
        <div className="status">
          <i style={{ background: source === 'live' ? (isStreaming ? '#5bd38a' : '#6ca8ff') : undefined }} />
          <b>
            {source === 'live'
              ? isStreaming
                ? `Live streaming (${liveTask})`
                : `Live run (${liveTask})`
              : presetRuns[recordedKey]?.label ?? 'Recorded run'}
          </b>
          <span>·</span> {graph.summary?.rounds ?? (rawEvents.filter((e) => e.type === 'model_turn').length || 1)} rounds <span>·</span>{' '}
          {fmt(rawEvents.at(-1)?.t ?? 0)} ms
          {errorMessage && <span style={{ color: '#ff5c5c', marginLeft: 8 }}>· {errorMessage}</span>}
        </div>

        <div className="toolbar-right">
          {/* Focus Toggle */}
          <button
            className={`tool-toggle ${focusMode ? 'active' : ''}`}
            onClick={() => setFocusMode((f) => !f)}
            title="Auto-collapse side panes during playback"
          >
            {focusMode ? '✓ Focus on' : 'Focus'}
          </button>

          {/* Show every step toggle */}
          <button
            className={`tool-toggle ${userShowEveryStep ? 'active' : ''}`}
            onClick={() => setUserShowEveryStep((s) => !s)}
            title="Toggle showing intermediate values"
          >
            {userShowEveryStep ? '✓ Showing intermediate values' : 'Show every step'}
          </button>

          {/* Fit button (H3: zoom height to fit view while scrolling horizontally) */}
          <button
            className={`tool-toggle ${isFit ? 'active' : ''}`}
            onClick={() => setIsFit((f) => !f)}
            title="Zoom graph to fit view"
          >
            {isFit ? '100%' : 'Fit'}
          </button>

          {/* Follow button */}
          {!autoFollow && (
            <button
              className="tool-toggle pulse"
              onClick={() => setAutoFollow(true)}
              title="Resume following newest node during playback"
            >
              Follow
            </button>
          )}

          {/* Legend Popover */}
          <div className="legend-wrapper">
            <button
              className={`tool-toggle ${showLegend ? 'active' : ''}`}
              onClick={() => setShowLegend((l) => !l)}
            >
              Legend ▾
            </button>
            {showLegend && (
              <div className="legend-popover">
                <div className="legend-section">
                  <strong>EDGES</strong>
                  <div className="legend-grid">
                    <span className="legend-item"><i style={{ background: '#8fa3bf' }} /> Model writes code</span>
                    <span className="legend-item"><i style={{ background: '#6ca8ff' }} /> Code calls tool</span>
                    <span className="legend-item"><i style={{ background: '#8fa3bf' }} /> Public data</span>
                    <span className="legend-item"><i style={{ background: '#ffb454' }} /> Private data</span>
                    <span className="legend-item dashed"><i style={{ borderColor: '#ff7ab6' }} /> Untrusted taint</span>
                    <span className="legend-item dashed"><i style={{ borderColor: '#ff5c5c' }} /> Blocked</span>
                  </div>
                </div>
                <div className="legend-section">
                  <strong>STATUS CHIPS</strong>
                  <div className="legend-grid">
                    <span className="legend-item"><span className="chip-demo chip-private">PRIVATE</span> Amber</span>
                    <span className="legend-item"><span className="chip-demo chip-public">PUBLIC</span> Slate</span>
                    <span className="legend-item"><span className="chip-demo chip-untrusted">UNTRUSTED</span> Pink</span>
                    <span className="legend-item"><span className="chip-demo chip-sent">SENT</span> Blue</span>
                    <span className="legend-item"><span className="chip-demo chip-blocked">BLOCKED</span> Red</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Body */}
      <main
        style={{
          gridTemplateColumns: `${isLeftCollapsed ? '28px' : `${leftPaneWidth}px`} 1fr ${
            isRightCollapsed ? '28px' : 'var(--drawer-width)'
          }`,
        }}
      >
        {/* Left Script Pane (H5: code wraps with hanging indent; draggable resize handle; Round headers) */}
        {isLeftCollapsed ? (
          <aside className="script-pane collapsed-rail" title="Expand Script Pane">
            <button
              className="rail-toggle-btn"
              onClick={() => {
                if (isFocusActive) setFocusMode(false);
                setLeftCollapsed(false);
              }}
              aria-label="Expand Script Pane"
            >
              ›
            </button>
            <span className="rail-label">SCRIPT</span>
          </aside>
        ) : (
          <aside className="script-pane" ref={scriptContainerRef as any}>
            <div className="pane-head">
              <div className="pane-head-left">
                <span className="eyebrow">GENERATED CODE</span>
                <h2>Script</h2>
              </div>
              <div className="pane-head-actions">
                <span className="badge">TS</span>
                <button
                  className="pane-header-toggle-btn"
                  onClick={() => setLeftCollapsed(true)}
                  aria-label="Collapse Script Pane"
                  title="Collapse Script Pane"
                >
                  ‹
                </button>
              </div>
            </div>
            <p className="pane-note">Written by Gemini. Runs in sandbox with MCP wrapper.</p>

            <div className="script-scroll-area">
              {rawEvents
                .filter((e) => e.type === 'model_turn')
                .map((m) => (
                  <section className="round" key={m.id}>
                    <div className="round-title">
                      <span>Round {m.round}</span>
                      <span>MODEL TURN</span>
                    </div>
                    {m.script?.map((l: { n: number; code: string }) => {
                      const lineNodes = getNodesForLine(graph.nodes, m.round ?? 1, l.n);
                      const hasNodes = lineNodes.length > 0;
                      const isSelected = lineNodes.some((n) => n.id === selectedId);
                      const isRevealed =
                        activeRevealedNode?.line === l.n &&
                        (activeRevealedNode?.round ?? 1) === (m.round ?? 1);

                      return (
                        <button
                          key={l.n}
                          data-round={m.round}
                          data-line={l.n}
                          className={`code-line ${isSelected ? 'selected' : ''} ${
                            isRevealed ? 'revealed' : ''
                          } ${!hasNodes ? 'no-node' : ''}`}
                          onClick={() => {
                            if (!hasNodes) return;
                            const curIdx = lineNodes.findIndex((n) => n.id === selectedId);
                            const targetNode =
                              curIdx >= 0 ? lineNodes[(curIdx + 1) % lineNodes.length] : lineNodes[0];
                            selectNode(targetNode.id);
                          }}
                          title={`Line ${l.n}`}
                        >
                          <span className="line-num">{String(l.n).padStart(2, '0')}</span>
                          <code>{l.code}</code>
                        </button>
                      );
                    })}
                  </section>
                ))}
            </div>

            {/* H5: Draggable Resize Handle */}
            <div
              className="pane-resizer pane-resizer-left"
              onPointerDown={handleResizerPointerDown}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize script pane"
              title="Drag to resize script pane"
            />
          </aside>
        )}

        {/* Center Stage */}
        <section className="stage">
          {/* Prompt Banner above canvas */}
          <div className="prompt-banner">
            <span className="prompt-banner-label">You asked:</span>
            <span className="prompt-banner-text">{promptText}</span>
          </div>

          <div className="stage-heading">
            <div>
              <span className="eyebrow">EXECUTION TRACE</span>
              <h1>{display === 'graph' ? 'Data Flow Graph' : 'Event log'}</h1>
              <p>
                {selectedId
                  ? 'Tracing value lineage. Click any connected chip to jump upstream or downstream.'
                  : 'Click any node to trace its data lineage and see where values came from.'}
              </p>
            </div>
            <div className="stage-meta">
              <span>TIME →</span>
              <b>
                STEP {step} / {maxStep}
              </b>
            </div>
          </div>

          {display === 'graph' ? (
            <div
              className="canvas-scroll"
              ref={canvasScrollRef}
              onWheel={handleCanvasWheel}
              onPointerDown={handleCanvasPointerDown}
              onTouchMove={handleCanvasTouchMove}
            >
              <div
                className="canvas"
                style={{
                  width: layout.totalWidth,
                  height: layout.totalHeight,
                  transform: isFit ? `scale(${fitScale})` : undefined,
                  transformOrigin: 'top left',
                }}
              >
                {/* Round Headers & Vertical Dividers (G1a: Clickable round headers that collapse/expand) */}
                {layout.roundInfoList.map((r) => (
                  <div
                    key={`round-${r.round}`}
                    className={`round-divider ${r.collapsed ? 'collapsed' : 'expanded'}`}
                    style={{ left: r.startX }}
                  >
                    <button
                      className="round-tag-btn"
                      onClick={() => toggleRound(r.round)}
                      title={r.collapsed ? 'Click to expand round' : 'Click to collapse round'}
                      aria-label={r.collapsed ? `Expand Round ${r.round}` : `Collapse Round ${r.round}`}
                    >
                      <span className="round-tag">
                        {r.collapsed ? r.summary.label : `Round ${r.round}`} {r.collapsed ? '▸' : '▾'}
                      </span>
                    </button>
                  </div>
                ))}

                {/* Lane Tracks */}
                {graph.lanes.map((lane) => {
                  const laneTop = layout.laneTopMap[lane] ?? 24;
                  const laneHeight = layout.laneHeightMap[lane] ?? 130;
                  const laneSub = LANE_SUBTITLES[lane] ?? 'MCP server';

                  return (
                    <div
                      key={lane}
                      className={`lane-track ${
                        lane === 'MODEL' ? 'model-lane' : lane === 'SCRIPT' ? 'script-lane' : ''
                      }`}
                      style={{ top: laneTop, height: laneHeight }}
                    >
                      <div className="lane-header">
                        <b>{lane.toUpperCase()}</b>
                        <span className="lane-desc" title={laneSub}>
                          {laneSub}
                        </span>
                        {lane === 'MODEL' && (
                          <span className="token-pill">{fmt(graph.summary?.model_tokens ?? 0)} tok context</span>
                        )}
                        {lane === 'SCRIPT' && (
                          <span className="token-pill sandbox-pill">{fmt(graph.summary?.sandbox_tokens ?? 0)} sandbox tok</span>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* SVG Orthogonal Connecting Wires (H2: 45% opacity default, hovered at full opacity) */}
                <svg
                  className="wires"
                  width={layout.totalWidth}
                  height={layout.totalHeight}
                  aria-hidden="true"
                >
                  <defs>
                    <marker
                      id="arrow-write"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M0 1 L9 5 L0 9 z" fill="#8fa3bf" />
                    </marker>
                    <marker
                      id="arrow-call"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M0 1 L9 5 L0 9 z" fill="#6ca8ff" />
                    </marker>
                    <marker
                      id="arrow-public"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M0 1 L9 5 L0 9 z" fill="#8fa3bf" />
                    </marker>
                    <marker
                      id="arrow-private"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M0 1 L9 5 L0 9 z" fill="#ffb454" />
                    </marker>
                    <marker
                      id="arrow-taint"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M0 1 L9 5 L0 9 z" fill="#ff7ab6" />
                    </marker>
                    <marker
                      id="arrow-blocked"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M0 1 L9 5 L0 9 z" fill="#ff5c5c" />
                    </marker>
                  </defs>

                  {graph.edges
                    .filter((e) => visibleNodeIds.has(e.from) && visibleNodeIds.has(e.to))
                    .map((e, index) => {
                      const isHovered =
                        selectedId === null &&
                        hoveredNodeId !== null &&
                        (e.from === hoveredNodeId || e.to === hoveredNodeId);
                      const isLit =
                        detail !== null &&
                        detail.edges.some(
                          (x) => x.from === e.from && x.to === e.to && x.kind === e.kind,
                        );
                      const isFaded = detail !== null && !isLit;
                      const pathD = layout.edgePaths[`${e.from}-${e.to}-${e.kind}`];
                      if (!pathD) return null;

                      const tooltipText = e.via ? `${e.label} · ${e.via}` : e.label;

                      return (
                        <g
                          key={`${e.from}-${e.to}-${index}`}
                          className={`wire ${e.kind} ${isFaded ? 'faded' : ''} ${isLit ? 'lit' : ''} ${
                            isHovered ? 'hovered' : ''
                          }`}
                        >
                          <path d={pathD} markerEnd={`url(#arrow-${e.kind})`} />
                          <title>{tooltipText}</title>
                        </g>
                      );
                    })}
                </svg>

                {/* Visible Node Cards & Collapsed Round Summaries */}
                <div className="node-layer">
                  {/* G1a: Collapsed Round Summary Columns */}
                  {layout.roundInfoList
                    .filter((r) => r.collapsed)
                    .map((r) => (
                      <button
                        key={`collapsed-round-col-${r.round}`}
                        className="collapsed-round-col"
                        style={{
                          left: r.startX,
                          top: 24,
                          width: r.width - 20,
                          height: layout.totalHeight - 64,
                        }}
                        onClick={() => toggleRound(r.round)}
                        title={`${r.summary.label} (Click to expand)`}
                        aria-label={`Round ${r.round} collapsed. Click to expand.`}
                      >
                        <div className="collapsed-round-badge">Round {r.round}</div>
                        <div className="collapsed-round-summary-text">{r.summary.label}</div>
                        <span className="collapsed-round-click-hint">Click to expand</span>
                      </button>
                    ))}

                  {/* Uncollapsed Nodes */}
                  {visibleNodes
                    .filter((n) => !collapsedRounds.has(n.round ?? 1))
                    .map((n) => {
                      const pos = layout.pos[n.id];
                      if (!pos) return null;

                      const isSelected = selectedId === n.id;
                      const isDim = detail !== null && !detail.lit.has(n.id);
                      const isJustRevealed = justRevealedId === n.id;

                      return (
                        <button
                          key={n.id}
                          style={{ left: pos.x, top: pos.y, width: NODE_WIDTH, minHeight: NODE_HEIGHT }}
                          className={`node-card kind-${n.kind} chip-${n.chip.toLowerCase()} ${
                            isSelected ? 'selected' : ''
                          } ${isDim ? 'dim' : ''} ${isJustRevealed ? 'just-revealed' : ''}`}
                          onClick={() => selectNode(n.id)}
                          onMouseEnter={() => setHoveredNodeId(n.id)}
                          onMouseLeave={() => setHoveredNodeId(null)}
                          title={`Step ${n.step}: ${n.title}`}
                        >
                          <div className="node-card-top">
                            <span className={`status-chip chip-${n.chip.toLowerCase()}`}>
                              {n.chip}
                            </span>
                            {n.repeatCount && n.repeatCount > 1 && (
                              <span className="repeat-badge">×{n.repeatCount}</span>
                            )}
                          </div>
                          <strong className="node-title">{n.title}</strong>

                          {/* Tool call monospace signature */}
                          {n.callSignature && (
                            <code className="node-call-sig">{n.callSignature}</code>
                          )}

                          {/* Blocked reason line */}
                          {n.blockedReason && (
                            <span className="node-blocked-reason">{n.blockedReason}</span>
                          )}

                          {/* G4: Untrusted reason on UNTRUSTED nodes - wraps in full without truncation */}
                          {n.chip === 'UNTRUSTED' && n.untrustedReason && (
                            <span className="node-untrusted-reason">{n.untrustedReason}</span>
                          )}

                          {/* Subtitle if neither call signature nor untrusted reason replaces it */}
                          {!n.callSignature && (!n.untrustedReason || n.chip !== 'UNTRUSTED') && (
                            <span className="node-sub">{n.subtitle}</span>
                          )}
                        </button>
                      );
                    })}

                  {/* Pulsing Placeholder while waiting for Gemini */}
                  {isWaitingForGemini && (
                    <div
                      className="node-card kind-model_turn placeholder-writing"
                      style={{
                        left: LEFT_OFFSET + layout.maxCol * COLUMN_WIDTH,
                        top: (layout.laneTopMap['MODEL'] ?? 24) + 44,
                        width: NODE_WIDTH,
                        minHeight: NODE_HEIGHT,
                      }}
                    >
                      <div className="node-card-top">
                        <span className="status-chip chip-sent">WRITING</span>
                      </div>
                      <strong className="node-title">Gemini is writing code… (round {waitingRound})</strong>
                      <span className="node-sub">Generating TypeScript in sandbox...</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Strace Log View */
            <div className="strace-log">
              {visibleNodes.map((n) => {
                const isSelected = selectedId === n.id;
                return (
                  <div
                    key={n.id}
                    className={`strace-row ${isSelected ? 'selected' : ''}`}
                    onClick={() => selectNode(n.id)}
                  >
                    <span className="strace-time">
                      {n.event.t !== undefined ? `${n.event.t}ms` : `s${n.step}`}
                    </span>
                    <span className={`strace-type status-chip chip-${n.chip.toLowerCase()}`}>
                      {n.chip}
                    </span>
                    <span className="strace-title">{n.title}</span>
                    <span className="strace-sub">{n.callSignature || n.subtitle}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* G1b: Minimap in reserved bottom-right corner */}
          {display === 'graph' && (
            <Minimap
              nodes={graph.nodes}
              visibleNodes={visibleNodes}
              layout={layout}
              scrollContainerRef={canvasScrollRef}
              isFit={isFit}
            />
          )}

          {/* Replay Bar (G2: 0.25x / 0.5x / 1x / 2x speed button; G3: arrow buttons follow) */}
          <div className="replay">
            <button
              className="replay-btn"
              aria-label="Previous step"
              onClick={() => stepTo(step - 1)}
            >
              ←
            </button>
            <button
              className="replay-btn"
              aria-label={playing ? 'Pause replay' : 'Play replay'}
              onClick={() => {
                if (step === maxStep) setStep(1);
                setPlaying(!playing);
              }}
            >
              {playing ? 'Ⅱ' : '▶'}
            </button>
            <button
              className="replay-btn"
              aria-label="Next step"
              onClick={() => stepTo(step + 1)}
            >
              →
            </button>

            {/* Replay Speed Toggle (G2: 0.25x / 0.5x / 1x / 2x) */}
            <button
              className="speed-btn"
              onClick={() => {
                const curIdx = SPEED_OPTIONS.indexOf(replaySpeed);
                const nextSpeed = SPEED_OPTIONS[(curIdx + 1) % SPEED_OPTIONS.length];
                setReplaySpeed(nextSpeed);
              }}
              title="Toggle playback speed"
            >
              {replaySpeed}x
            </button>

            <div className="ticks">
              {graph.steps.map((s) => (
                <button
                  key={s}
                  aria-label={`Go to step ${s}`}
                  title={`Step ${s}`}
                  className={`tick ${s <= step ? 'passed' : ''} ${s === step ? 'current' : ''}`}
                  onClick={() => stepTo(s)}
                />
              ))}
            </div>

            <div className="step-label">
              STEP <b>{String(step).padStart(2, '0')}</b> / {String(maxStep).padStart(2, '0')}
            </div>
          </div>
        </section>

        {/* Right Drawer: Story OR Detail */}
        {isRightCollapsed ? (
          <aside className="drawer collapsed-rail" title="Expand Details Pane">
            <button
              className="rail-toggle-btn"
              onClick={() => {
                if (isFocusActive) setFocusMode(false);
                setRightCollapsed(false);
              }}
              aria-label="Expand Details Pane"
            >
              ‹
            </button>
            <span className="rail-label">{detail?.node ? 'DETAIL' : 'STORY'}</span>
          </aside>
        ) : detail?.node ? (
          <DetailDrawer
            node={detail.node}
            inspection={detail}
            graph={graph}
            step={step}
            runEvents={rawEvents}
            onPick={selectNode}
            onClose={() => setSelectedId(null)}
            onCollapse={() => setRightCollapsed(true)}
          />
        ) : (
          <StoryDrawer
            story={runStory}
            onPick={selectNode}
            onCollapse={() => setRightCollapsed(true)}
          />
        )}
      </main>

      {/* Footer */}
      <footer>
        <span>
          <i /> RUN COMPLETE
        </span>
        <span>
          MODEL CONTEXT <b>{fmt(graph.summary?.model_tokens ?? 0)} tokens</b>
        </span>
        <span>
          SANDBOX ONLY <b>{fmt(graph.summary?.sandbox_tokens ?? 0)} tokens</b>
        </span>
        <span className="footer-end">
          SightLine · Value lineage for Code Mode · Click node to trace · ← → to step
        </span>
      </footer>
    </div>
  );
}

// G1b: Minimap in canvas bottom-right corner (180x60, semi-transparent, click/drag to scroll)
function Minimap({
  visibleNodes,
  layout,
  scrollContainerRef,
}: {
  nodes: Node[];
  visibleNodes: Node[];
  layout: ReturnType<typeof computeLayout>;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  isFit: boolean;
}) {
  const [viewport, setViewport] = useState({ left: 0, top: 0, width: 30, height: 20 });
  const minimapWidth = 180;
  const minimapHeight = 60;

  const updateViewport = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el || layout.totalWidth <= 0 || layout.totalHeight <= 0) return;
    const vLeft = (el.scrollLeft / layout.totalWidth) * minimapWidth;
    const vTop = (el.scrollTop / layout.totalHeight) * minimapHeight;
    const vWidth = Math.max(16, (el.clientWidth / layout.totalWidth) * minimapWidth);
    const vHeight = Math.max(12, (el.clientHeight / layout.totalHeight) * minimapHeight);
    setViewport({
      left: Math.max(0, Math.min(minimapWidth - vWidth, vLeft)),
      top: Math.max(0, Math.min(minimapHeight - vHeight, vTop)),
      width: Math.min(minimapWidth, vWidth),
      height: Math.min(minimapHeight, vHeight),
    });
  }, [layout.totalWidth, layout.totalHeight, scrollContainerRef]);

  useEffect(() => {
    updateViewport();
    const el = scrollContainerRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateViewport);
    window.addEventListener('resize', updateViewport);
    return () => {
      el.removeEventListener('scroll', updateViewport);
      window.removeEventListener('resize', updateViewport);
    };
  }, [updateViewport, scrollContainerRef]);

  const scrollToMinimapPos = (clientX: number, clientY: number, target: HTMLDivElement) => {
    const rect = target.getBoundingClientRect();
    const clickX = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const clickY = Math.max(0, Math.min(rect.height, clientY - rect.top));
    const ratioX = clickX / rect.width;
    const ratioY = clickY / rect.height;

    const el = scrollContainerRef.current;
    if (!el) return;
    const targetLeft = ratioX * layout.totalWidth - el.clientWidth / 2;
    const targetTop = ratioY * layout.totalHeight - el.clientHeight / 2;
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ left: Math.max(0, targetLeft), top: Math.max(0, targetTop), behavior: 'auto' });
    } else {
      el.scrollLeft = Math.max(0, targetLeft);
      el.scrollTop = Math.max(0, targetTop);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    scrollToMinimapPos(e.clientX, e.clientY, target);

    const onPointerMove = (ev: PointerEvent) => {
      scrollToMinimapPos(ev.clientX, ev.clientY, target);
    };
    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const scaleX = minimapWidth / Math.max(1, layout.totalWidth);
  const scaleY = minimapHeight / Math.max(1, layout.totalHeight);

  return (
    <div
      className="minimap"
      onPointerDown={handlePointerDown}
      title="Graph Minimap: click or drag to scroll"
      aria-label="Graph minimap"
    >
      <svg width={minimapWidth} height={minimapHeight} className="minimap-svg">
        {/* Render small node dots */}
        {visibleNodes.map((n) => {
          const p = layout.pos[n.id];
          if (!p) return null;
          const x = p.x * scaleX;
          const y = p.y * scaleY;
          const w = Math.max(4, NODE_WIDTH * scaleX);
          const h = Math.max(3, NODE_HEIGHT * scaleY);
          let fill = '#8fa3bf';
          if (n.chip === 'PRIVATE') fill = '#ffb454';
          else if (n.chip === 'UNTRUSTED') fill = '#ff7ab6';
          else if (n.chip === 'BLOCKED') fill = '#ff5c5c';
          else if (n.chip === 'SENT') fill = '#6ca8ff';

          return (
            <rect
              key={n.id}
              x={x}
              y={y}
              width={w}
              height={h}
              rx={1}
              fill={fill}
              opacity={0.8}
            />
          );
        })}
      </svg>
      {/* Viewport rectangle */}
      <div
        className="minimap-viewport"
        style={{
          left: viewport.left,
          top: viewport.top,
          width: viewport.width,
          height: viewport.height,
        }}
      />
    </div>
  );
}

// Script Code Block with Line Numbers & Truncation
function ScriptCodeBlock({ script }: { script: Array<{ n: number; code: string }> }) {
  const [showAll, setShowAll] = useState<boolean>(false);
  const isLong = script.length > 12;
  const visible = isLong && !showAll ? script.slice(0, 12) : script;

  return (
    <div className="script-code-block-container">
      <div className="code-block-with-gutter">
        {visible.map((l) => (
          <div key={l.n} className="gutter-code-line">
            <span className="gutter-line-num">{String(l.n).padStart(2, '0')}</span>
            <span className="gutter-code-text">{l.code}</span>
          </div>
        ))}
      </div>
      {isLong && (
        <button
          className="btn-show-more-code"
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? 'Show fewer lines' : `Show all ${script.length} lines (${script.length - 12} hidden)`}
        </button>
      )}
    </div>
  );
}

// STORY Drawer when nothing is selected
function StoryDrawer({
  story,
  onPick,
  onCollapse,
}: {
  story: ReturnType<typeof import('./view').story>;
  onPick: (id: string) => void;
  onCollapse: () => void;
}) {
  return (
    <aside className="drawer story-drawer">
      <div className="drawer-top">
        <div className="drawer-head-left">
          <span className="eyebrow">RUN SUMMARY</span>
          <h2>Execution Story</h2>
        </div>
        <div className="drawer-head-actions">
          <button
            className="pane-header-toggle-btn"
            onClick={onCollapse}
            aria-label="Collapse Story Pane"
            title="Collapse Story Pane"
          >
            ›
          </button>
        </div>
      </div>

      <div className="story-headline-box">
        <span className="story-headline-icon">🛡️</span>
        <strong className="story-headline-text">{story.headline}</strong>
      </div>

      <div className="story-context-boundary">
        <span className="story-context-label">CONTEXT BOUNDARY</span>
        <p>{story.contextBoundary}</p>
      </div>

      <div className="story-narrative">
        <span className="story-narrative-label">STEP-BY-STEP NARRATIVE</span>
        <ol className="story-list">
          {story.sentences.map((sent, idx) => (
            <li
              key={idx}
              className={`story-item ${sent.id ? 'clickable' : ''}`}
              onClick={() => sent.id && onPick(sent.id)}
            >
              <span>{sent.text}</span>
              {sent.id && <span className="story-jump-chip">Inspect node →</span>}
            </li>
          ))}
        </ol>
      </div>
    </aside>
  );
}

// G5: Argument Card with full value, >8 lines toggle, and plain words comes-from chips
function ArgumentCard({
  argName,
  argData,
  sources,
  rpcArg,
  onPick,
}: {
  argName: string;
  argData?: { preview: string; from?: string[] };
  sources: Node[];
  rpcArg?: any;
  onPick: (id: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);

  // Determine full value text: prefer raw rpc parameter value if available
  let val = rpcArg;
  if (val === undefined && argData?.preview) {
    val = argData.preview;
    if (typeof val === 'string' && val.startsWith('"') && val.endsWith('"') && val.length > 1) {
      try {
        val = JSON.parse(val);
      } catch {
        val = val.slice(1, -1);
      }
    }
  }

  const isComplex = typeof val === 'object' && val !== null;
  const formattedVal = isComplex ? JSON.stringify(val, null, 2) : String(val ?? '');
  const lines = formattedVal.split('\n');
  const isLong = lines.length > 8;
  const displayedVal = isLong && !showAll ? lines.slice(0, 8).join('\n') : formattedVal;

  return (
    <div className="arg-card">
      <div className="arg-label">{argName}</div>
      <div className="arg-val-wrapper">
        {isComplex || isLong ? (
          <pre className="arg-code-block">
            <code>{displayedVal}</code>
          </pre>
        ) : (
          <div className="arg-string-val">{displayedVal}</div>
        )}
        {isLong && (
          <button
            className="btn-show-all-arg"
            onClick={() => setShowAll(!showAll)}
          >
            {showAll ? 'Show fewer lines' : `Show all (${lines.length} lines)`}
          </button>
        )}
      </div>

      <div className="arg-comes-from-section">
        <span className="arg-comes-from-label">comes from:</span>
        {sources.length === 0 ? (
          <span className="source-none">literal in script</span>
        ) : (
          <div className="arg-sources-chips">
            {sources.map((src) => {
              const chipLabel = src.line
                ? `${src.title.replace(/ · line \d+$/, '')} · line ${src.line} · ${src.chip}`
                : `${src.title} · ${src.chip}`;
              return (
                <button
                  key={src.id}
                  className={`source-chip chip-${src.chip.toLowerCase()}`}
                  onClick={() => onPick(src.id)}
                  title={`Inspect ${chipLabel}`}
                >
                  {chipLabel}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// G5: Lineage Vertical Chain View
function LineageChainView({
  graph,
  node,
  step,
  onPick,
}: {
  graph: ReturnType<typeof view>;
  node: Node;
  step: number;
  onPick: (id: string) => void;
}) {
  const chains = useMemo(() => {
    return buildLineageChains(graph, node.id, step);
  }, [graph, node.id, step]);

  if (chains.length === 0) {
    return <p className="dim-text">No upstream lineage for this node.</p>;
  }

  return (
    <div className="lineage-chains-list">
      {chains.map((chain, cIdx) => (
        <div key={cIdx} className="lineage-vertical-chain">
          {chain.map((stepItem, sIdx) => {
            const isTarget = stepItem.isTarget;
            const isLiteral = stepItem.id === 'literal';
            return (
              <React.Fragment key={`${stepItem.id}-${sIdx}`}>
                <div
                  className={`lineage-chain-step ${isTarget ? 'is-target' : ''} ${
                    isLiteral ? 'is-literal' : 'is-clickable'
                  } ${stepItem.chip ? `chip-${stepItem.chip.toLowerCase()}` : ''}`}
                  onClick={() => {
                    if (!isTarget && !isLiteral && stepItem.id) {
                      onPick(stepItem.id);
                    }
                  }}
                  title={isLiteral ? undefined : `Inspect ${stepItem.label}`}
                >
                  <span className="step-label-text">{stepItem.label}</span>
                  {stepItem.chip && !isTarget && !isLiteral && (
                    <span className={`status-chip mini chip-${stepItem.chip.toLowerCase()}`}>
                      {stepItem.chip}
                    </span>
                  )}
                </div>
                {sIdx < chain.length - 1 && <div className="lineage-down-arrow">↓</div>}
              </React.Fragment>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// G5: Policy Section with One Coloured Line & Full Reason
function PolicySection({ node }: { node: Node }) {
  if (node.kind === 'blocked') {
    const reasonText =
      node.event.reason ||
      node.blockedReason ||
      'Private payroll data would have reached the public tracker.';
    return (
      <div className="policy-decision-box blocked">
        <div className="policy-line-header blocked">
          <span className="policy-dot">●</span> Blocked: private → public
        </div>
        <p className="policy-reason-full">{reasonText}</p>
      </div>
    );
  }

  if (node.kind === 'call') {
    return (
      <div className="policy-decision-box allowed">
        <div className="policy-line-header allowed">
          <span className="policy-dot">●</span> Allowed
        </div>
        <p className="policy-reason-full">
          {node.event.reason || 'All arguments cleared safety policy. Sent to external MCP server.'}
        </p>
      </div>
    );
  }

  // Value node or prompt
  const sensClass = node.chip === 'PRIVATE' ? 'private' : node.chip === 'UNTRUSTED' ? 'untrusted' : 'allowed';
  const label = node.chip === 'PRIVATE' ? 'Private' : node.chip === 'UNTRUSTED' ? 'Untrusted' : 'Allowed';
  return (
    <div className={`policy-decision-box ${sensClass}`}>
      <div className={`policy-line-header ${sensClass}`}>
        <span className="policy-dot">●</span> {label}
      </div>
      <p className="policy-reason-full">
        {node.untrustedReason ||
          (node.chip === 'PRIVATE'
            ? 'Private data kept securely inside the execution sandbox.'
            : 'Public data cleared for model context.')}
      </p>
    </div>
  );
}

// Detail Drawer when a node is selected (G5 Rework)
function DetailDrawer({
  node,
  inspection,
  graph,
  step,
  onPick,
  onClose,
  onCollapse,
}: {
  node: Node;
  inspection: ReturnType<typeof inspect>;
  graph: ReturnType<typeof view>;
  step: number;
  runEvents: RunEvent[];
  onPick: (id: string) => void;
  onClose: () => void;
  onCollapse: () => void;
}) {
  const e = node.event;
  const chipClass = `chip-${node.chip.toLowerCase()}`;
  const rpcArgs = e.rpc?.params?.arguments ?? {};

  return (
    <aside className="drawer">
      <div className="drawer-top">
        <div className="drawer-head-left">
          <span className="eyebrow">INSPECTING {node.kind.toUpperCase()}</span>
          <h2>{node.title}</h2>
        </div>
        <div className="drawer-head-actions">
          <button className="close-btn" onClick={onClose} aria-label="Close details drawer">
            ✕
          </button>
          <button
            className="pane-header-toggle-btn"
            onClick={onCollapse}
            aria-label="Collapse Details Pane"
            title="Collapse Details Pane"
          >
            ›
          </button>
        </div>
      </div>

      <div className="drawer-meta-bar">
        <span className={`status-chip ${chipClass}`}>{node.chip}</span>
        <span className="meta-item">
          LANE <b>{node.lane.toUpperCase()}</b>
        </span>
        <span className="meta-item">
          STEP <b>{node.step}</b>
        </span>
        {node.line !== undefined && (
          <span className="meta-item">
            LINE <b>{node.line}</b>
          </span>
        )}
      </div>

      {/* Untrusted Explanation in Detail Drawer */}
      {node.chip === 'UNTRUSTED' && (
        <section className="drawer-section untrusted-banner">
          <h3>UNTRUSTED DATA SOURCE</h3>
          <p className="untrusted-desc">
            {node.untrustedReason ?? 'This node contains data influenced by an external untrusted source.'}
          </p>
          {node.hiddenInstruction && (
            <div className="hidden-instruction-box">
              <strong>HIDDEN INSTRUCTION DETECTED</strong>
              <blockquote>{node.hiddenInstruction}</blockquote>
            </div>
          )}
        </section>
      )}

      {/* Plain English Summary (Top) */}
      <section className="drawer-section">
        <h3>SUMMARY</h3>
        {inspection.plainSummary.map((line, idx) => (
          <p key={idx} className="plain-summary-line">
            {line}
          </p>
        ))}
      </section>

      {/* Script block if model turn */}
      {node.kind === 'model_turn' && e.script && (
        <section className="drawer-section">
          <h3>GENERATED SCRIPT</h3>
          <ScriptCodeBlock script={e.script} />
        </section>
      )}

      {/* G5: ARGUMENTS Section */}
      {(node.kind === 'call' || node.kind === 'blocked') && (
        <section className="drawer-section">
          <h3>ARGUMENTS</h3>
          {inspection.arguments.length === 0 ? (
            <p className="dim-text">No arguments provided.</p>
          ) : (
            <div className="args-cards-list">
              {inspection.arguments.map((arg) => (
                <ArgumentCard
                  key={arg.name}
                  argName={arg.name}
                  argData={e.args?.[arg.name]}
                  sources={arg.sources}
                  rpcArg={rpcArgs[arg.name]}
                  onPick={onPick}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* G5: LINEAGE Section (Vertical chain from original source to this node) */}
      <section className="drawer-section">
        <h3>LINEAGE</h3>
        <LineageChainView graph={graph} node={node} step={step} onPick={onPick} />
      </section>

      {/* G5: POLICY Section */}
      {(node.kind === 'call' || node.kind === 'blocked' || node.kind === 'value') && (
        <section className="drawer-section">
          <h3>POLICY</h3>
          <PolicySection node={node} />
        </section>
      )}

      {/* G5: Timing, Transport & Raw JSON-RPC Collapsed at Bottom */}
      <section className="drawer-section drawer-details-section">
        <details className="drawer-details">
          <summary className="drawer-details-summary">TIMING, TRANSPORT & RAW JSON-RPC</summary>
          <div className="drawer-details-body">
            <div className="details-row">
              <span className="details-k">TIMING:</span>
              <span className="details-v">{e.ms !== undefined ? `${e.ms} ms` : `${e.t} ms`}</span>
            </div>
            {e.transport && (
              <div className="details-row">
                <span className="details-k">TRANSPORT:</span>
                <span className="details-v">{e.transport}</span>
              </div>
            )}
            <div className="details-rpc-header">RAW JSON-RPC / EVENT:</div>
            <pre className="json-block">{JSON.stringify(e.rpc || e, null, 2)}</pre>
          </div>
        </details>
      </section>
    </aside>
  );
}

if (typeof document !== 'undefined') {
  const container = document.getElementById('root');
  if (container) {
    const root = createRoot(container);
    root.render(<App />);
  }
}

