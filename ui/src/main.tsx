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
  type Node,
  type Edge,
  type RunEvent,
  type StatusChip,
} from './view';
import './style.css';

const presetRuns: Record<string, { label: string; text: string }> = {
  fake: { label: 'Fake Run (Demo)', text: fakeRunText },
  runA: { label: 'Run A (4 Rounds)', text: runAText },
  runB: { label: 'Run B (Blocked)', text: runBText },
};

const fmt = (n: number) => n.toLocaleString();

const LANE_SUBTITLES: Record<string, string> = {
  MODEL: 'Gemini: writes code, never calls tools',
  SCRIPT: 'the code it wrote, running in a sandbox',
  payroll: 'private data',
  tracker: 'public, untrusted',
  hr: 'HR only',
};

const NODE_WIDTH = 200;
const NODE_HEIGHT = 72;
const CARD_GAP_Y = 12;
const COLUMN_WIDTH = 270;
const GUTTER_WIDTH = 70;
const LEFT_OFFSET = 170;

export function App() {
  const [source, setSource] = useState<'recorded' | 'live'>('recorded');
  const [recordedKey, setRecordedKey] = useState<'fake' | 'runA' | 'runB'>('fake');
  const [liveTask, setLiveTask] = useState<'A' | 'B'>('A');
  const [liveEvents, setLiveEvents] = useState<RunEvent[]>([]);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [wsStatus, setWsStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Feature Toggles (Spec 4a, 6, 8, Polish F3, F4)
  const [userShowEveryStep, setUserShowEveryStep] = useState<boolean>(false);
  const [replaySpeed, setReplaySpeed] = useState<1 | 2>(1);
  const [isFit, setIsFit] = useState<boolean>(false);
  const [autoFollow, setAutoFollow] = useState<boolean>(true);
  const [showLegend, setShowLegend] = useState<boolean>(false);

  // Side Panes and Focus Mode (Polish F4)
  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(false);
  const [rightCollapsed, setRightCollapsed] = useState<boolean>(false);
  const [focusMode, setFocusMode] = useState<boolean>(true);

  // Playback & Animation (Polish F1)
  const [playing, setPlaying] = useState<boolean>(false);
  const [justRevealedId, setJustRevealedId] = useState<string | null>(null);

  // Live queue ref (Polish F2)
  const liveQueueRef = useRef<RunEvent[]>([]);

  const canvasScrollRef = useRef<HTMLDivElement>(null);
  const isAutoScrollingRef = useRef<boolean>(false);
  const scriptContainerRef = useRef<HTMLElement>(null);

  // Dynamic detail level during playback/streaming (Polish F3)
  const effectiveShowEveryStep = playing || isStreaming ? true : userShowEveryStep;

  const rawEvents = useMemo(() => {
    if (source === 'live') return liveEvents;
    const txt = presetRuns[recordedKey]?.text ?? fakeRunText;
    return parseRun(txt);
  }, [source, liveEvents, recordedKey]);

  const graph = useMemo(() => {
    return view(rawEvents, { showEveryStep: effectiveShowEveryStep });
  }, [rawEvents, effectiveShowEveryStep]);

  const runStory = useMemo(() => {
    return story(graph);
  }, [graph]);

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

  // Live run WebSocket starter (Polish F2)
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

  // Live queue pacing timer (Polish F2: ~450ms at 1x)
  useEffect(() => {
    if (!isStreaming && liveQueueRef.current.length === 0) return;

    const interval = replaySpeed === 2 ? 225 : 450;
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

  // Layered Layout computation & Orthogonal routing (Polish L1, L2, L3)
  const layout = useMemo(() => {
    const laneHeightMap: Record<string, number> = {};
    const laneTopMap: Record<string, number> = {};
    const pos: Record<string, { x: number; y: number; col: number }> = {};

    const maxCol = Math.max(1, ...graph.nodes.map((n) => n.column ?? 1));

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

    // Cumulative Y offsets
    let currentTop = 20;
    for (const lane of graph.lanes) {
      laneTopMap[lane] = currentTop;
      currentTop += laneHeightMap[lane] + 16;
    }

    const totalHeight = currentTop + 40;

    // Position each node: within lane and column, ordered by first-seen order
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
          const laneTop = laneTopMap[lane] ?? 20;
          const x = LEFT_OFFSET + (col - 1) * COLUMN_WIDTH;
          const y = laneTop + 44 + stackIdx * (NODE_HEIGHT + CARD_GAP_Y);
          pos[node.id] = { x, y, col };
        });
      }
    }

    const totalWidth = Math.max(1100, LEFT_OFFSET + maxCol * COLUMN_WIDTH + 100);

    // Compute orthogonal edge routes and 6px vertical tracks per gutter (Polish L2)
    const gutterEdges = new Map<number, Edge[]>();
    for (const edge of graph.edges) {
      const pFrom = pos[edge.from];
      const pTo = pos[edge.to];
      if (!pFrom || !pTo) continue;
      const g = pFrom.col;
      if (!gutterEdges.has(g)) gutterEdges.set(g, []);
      gutterEdges.get(g)!.push(edge);
    }

    const edgePaths: Record<string, string> = {};
    for (const [g, edges] of gutterEdges.entries()) {
      const sortedEdges = [...edges].sort((a, b) => {
        const yAFrom = pos[a.from]?.y ?? 0;
        const yBFrom = pos[b.from]?.y ?? 0;
        if (yAFrom !== yBFrom) return yAFrom - yBFrom;
        const yATo = pos[a.to]?.y ?? 0;
        const yBTo = pos[b.to]?.y ?? 0;
        return yATo - yBTo;
      });

      const count = sortedEdges.length;
      const xMid = LEFT_OFFSET + (g - 1) * COLUMN_WIDTH + NODE_WIDTH + GUTTER_WIDTH / 2;

      sortedEdges.forEach((e, idx) => {
        const pFrom = pos[e.from];
        const pTo = pos[e.to];
        if (!pFrom || !pTo) return;

        const x1 = pFrom.x + NODE_WIDTH;
        const y1 = pFrom.y + NODE_HEIGHT / 2;
        const x2 = pTo.x;
        const y2 = pTo.y + NODE_HEIGHT / 2;

        const trackOffset = (idx - (count - 1) / 2) * 6;
        const xTrack = xMid + trackOffset;

        let pathStr = '';
        if (Math.abs(y1 - y2) < 2 && pTo.col === pFrom.col + 1) {
          pathStr = `M ${x1} ${y1} L ${x2} ${y2}`;
        } else {
          const R = Math.min(8, Math.max(2, Math.abs(xTrack - x1) / 2), Math.max(2, Math.abs(y2 - y1) / 2));
          if (y2 > y1) {
            pathStr = `M ${x1} ${y1} L ${xTrack - R} ${y1} Q ${xTrack} ${y1}, ${xTrack} ${y1 + R} L ${xTrack} ${y2 - R} Q ${xTrack} ${y2}, ${xTrack + R} ${y2} L ${x2} ${y2}`;
          } else {
            pathStr = `M ${x1} ${y1} L ${xTrack - R} ${y1} Q ${xTrack} ${y1}, ${xTrack} ${y1 - R} L ${xTrack} ${y2 + R} Q ${xTrack} ${y2}, ${xTrack + R} ${y2} L ${x2} ${y2}`;
          }
        }
        edgePaths[`${e.from}-${e.to}-${e.kind}`] = pathStr;
      });
    }

    return {
      pos,
      laneHeightMap,
      laneTopMap,
      totalHeight,
      totalWidth,
      edgePaths,
      maxCol,
    };
  }, [graph.nodes, graph.lanes, graph.edges]);

  // Round Headers & Vertical Dividers (Polish L1)
  const roundInfo = useMemo(() => {
    const models = rawEvents.filter((e) => e.type === 'model_turn');
    const rounds: Array<{ round: number; startX: number }> = [];

    for (let r = 1; r <= (models.length || 1); r++) {
      const modelEvent = models.find((m) => m.round === r) ?? models[r - 1];
      const modelNode = graph.nodes.find(
        (n) => n.kind === 'model_turn' && (n.round === r || n.id === modelEvent?.id),
      );
      const col = modelNode?.column ?? (r === 1 ? 2 : 2 + (r - 1) * 3);
      const startX = LEFT_OFFSET + (col - 1) * COLUMN_WIDTH - 25;

      rounds.push({
        round: r,
        startX,
      });
    }
    return rounds;
  }, [rawEvents, graph.nodes]);

  // Replay timer (Polish F1)
  useEffect(() => {
    if (!playing) return;
    if (step >= maxStep) {
      setPlaying(false);
      return;
    }
    const interval = replaySpeed === 2 ? 350 : 700;
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

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if (e.key === 'ArrowRight') {
        setPlaying(false);
        setStep((s) => Math.min(maxStep, s + 1));
      } else if (e.key === 'ArrowLeft') {
        setPlaying(false);
        setStep((s) => Math.max(1, s - 1));
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
  }, [maxStep]);

  // Deselect if current node is hidden by step
  useEffect(() => {
    if (selectedId && !visibleNodeIds.has(selectedId)) {
      setSelectedId(null);
    }
  }, [step, selectedId, visibleNodeIds]);

  // Auto-scroll centering newest node when replaying or streaming (Polish F1)
  useEffect(() => {
    if (!autoFollow || isFit) return;
    const scrollContainer = canvasScrollRef.current;
    if (!scrollContainer) return;

    const activeNodes = visibleNodes.filter((n) => n.step === step);
    const targetNode = activeNodes.at(-1) ?? visibleNodes.at(-1);
    if (!targetNode) return;

    const pos = layout.pos[targetNode.id];
    if (!pos) return;

    isAutoScrollingRef.current = true;
    const targetLeft = Math.max(0, pos.x + NODE_WIDTH / 2 - scrollContainer.clientWidth / 2);
    const targetTop = Math.max(0, pos.y + NODE_HEIGHT / 2 - scrollContainer.clientHeight / 2);

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
  }, [step, autoFollow, isFit, visibleNodes, layout.pos]);

  const handleCanvasScroll = () => {
    if (!isAutoScrollingRef.current && (playing || isStreaming)) {
      setAutoFollow(false);
    }
  };

  const selectNode = useCallback((id: string) => {
    setSelectedId(id);
    const node = graph.nodes.find((n) => n.id === id);
    if (node && node.step > step) {
      setStep(node.step);
    }
  }, [graph.nodes, step]);

  // Auto-scroll selected line in script pane
  useEffect(() => {
    if (!detail?.node?.line) return;
    const container = scriptContainerRef.current;
    if (!container) return;
    const lineEl = container.querySelector(`[data-line="${detail.node.line}"]`) as HTMLElement;
    if (lineEl && typeof lineEl.scrollIntoView === 'function') {
      lineEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [detail?.node?.line]);

  const promptEvent = rawEvents.find((e) => e.type === 'prompt');
  const promptText = promptEvent?.text ?? "Triage issues and send payroll total to HR";

  // Fit Scale (Polish L4: never scale below 0.75; fit height and scroll horizontally if still too big)
  const fitScale = useMemo(() => {
    if (!isFit || !canvasScrollRef.current) return 1;
    const container = canvasScrollRef.current;
    const scaleX = (container.clientWidth - 40) / layout.totalWidth;
    const scaleY = (container.clientHeight - 40) / layout.totalHeight;
    const ideal = Math.min(1, scaleX, scaleY);
    return ideal >= 0.75 ? ideal : Math.max(0.75, Math.min(1, scaleY));
  }, [isFit, layout.totalWidth, layout.totalHeight]);

  // Focus Mode & Collapsed Side Panes (Polish F4)
  const isFocusActive = focusMode && (playing || isStreaming);
  const isLeftCollapsed = isFocusActive || leftCollapsed;
  const isRightCollapsed = isFocusActive || rightCollapsed;

  // Placeholder for waiting on Gemini (Polish F2)
  const waitingRound = (rawEvents.filter((e) => e.type === 'model_turn').length || 0) + 1;
  const isWaitingForGemini = isStreaming && liveQueueRef.current.length === 0;

  return (
    <div className="app">
      {/* Top Header */}
      <header>
        <div className="brand">
          <span className="brand-icon">◈</span> MCP<span>Vision</span>
          <small>/ STRACE FOR CODE MODE</small>
        </div>
        <div className="task">
          <span className="task-label">YOUR TASK</span>
          <strong title={promptText}>{promptText}</strong>
        </div>

        <div className="seg">
          <button
            className={source === 'recorded' && recordedKey === 'fake' ? 'active' : ''}
            onClick={() => {
              setSource('recorded');
              setRecordedKey('fake');
              setSelectedId(null);
            }}
          >
            Demo Run
          </button>
          <button
            className={source === 'recorded' && recordedKey === 'runA' ? 'active' : ''}
            onClick={() => {
              setSource('recorded');
              setRecordedKey('runA');
              setSelectedId(null);
            }}
          >
            Run A (4 Rounds)
          </button>
          <button
            className={source === 'recorded' && recordedKey === 'runB' ? 'active' : ''}
            onClick={() => {
              setSource('recorded');
              setRecordedKey('runB');
              setSelectedId(null);
            }}
          >
            Run B (Blocked)
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
          {/* Focus Toggle (Polish F4) */}
          <button
            className={`tool-toggle ${focusMode ? 'active' : ''}`}
            onClick={() => setFocusMode((f) => !f)}
            title="Auto-collapse side panes during playback"
          >
            {focusMode ? '✓ Focus on' : 'Focus'}
          </button>

          {/* Show every step toggle (Spec 4a) */}
          <button
            className={`tool-toggle ${userShowEveryStep ? 'active' : ''}`}
            onClick={() => setUserShowEveryStep((s) => !s)}
            title="Toggle showing intermediate steps and uncollapsed lines"
          >
            {userShowEveryStep ? '✓ Showing every step' : 'Show every step'}
          </button>

          {/* Fit button (Polish L4) */}
          <button
            className={`tool-toggle ${isFit ? 'active' : ''}`}
            onClick={() => setIsFit((f) => !f)}
            title="Zoom graph to fit view"
          >
            {isFit ? '100%' : 'Fit'}
          </button>

          {/* Follow button (Polish F1) */}
          {!autoFollow && (
            <button
              className="tool-toggle pulse"
              onClick={() => setAutoFollow(true)}
              title="Resume following newest node during playback"
            >
              Follow
            </button>
          )}

          {/* Legend Popover (Spec 8) */}
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
                    <span className="legend-item"><i style={{ background: '#8fa3bf' }} /> Asks / writes</span>
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
          gridTemplateColumns: `${isLeftCollapsed ? '28px' : '320px'} 1fr ${isRightCollapsed ? '28px' : 'var(--drawer-width)'}`,
        }}
      >
        {/* Left Script Pane (Polish F4: Collapsible Rail) */}
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
          <aside className="script-pane" ref={scriptContainerRef as any} style={{ position: 'relative' }}>
            <button
              className="pane-collapse-btn left"
              onClick={() => setLeftCollapsed(true)}
              aria-label="Collapse Script Pane"
              title="Collapse Script Pane"
            >
              ‹
            </button>
            <div className="pane-head">
              <div>
                <span className="eyebrow">GENERATED CODE</span>
                <h2>Script</h2>
              </div>
              <span className="badge">TS</span>
            </div>
            <p className="pane-note">Written by Gemini. Runs in sandbox with MCP wrapper.</p>

            <div className="script-scroll-area">
              {rawEvents
                .filter((e) => e.type === 'model_turn')
                .map((m) => (
                  <section className="round" key={m.id}>
                    <div className="round-title">
                      <span>ROUND {m.round}</span>
                      <span>MODEL TURN</span>
                    </div>
                    {m.script?.map((l: { n: number; code: string }) => {
                      const isSelected = detail?.node?.line === l.n;
                      return (
                        <button
                          key={l.n}
                          data-line={l.n}
                          className={`code-line ${isSelected ? 'selected' : ''}`}
                          onClick={() => {
                            const target = graph.nodes.find((n) => n.line === l.n);
                            if (target) selectNode(target.id);
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
          </aside>
        )}

        {/* Center Stage */}
        <section className="stage">
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
              onScroll={handleCanvasScroll}
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
                {/* Round Headers & Vertical Dividers (Polish L1) */}
                {roundInfo.map((r) => (
                  <div
                    key={`round-${r.round}`}
                    className="round-divider"
                    style={{ left: r.startX }}
                  >
                    <span className="round-tag">Round {r.round}</span>
                  </div>
                ))}

                {/* Lane Tracks & Explanations (Polish P2: YOU lane clamped subtitle) */}
                {graph.lanes.map((lane) => {
                  const laneTop = layout.laneTopMap[lane] ?? 20;
                  const laneHeight = layout.laneHeightMap[lane] ?? 130;
                  const laneSub = lane === 'YOU' ? promptText : (LANE_SUBTITLES[lane] ?? 'MCP server');

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
                        <span
                          className={`lane-desc ${lane === 'YOU' ? 'clamp-2' : ''}`}
                          title={laneSub}
                        >
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

                {/* SVG Orthogonal Connecting Wires (Polish L2, R1) */}
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
                          className={`wire ${e.kind} ${isFaded ? 'faded' : ''} ${isLit ? 'lit' : ''}`}
                        >
                          <path d={pathD} markerEnd={`url(#arrow-${e.kind})`} />
                          <title>{tooltipText}</title>
                        </g>
                      );
                    })}
                </svg>

                {/* Visible Node Cards (Polish L1, R1, F1) */}
                <div className="node-layer">
                  {visibleNodes.map((n) => {
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
                        <span className="node-sub">{n.subtitle}</span>
                      </button>
                    );
                  })}

                  {/* Pulsing Placeholder while waiting for Gemini (Polish F2) */}
                  {isWaitingForGemini && (
                    <div
                      className="node-card kind-model_turn placeholder-writing"
                      style={{
                        left: LEFT_OFFSET + layout.maxCol * COLUMN_WIDTH,
                        top: (layout.laneTopMap['MODEL'] ?? 20) + 44,
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
            /* Strace Log View (Polish R2: Colour-coded tags) */
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
                    <span className="strace-sub">{n.subtitle}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Replay Bar (Spec 6) */}
          <div className="replay">
            <button
              className="replay-btn"
              aria-label="Previous step"
              onClick={() => {
                setPlaying(false);
                setStep((s) => Math.max(1, s - 1));
              }}
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
              onClick={() => {
                setPlaying(false);
                setStep((s) => Math.min(maxStep, s + 1));
              }}
            >
              →
            </button>

            {/* Replay Speed Toggle (Spec 6) */}
            <button
              className="speed-btn"
              onClick={() => setReplaySpeed((s) => (s === 1 ? 2 : 1))}
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
                  onClick={() => {
                    setPlaying(false);
                    setStep(s);
                  }}
                />
              ))}
            </div>

            <div className="step-label">
              STEP <b>{String(step).padStart(2, '0')}</b> / {String(maxStep).padStart(2, '0')}
            </div>
          </div>
        </section>

        {/* Right Drawer: Story OR Detail (Polish F4: Collapsible Rail, Polish P1, P2) */}
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
          MCPVision · Value lineage for Code Mode · Click node to trace · ← → to step
        </span>
      </footer>
    </div>
  );
}

// Script Code Block with Line Numbers & Truncation (Polish P1)
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
          className="show-all-lines-btn"
          onClick={() => setShowAll((s) => !s)}
        >
          {showAll ? 'Show fewer lines' : `Show all ${script.length} lines`}
        </button>
      )}
    </div>
  );
}

// STORY Drawer when nothing is selected (Polish P1, P2)
function StoryDrawer({
  story: s,
  onPick,
  onCollapse,
}: {
  story: ReturnType<typeof story>;
  onPick: (id: string) => void;
  onCollapse: () => void;
}) {
  return (
    <aside className="drawer story-drawer" style={{ position: 'relative' }}>
      <button
        className="pane-collapse-btn right"
        onClick={onCollapse}
        aria-label="Collapse Story Pane"
        title="Collapse Story Pane"
      >
        ›
      </button>
      <div className="drawer-top">
        <div>
          <span className="eyebrow">RUN SUMMARY</span>
          <h2>Story</h2>
        </div>
      </div>

      <div className="verdict-banner">
        <strong>{s.headline}</strong>
      </div>

      <div className="story-sentences">
        {s.sentences.map((sentence, idx) => (
          <button
            key={idx}
            className="story-sentence-btn"
            onClick={() => sentence.id && onPick(sentence.id)}
            disabled={!sentence.id}
          >
            <p>{sentence.text}</p>
          </button>
        ))}
      </div>

      <div className="context-boundary-box">
        <span className="eyebrow">CONTEXT BOUNDARY</span>
        <p>{s.contextBoundary}</p>
      </div>
    </aside>
  );
}

// Detail Drawer when a node is selected (Polish P1, P2)
function DetailDrawer({
  node,
  inspection,
  graph,
  runEvents,
  onPick,
  onClose,
  onCollapse,
}: {
  node: Node;
  inspection: ReturnType<typeof inspect>;
  graph: ReturnType<typeof view>;
  runEvents: RunEvent[];
  onPick: (id: string) => void;
  onClose: () => void;
  onCollapse: () => void;
}) {
  const e = node.event;

  return (
    <aside className="drawer" style={{ position: 'relative' }}>
      <button
        className="pane-collapse-btn right"
        onClick={onCollapse}
        aria-label="Collapse Details Pane"
        title="Collapse Details Pane"
      >
        ›
      </button>
      <div className="drawer-top">
        <div>
          <span className="eyebrow">INSPECTING {node.kind.toUpperCase().replace('_', ' ')}</span>
          <h2>{node.title}</h2>
        </div>
        <button className="close-btn" onClick={onClose} aria-label="Close details">
          ×
        </button>
      </div>

      {/* 1 to 3 Plain Sentences */}
      <div className="plain-summary-box">
        {inspection.plainSummary.map((sentence, idx) => (
          <p key={idx} className="answer-p">
            {sentence}
          </p>
        ))}
      </div>

      {/* Repeated Calls Breakdown */}
      {node.repeatedEvents && node.repeatedEvents.length > 1 && (
        <div className="repeats-section">
          <h3>REPEATED CALLS ({node.repeatedEvents.length})</h3>
          <div className="repeats-list">
            {node.repeatedEvents.map((ev, i) => (
              <div key={i} className="repeat-item">
                <span>Call {i + 1} · Step {ev.step}</span>
                <b>{ev.ms ?? 0} ms ({ev.transport ?? 'stdio'})</b>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Traced Values List */}
      {inspection.tracedValues.length > 0 && (
        <div className="traced-values-section">
          <h3>TRACED VALUES</h3>
          <div className="traced-values-list">
            {inspection.tracedValues.map((tv, idx) => (
              <div key={idx} className="traced-value-item">
                <code>
                  {tv.name} = {tv.value}
                </code>
                <div className="traced-value-meta">
                  <span>← from {tv.source}</span>
                  <span className={`chip-demo chip-${tv.sensitivity}`}>{tv.sensitivity}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Arguments & Sources */}
      {(node.kind === 'call' || node.kind === 'blocked') && (
        <>
          <h3>
            ARGUMENTS <span>· WHERE THEY CAME FROM</span>
          </h3>
          {inspection.arguments.map((a) => (
            <div className="arg-card" key={a.name}>
              <code>
                {a.name} <span>= {a.preview}</span>
              </code>
              <div className="arg-source">
                ←{' '}
                {a.sources.length ? (
                  a.sources.map((s) => (
                    <button
                      key={s.id}
                      className="chip"
                      onClick={() => onPick(s.id)}
                      title={`Inspect ${s.title}`}
                    >
                      {s.title}
                      {s.line ? ` · line ${s.line}` : ''}
                    </button>
                  ))
                ) : (
                  <span>Literal in script</span>
                )}
              </div>
            </div>
          ))}

          <h3>POLICY DECISION</h3>
          <div className={`policy-badge ${node.kind === 'blocked' ? 'bad' : 'ok'}`}>
            {node.kind === 'blocked' ? `Blocked · ${e.rule}` : 'Allowed · forwarded to server'}
          </div>

          <div className="facts-grid">
            <div className="fact-item">
              <span>TRANSPORT</span>
              <b>{e.transport ?? 'stdio'}</b>
            </div>
            <div className="fact-item">
              <span>TIMING</span>
              <b>{e.ms === undefined ? 'Not sent' : `${e.ms} ms`}</b>
            </div>
          </div>

          <details>
            <summary>Raw JSON-RPC</summary>
            <pre>{JSON.stringify(e.rpc, null, 2)}</pre>
          </details>
        </>
      )}

      {/* Model Turn Details (Polish P1: Gutter + Truncation) */}
      {node.kind === 'model_turn' && (
        <>
          <details open>
            <summary>What Gemini saw · {e.saw?.length ?? 0} items</summary>
            <table className="saw-table">
              <tbody>
                {e.saw?.map((s: any, i: number) => (
                  <tr className={`saw-row ${s.untrusted ? 'tainted' : ''}`} key={i}>
                    <td>
                      {s.label}
                      {s.untrusted && <small> · untrusted</small>}
                    </td>
                    <td>{s.tokens} tok</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>

          <h3>SCRIPT WRITTEN</h3>
          <ScriptCodeBlock script={e.script ?? []} />
        </>
      )}

      {/* Value Details */}
      {node.kind === 'value' && (
        <>
          <h3>VALUE PREVIEW</h3>
          <pre>{e.preview}</pre>

          <div className="facts-grid">
            <div className="fact-item">
              <span>SENSITIVITY</span>
              <b>{e.sensitivity}</b>
            </div>
            <div className="fact-item">
              <span>TRUST LEVEL</span>
              <b>{e.taint}</b>
            </div>
          </div>

          <h3>PRODUCED FROM</h3>
          {(e.from ?? []).map((id: string) => {
            const sourceNode = graph.nodes.find((n) => n.id === id);
            return (
              <button className="related-btn" key={id} onClick={() => onPick(id)}>
                <span>{sourceNode?.title ?? id}</span>
                <span>→</span>
              </button>
            );
          })}
        </>
      )}

      {/* Error Details */}
      {node.kind === 'error' && (
        <>
          <h3>ANALYSIS ERROR</h3>
          <div className="alert-box">
            <b>{e.message ?? 'Unknown lineage error'}</b>
            <p>Line {e.line}: Static analysis could not determine lineage. Fail-closed policy was applied.</p>
          </div>
        </>
      )}
    </aside>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(<App />);
}
