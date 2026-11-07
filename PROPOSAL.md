# MCPVision: strace for Code Mode

Zero to Demo, 2026-11-07. Track: Frontier. Gemini on Vertex. **No demo code before 11:00.**

> Code Mode lets an AI write one script that calls dozens of MCP tools at once. It's fast, but
> you can't see what happened inside. MCPVision is strace for Code Mode, except it shows
> **how the data moved**, not just the calls.

**The UI is the product.** Every hour of engine work exists to feed the graph.

## 1. Developer goals → what the UI answers

| The developer asks | The UI answers with |
|---|---|
| "What did my agent's script actually do?" | A graph that builds live: one node per tool call, grouped by MCP server |
| "Where did this value come from?" | Click any value: its **upstream lineage** lights up back to the tool that produced it |
| "Where did this data end up?" | Same click: **downstream** edges light up to every call it reached |
| "Why did that call fail or get blocked?" | A red edge, cut, with a plain-English reason in the inspector |
| "Which line of the script did this?" | Selecting a node highlights the script line, and selecting a line highlights its nodes |
| "Was Code Mode worth it?" | A counter of tokens and round trips, Code Mode against classic tool calling |
| "Just give me the raw log" | An **strace view** toggle that shows the flat, ordered call log, synced with the graph |

## 2. Screen layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Task: "Summarize open issues and post payroll totals to HR"   [Run] [⟲]    │
├──────────────┬──────────────────────────────────────────┬───────────────────┤
│ SCRIPT       │  GRAPH (React Flow)                      │ INSPECTOR         │
│ (generated)  │   ┌payroll (local)┐     ┌tracker (remote)┐│ value: "$182,400" │
│ 1 issues=…   │   │ get_salaries ●──────╳ post_comment   ││ from: payroll.    │
│ 2 pay=…  ◄───┼── │               \     │ list_issues ●  ││   get_salaries    │
│ 3 total=…    │   └────────────────\────└───────│────────┘│ via: sum() L3     │
│ 4 post(…)    │                     ●─ hr.post_summary   ││ BLOCKED: private  │
│              │                                          ││ payroll → public  │
├──────────────┴──────────────────────────────────────────┴───────────────────┤
│ ▶ timeline scrubber ──●─────────────  │ Code Mode: 1 trip, 2.1k tok vs 9 / 14k │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Visual language (decide once, keep consistent):**
- **Nodes:** tool calls are cards with the server's color and a `local`/`remote` badge. Values
  are small chips that are **collapsed into edges by default** and expand on click, so the graph
  doesn't turn into a hairball.
- **Edges:** solid lines are data flow and dashed lines are control dependence ("this `if`
  depended on X"). The edge label is a preview of the value.
- **Color = sensitivity:** neutral for public, amber for private, red for a flow that broke policy.
- **Motion:** nodes appear in execution order (that's the strace feel), and edges animate once
  when data passes through them. The scrubber replays any run.
- **Dark theme first.** It's projected on stage.

## 3. How it works

```
task ─► Gemini (planner) ─► Python-subset script ─► OUR INTERPRETER ─► MCP servers
                                                       │  every value carries
                                                       │  {id, source, sensitivity}
                                                       ▼
                                             trace events (JSONL) ─► WebSocket ─► UI
```

- **Interpreter:** a Python `ast` whitelist (assign, literals, f-strings, arithmetic,
  comparisons, `if`, `for`, `len`/`sum`/`sorted`, and tool calls). It never calls `exec`. Each
  value has an id, and each operation records which value ids went in. That record is the graph.
- **MCP:** two fixture servers using the Python `mcp` SDK. `payroll` (private) runs locally over
  stdio. `tracker` (public, with one poisoned issue) runs over HTTP to stand in for a remote
  server. If it costs time, run both locally.
- **Policy:** the only rule is that a value with private lineage can't reach a public sink.
  When it tries, emit a `blocked` event. The graph is the point and the block is one thing it
  shows.
- **Efficiency counter:** run the same task through a classic tool-calling loop and count
  round trips and tokens. Record the result once, then display it.

### Trace event contract (agree on this first so UI and engine build in parallel)

```json
{"t": 12, "type": "call",    "id": "c3", "server": "payroll", "tool": "get_salaries", "line": 2, "args": ["v1"], "remote": false}
{"t": 13, "type": "value",   "id": "v4", "from": ["c3"], "op": "result", "preview": "[…12 rows]", "sensitivity": "private"}
{"t": 14, "type": "value",   "id": "v5", "from": ["v4"], "op": "sum", "line": 3, "preview": "$182,400", "sensitivity": "private"}
{"t": 15, "type": "blocked", "id": "c4", "server": "tracker", "tool": "post_comment", "line": 4, "args": ["v5"], "reason": "Payroll data (private) can't go to the public tracker."}
{"t": 16, "type": "summary", "codemode": {"trips": 1, "tokens": 2100}, "classic": {"trips": 9, "tokens": 14000}}
```

## 4. Build plan (UI-first, two tracks in parallel)

| Block | UI track (priority) | Engine track |
|---|---|---|
| 0:00–0:30 | Scaffold Vite + React + `@xyflow/react` + ELK layout; **hand-write `fake-trace.jsonl`** | `uv` project; check **Langfuse agent-graph view** (a novelty risk, 15 min) |
| 0:30–2:30 | Graph from fake trace: nodes, server groups, edges, colors, appear-in-order | Interpreter + value ids + lineage events; unit tests |
| 2:30–4:00 | Inspector + lineage highlight + script-line sync | MCP fixture servers; the interpreter calls them for real |
| 4:00–5:00 | Scrubber, strace toggle, efficiency counter | Gemini planner writes the script; WebSocket streams events |
| 5:00–6:30 | **Connect to live events.** Polish: motion, spacing, empty and error states | Poisoned issue → blocked event; record 3 good runs as JSONL |
| 6:30–end | Recorded-mode toggle, rehearse 3×, README, **submit early** | — |

**Never cut:** the live graph, click-for-lineage, the red cut edge, and the script-line sync.
**Cut in this order:** remote transport → efficiency counter (show a slide instead) → scrubber →
`for` loops in the interpreter.

## 5. Risks, checked against ourselves

- **"Langfuse/LangSmith/Phoenix already do this."** Checked: Langfuse agent graphs (ELK layout, aggregated/expanded modes) draw *steps* (observations). We draw
  *values* and how they connect inside one Code Mode script. Verify in the first 30 minutes. If
  Langfuse shows value lineage, change the claim before building.
- **"Real Code Mode is TypeScript."** True. We use a Python subset because that's what lets us
  trace every value in 10 hours. Anthropic's programmatic tool calling runs Python. Say it out
  loud.
- **Hairball graph.** Collapse values into edges by default and keep demo scripts to about 10
  lines.
- **Gemini writes an unsupported script.** Show "unsupported construct at line N" as a node,
  never a crash. Recorded mode covers the demo.
- **Novelty claim:** "We couldn't find a tool that shows data flow inside Code Mode." Never say
  "first". Credit CaMeL for the value-tracking idea.

## 6. The 3-minute demo

1. (30s) "Code Mode is taking off: one script, dozens of tool calls. But it's a black box."
2. (60s) Run it. The graph builds live, strace-style. Click the salary total and its lineage
   lights up back to `payroll.get_salaries`.
3. (40s) The poisoned issue: one red edge appears and is cut. The inspector explains why, and
   the script line highlights.
4. (30s) Toggle the strace view to show the same run as a flat log. "This is what you had before."
5. (20s) The efficiency counter, then credits and the honest limits.
