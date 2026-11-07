import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import runText from '../../runs/fake-run.jsonl?raw';
import { inspect, parseRun, view, type Node, type Mode, type Edge, type RunEvent } from './view';
import './style.css';

const runEvents: RunEvent[] = parseRun(runText);
const graph = view(runEvents);
const maxStep = graph.steps.at(-1) ?? 1;

const fmt = (n: number) => n.toLocaleString();

export function App() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('lineage');
  const [step, setStep] = useState<number>(maxStep);
  const [display, setDisplay] = useState<'graph' | 'strace'>('graph');
  const [playing, setPlaying] = useState<boolean>(false);

  const detail = useMemo(() => {
    if (!selectedId) return null;
    return inspect(graph, selectedId, mode, step);
  }, [selectedId, mode, step]);

  const visibleNodes = useMemo(() => {
    return graph.nodes.filter((n) => n.step <= step);
  }, [step]);

  const visibleNodeIds = useMemo(() => {
    return new Set(visibleNodes.map((n) => n.id));
  }, [visibleNodes]);

  // Compute node positions on the canvas
  const positions = useMemo(() => {
    const laneStepCounts: Record<string, number> = {};
    const pos: Record<string, { x: number; y: number }> = {};

    for (const node of graph.nodes) {
      const laneIndex = graph.lanes.indexOf(node.lane);
      const key = `${node.lane}-${node.step}`;
      const count = laneStepCounts[key] ?? 0;
      laneStepCounts[key] = count + 1;

      pos[node.id] = {
        x: 170 + (node.step - 1) * 200,
        y: 48 + (laneIndex >= 0 ? laneIndex : 0) * 160 + count * 68,
      };
    }
    return pos;
  }, []);

  // Replay timer
  useEffect(() => {
    if (!playing) return;
    if (step >= maxStep) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => {
      setStep((s) => Math.min(maxStep, s + 1));
    }, 700);
    return () => clearTimeout(timer);
  }, [playing, step]);

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
      } else if (e.key === ' ' && e.target === document.body) {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Deselect if current node is hidden by step
  useEffect(() => {
    if (selectedId && !visibleNodeIds.has(selectedId)) {
      setSelectedId(null);
    }
  }, [step, selectedId, visibleNodeIds]);

  const selectNode = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const findLineNode = useCallback(
    (line: number) => {
      return graph.nodes.find((n) => n.kind === 'script' && n.line === line);
    },
    [],
  );

  const promptEvent = runEvents.find((e) => e.type === 'prompt');

  return (
    <div className="app">
      {/* Top Header */}
      <header>
        <div className="brand">
          <span className="brand-icon">◈</span> MCP<span>Vision</span>
          <small>/ TRACE EXPLORER</small>
        </div>
        <div className="task">
          <span className="task-label">YOUR TASK</span>
          <strong>{promptEvent?.text ?? "Triage issues and send payroll total to HR"}</strong>
        </div>
        <button
          className="run-btn"
          onClick={() => {
            setSelectedId(null);
            setStep(1);
            setPlaying(true);
          }}
        >
          ▶ <span>Run replay</span>
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
          <i /> <b>Recorded run</b>
          <span>·</span> {graph.summary?.rounds ?? 2} rounds <span>·</span>{' '}
          {fmt(runEvents.at(-1)?.t ?? 0)} ms
        </div>
        <div className="toolbar-right">
          <span className="control-label">TRACE</span>
          <div className="seg small">
            <button
              className={mode === 'lineage' ? 'active' : ''}
              onClick={() => setMode('lineage')}
            >
              Lineage
            </button>
            <button
              className={mode === 'blast' ? 'active' : ''}
              onClick={() => setMode('blast')}
            >
              Blast radius
            </button>
          </div>

          <details className="legend">
            <summary>Legend</summary>
            <div className="legend-content">
              <span className="legend-item">
                <i style={{ background: '#8fa3bf' }} /> Asks / writes
              </span>
              <span className="legend-item">
                <i style={{ background: '#6ca8ff' }} /> Code calls tool
              </span>
              <span className="legend-item">
                <i style={{ background: '#6f7d96' }} /> Public data
              </span>
              <span className="legend-item">
                <i style={{ background: '#ffb454' }} /> Private data
              </span>
              <span className="legend-item dashed">
                <i style={{ borderColor: '#ff7ab6' }} /> Untrusted influence
              </span>
              <span className="legend-item dashed">
                <i style={{ borderColor: '#ff5c5c' }} /> Blocked
              </span>
            </div>
          </details>
        </div>
      </div>

      {/* Main Body */}
      <main className={detail?.node ? 'with-drawer' : ''}>
        {/* Left Script Pane */}
        <aside className="script-pane">
          <div className="pane-head">
            <div>
              <span className="eyebrow">GENERATED CODE</span>
              <h2>Script</h2>
            </div>
            <span className="badge">TS</span>
          </div>
          <p className="pane-note">Written by the model. Executed in the sandbox.</p>

          {runEvents
            .filter((e) => e.type === 'model_turn')
            .map((m) => (
              <section className="round" key={m.id}>
                <div className="round-title">
                  <span>ROUND {m.round}</span>
                  <span>MODEL TURN</span>
                </div>
                {m.script?.map((l: { n: number; code: string }) => {
                  const node = findLineNode(l.n);
                  const isVisible = node ? node.step <= step : false;
                  const isSelected =
                    selectedId === node?.id || detail?.node?.line === l.n;
                  const isDim =
                    detail !== null && node && !detail.lit.has(node.id);

                  return (
                    <button
                      key={l.n}
                      className={`code-line ${isSelected ? 'selected' : ''} ${
                        isDim ? 'dim' : ''
                      }`}
                      onClick={() => node && isVisible && selectNode(node.id)}
                      disabled={!node || !isVisible}
                      title={isVisible ? `Select line ${l.n}` : 'Not executed yet'}
                    >
                      <span className="line-num">{String(l.n).padStart(2, '0')}</span>
                      <code>{l.code}</code>
                    </button>
                  );
                })}
              </section>
            ))}
        </aside>

        {/* Center Stage */}
        <section className="stage">
          <div className="stage-heading">
            <div>
              <span className="eyebrow">EXECUTION TRACE</span>
              <h1>{display === 'graph' ? 'Follow the flow' : 'Event log'}</h1>
              <p>
                {selectedId
                  ? 'Tracing selected event. Click any connected source to follow data lineage.'
                  : 'Select a node or script line to trace its data flow.'}
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
            <div className="canvas-scroll">
              <div
                className="canvas"
                style={{
                  width: Math.max(1100, 200 + maxStep * 200),
                  height: 60 + graph.lanes.length * 160,
                }}
              >
                {/* Lane Tracks & Labels */}
                {graph.lanes.map((lane, i) => (
                  <div
                    key={lane}
                    className={`lane-track ${
                      lane === 'MODEL' ? 'model-lane' : lane === 'SCRIPT' ? 'script-lane' : ''
                    }`}
                    style={{ top: 38 + i * 160 }}
                  >
                    <div className="lane-header">
                      <b>{lane.toUpperCase()}</b>
                      <span>
                        {lane === 'YOU'
                          ? 'The developer'
                          : lane === 'MODEL'
                          ? `${fmt(graph.summary?.model_tokens ?? 0)} tok in context`
                          : lane === 'SCRIPT'
                          ? 'Sandbox execution'
                          : 'MCP server'}
                      </span>
                      {lane === 'MODEL' && <em>CONTEXT BOUNDARY</em>}
                      {lane === 'SCRIPT' && (
                        <em>{fmt(graph.summary?.sandbox_tokens ?? 0)} sandbox-only tokens</em>
                      )}
                    </div>
                  </div>
                ))}

                {/* SVG Connecting Wires */}
                <svg
                  className="wires"
                  width="100%"
                  height="100%"
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
                      <path d="M0 1 L9 5 L0 9 z" fill="#6f7d96" />
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
                    .filter(
                      (e) =>
                        visibleNodeIds.has(e.from) && visibleNodeIds.has(e.to),
                    )
                    .map((e, index) => {
                      const posA = positions[e.from];
                      const posB = positions[e.to];
                      if (!posA || !posB) return null;

                      const isLit = detail?.edges.includes(e) ?? false;
                      const isFaded = detail !== null && !isLit;

                      const x1 = posA.x + 80;
                      const y1 = posA.y + 26;
                      const x2 = posB.x + 80;
                      const y2 = posB.y + 26;

                      const midX = (x1 + x2) / 2;
                      const midY = (y1 + y2) / 2;

                      const labelText =
                        e.label.length > 34
                          ? e.label.slice(0, 34) + '…'
                          : e.label;

                      return (
                        <g
                          key={`${e.from}-${e.to}-${index}`}
                          className={`wire ${e.kind} ${
                            isFaded ? 'faded' : ''
                          } ${isLit ? 'lit' : ''}`}
                        >
                          <path
                            d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                            markerEnd={`url(#arrow-${e.kind})`}
                          />
                          {/* UX Rule 1: No edge labels until something is selected */}
                          {isLit && labelText && (
                            <g>
                              <rect
                                className="wire-label-bg"
                                x={midX - labelText.length * 3.3 - 8}
                                y={midY - 10}
                                width={labelText.length * 6.6 + 16}
                                height={20}
                              />
                              <text
                                className="wire-label"
                                x={midX}
                                y={midY}
                              >
                                {labelText}
                              </text>
                            </g>
                          )}
                        </g>
                      );
                    })}
                </svg>

                {/* Visible Nodes */}
                {visibleNodes.map((n) => {
                  const pos = positions[n.id];
                  if (!pos) return null;

                  const isSelected = selectedId === n.id;
                  const isDim = detail !== null && !detail.lit.has(n.id);
                  const isBlocked = n.kind === 'blocked';
                  const isError = n.kind === 'error';

                  return (
                    <button
                      key={n.id}
                      style={{ left: pos.x, top: pos.y }}
                      className={`node-card ${n.kind} ${
                        n.event.sensitivity ?? ''
                      } ${n.event.taint === 'untrusted' ? 'untrusted' : ''} ${
                        isSelected ? 'selected' : ''
                      } ${isDim ? 'dim' : ''}`}
                      onClick={() => selectNode(n.id)}
                      title={`Step ${n.step}: ${n.title}`}
                    >
                      <span className="node-tag">
                        {isBlocked
                          ? '⛔ BLOCKED'
                          : isError
                          ? '⚠️ ERROR'
                          : n.kind === 'script'
                          ? `SCRIPT · LINE ${n.line}`
                          : n.kind === 'value'
                          ? `${n.event.sensitivity} · ${n.event.taint}`
                          : n.kind.replace('_', ' ')}
                      </span>
                      <strong className="node-title">{n.title}</strong>
                      <small className="node-sub">{n.subtitle}</small>
                    </button>
                  );
                })}
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
                    <span className={`strace-type ${n.kind}`}>
                      {n.kind.replace('_', ' ')}
                    </span>
                    <span className="strace-title">{n.title}</span>
                    <span className="strace-sub">{n.subtitle}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Replay Bar */}
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

            <div className="ticks">
              {graph.steps.map((s) => (
                <button
                  key={s}
                  aria-label={`Go to step ${s}`}
                  title={`Step ${s}`}
                  className={`tick ${s <= step ? 'passed' : ''} ${
                    s === step ? 'current' : ''
                  }`}
                  onClick={() => {
                    setPlaying(false);
                    setStep(s);
                  }}
                />
              ))}
            </div>

            <div className="step-label">
              STEP <b>{String(step).padStart(2, '0')}</b> /{' '}
              {String(maxStep).padStart(2, '0')}
            </div>
          </div>
        </section>

        {/* Right Detail Drawer */}
        {detail?.node && (
          <Drawer
            node={detail.node}
            args={detail.arguments}
            onPick={selectNode}
            onClose={() => setSelectedId(null)}
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
          MCPVision · Value lineage for Code Mode · ← → to step · Esc to deselect
        </span>
      </footer>
    </div>
  );
}

function Drawer({
  node,
  args,
  onPick,
  onClose,
}: {
  node: Node;
  args: Array<{ name: string; preview: string; sources: Node[] }>;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const e = node.event;

  return (
    <aside className="drawer">
      <div className="drawer-top">
        <div>
          <span className="eyebrow">
            INSPECTING {node.kind.toUpperCase().replace('_', ' ')}
          </span>
          <h2>{node.title}</h2>
        </div>
        <button
          className="close-btn"
          onClick={onClose}
          aria-label="Close details"
        >
          ×
        </button>
      </div>

      {/* Primary One-Sentence Answer */}
      {node.kind === 'blocked' ? (
        <div className="alert-box">
          <b>Blocked before it was sent</b>
          <p>{e.reason}</p>
        </div>
      ) : (
        <p className="answer">
          {node.kind === 'call'
            ? `Called ${e.server}.${e.tool} from script line ${e.line}.`
            : node.kind === 'value'
            ? `${e.preview}. ${e.sensitivity} data, ${
                e.in_model_context ? 'included in' : 'kept out of'
              } model context.`
            : node.kind === 'script'
            ? `The model wrote this code in round ${
                runEvents.find((m) => m.id === e.model)?.round ?? 1
              }.`
            : node.kind === 'model_turn'
            ? `The model saw ${
                e.saw?.reduce((a: number, s: any) => a + s.tokens, 0) ?? 0
              } tokens and wrote ${e.script?.length ?? 0} lines of code.`
            : node.subtitle}
        </p>
      )}

      {/* Tool Call & Blocked Tool Call Details */}
      {(node.kind === 'call' || node.kind === 'blocked') && (
        <>
          <h3>
            ARGUMENTS <span>· WHERE THEY CAME FROM</span>
          </h3>
          {args.map((a) => (
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
            {node.kind === 'blocked'
              ? `Blocked · ${e.rule}`
              : 'Allowed · forwarded to server'}
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

      {/* Model Turn Details */}
      {node.kind === 'model_turn' && (
        <>
          <details open>
            <summary>What the model saw · {e.saw?.length ?? 0} items</summary>
            <table className="saw-table">
              <tbody>
                {e.saw?.map((s: any, i: number) => (
                  <tr
                    className={`saw-row ${s.untrusted ? 'tainted' : ''}`}
                    key={i}
                  >
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
          <pre>
            {e.script?.map((l: any) => `${String(l.n).padStart(2, '0')}  ${l.code}`).join('\n')}
          </pre>
        </>
      )}

      {/* Script Line Details */}
      {node.kind === 'script' && (
        <>
          <h3>CODE</h3>
          <pre>{e.code}</pre>

          <h3>RELATED EVENTS</h3>
          {graph.nodes
            .filter((n) => n.line === node.line && n.id !== node.id)
            .map((n) => (
              <button
                className="related-btn"
                key={n.id}
                onClick={() => onPick(n.id)}
              >
                <span>{n.title}</span>
                <span>→</span>
              </button>
            ))}
        </>
      )}

      {/* Value Node Details */}
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
              <button
                className="related-btn"
                key={id}
                onClick={() => onPick(id)}
              >
                <span>{sourceNode?.title ?? id}</span>
                <span>→</span>
              </button>
            );
          })}
        </>
      )}

      {/* Error Node Details */}
      {node.kind === 'error' && (
        <>
          <h3>ANALYSIS ERROR</h3>
          <div className="alert-box">
            <b>{e.message ?? 'Unknown lineage analysis error'}</b>
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
