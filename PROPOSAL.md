# MCPVision: strace for Code Mode

The single source of truth for what we're building. If something isn't here, it's out of scope.
Zero To Demo, 2026-11-07. Track: **Frontier**. Solo builder plus agents. **Submit by 3:30 PM**
(hard close 5:30 PM).

## 1. What it is

**Code Mode:** instead of calling tools one turn at a time, the model writes one script that calls
many MCP tools. It's fast, but you can't see what happened inside the script.

**MCPVision** is a Code Mode gateway that shows **how the data moved**: where every argument
came from, where every result went, what the model saw, and what stayed hidden from it. Langfuse
and similar tools graph *steps*. We graph *values*. Never say "first". Say "we couldn't find a
tool that does this". Credit CaMeL for the value-tracking idea.

| The developer asks | MCPVision answers with |
|---|---|
| What did my agent's script actually do? | A lane graph that builds live, step by step |
| Where did this value come from, and where did it go? | Click it: the path lights up, and the edges show the real values |
| Why was this call blocked? | A red dashed edge, plus a plain-English reason in the drawer |
| Which line of the script did this? | The script pane and the graph highlight each other |
| What did the model actually see? | The context boundary: model tokens vs. sandbox-only tokens |
| Just give me the log | The strace toggle shows the same run as a flat list |

## 2. Screen (structure locked, look NOT locked)

The structure comes from `design/mockups/hybrid.html`. **Don't copy its look.** It's cluttered.

- **Top bar:** the task, Run, and a Graph/strace toggle.
- **Left: script pane.** The code Gemini wrote, grouped by round. Clicking a line selects its
  node.
- **Center: lane canvas.** Rows top to bottom: YOU, MODEL, SCRIPT, then one row per MCP server.
  Left to right is time (rounds).
  - The canvas must make clear that the model never calls tools. The model writes code, and the
    code calls tools.
  - Edges: asks/writes (grey), code calls a tool (blue), public data (slate), private data
    (amber), influenced by untrusted text (pink dashed), blocked (red dashed).
  - Context boundary: the MODEL lane is tinted and shows a token count. A note under it gives the
    sandbox-only tokens.
- **Right: detail drawer.** It opens when you click a node. It has a different variant for each
  node type:
  - **Tool call:** each argument and *where it came from* (clickable), the policy decision,
    timing, transport, and the raw JSON-RPC.
  - **Model turn:** what the model saw (tokens, with untrusted parts highlighted) and the script
    it wrote.
  - **Script line:** the code, the values it read, and the calls it made.
- **Bottom: replay bar.** Shows the step ticks. Step through with ←/→.
- **Trace modes:** *Lineage* lights everything upstream and downstream of the selection. *Blast
  radius* lights only downstream.

**UX rules (the fix for the clutter):**
1. When nothing is selected, show only the lanes, the nodes and the edges, with no edge labels.
   Show labels only along a traced path, and there they show the real values.
2. The drawer opens with one-sentence answers, such as "From payroll.get_salaries via line 7".
   The raw JSON-RPC and the token tables start collapsed.
3. Use one row of controls. The legend starts collapsed.
4. Dark theme first, because it's projected on stage.

## 3. How it works

**DECIDED (11:40): we use the REAL Code Mode, Cloudflare's `codemode` (TypeScript), driven by
Gemini.** We don't run our own interpreter. MCPVision *watches* real Code Mode from outside.

```
task ─► Gemini (Vertex, via AI SDK) ─► real Cloudflare Code Mode writes TS ─► sandbox runs it
                                                     │ every tool call goes through OUR wrapper
                                                     ├─► policy check ─► MCP servers (payroll · tracker · hr)
                                                     └─► run events (JSONL) ─► WebSocket ─► UI
lineage = static data-flow over the real generated TS (TypeScript compiler API)
        + the actual argument and result values seen at the wrapper
```

- **Engine:** a Node and TypeScript project. Gemini goes through the AI SDK's Google Vertex
  provider, using the **stronger Flash model** (`GEMINI_MODEL`), never Flash-Lite. The agent loop
  is ours, so we can see the prompt and every model turn.
- **Code Mode spike (first 30 min, decides the runtime):** get Cloudflare's `codemode` running
  locally with Gemini and the three fixture MCP servers.
  - **Fallback if it isn't running by 12:30:** keep Code Mode's real code generation, but run
    the generated code in Node `vm` with the same tool wrapper. Say this on stage.
- **Tool wrapper (the observer):** every MCP tool that Code Mode can call is wrapped. Each call
  emits `call` and `value` events with the real arguments, results, timing and JSON-RPC. The
  policy runs **before** the call is forwarded.
- **Lineage:** parse the generated TS and trace data flow between variables (`total = sum(pay)`
  means `total` comes from `pay`, which comes from `payroll.get_salaries`). Map each call site in
  the code to the wrapper call that happened at runtime, by order and tool name.
  - Code the analyzer can't follow produces an `error` or "unknown lineage" node, never a crash.
  - **Unknown lineage counts as private if any private value could have reached it**
    (fail-closed).
- **Context boundary:** what Code Mode returns to the model, counted in tokens, compared with
  everything the tools returned.
- **Fixture servers** (TypeScript MCP SDK, so the whole engine uses one language):
  - `payroll`: local, stdio, private.
  - `tracker`: HTTP, public and untrusted. Issue #42 hides an instruction aimed at AI
    assistants.
  - `hr`: local, stdio, HR-only sink.

### Policy: one rule

A value with **private** lineage can't reach a **public** sink. When it tries, the call is
**not sent**, and a `blocked` event is emitted with a reason.

Taint (influenced by untrusted text) is shown in **pink** and named in the block reason, but it
**never blocks a call on its own**.

### Run format (JSONL, one event per line)

The canonical example is `runs/fake-run.jsonl`. The UI is built against it.

| type | key fields | lane |
|---|---|---|
| `prompt` | `id, text, tokens` | YOU |
| `model_turn` | `id, round, saw:[{label, ref?, tokens, untrusted}], script:[{n, code}], influenced_by:[ids]` | MODEL |
| `call` | `id, server, tool, line, transport, args:{name:{preview, from:[ids]}}, rpc, ms` | server lane |
| `value` | `id, from:[ids], op, line, preview, tokens, sensitivity, taint, in_model_context` | SCRIPT (or server lane for `op:"result"`) |
| `blocked` | like `call`, plus `rule, reason`, no `ms` | server lane, red |
| `error` | `line, message` | SCRIPT, as an error node |
| `summary` | `model_tokens, sandbox_tokens, rounds` | footer |

Every event has `t` (ms since start) and `step` (the replay tick). `sensitivity` is
`public|private`. `taint` is `trusted|untrusted`. These are separate axes: issue #42 is public
*and* untrusted.

## 4. Demo (about 3 minutes, two recorded runs as a fallback)

1. "Code Mode: one script, dozens of tool calls, and it's a black box."
2. **Run A: "Triage issues, send payroll total to HR."** The graph builds live. Click the payroll
   total, and its lineage lights back to `payroll.get_salaries`. Show the context boundary: 214
   private rows, 0 tokens to the model. Issue #42 reached the model's context. **If Flash ignored
   it, the graph proves that it did.**
3. **Run B: the honest mistake. "Post the October payroll total on issue #42 and send it to
   HR."** The red edge is cut. The drawer says: private → public, blocked before it was sent.
   This protection doesn't depend on the model behaving.
4. Toggle strace: "This is what you had before."
5. Honest limits: lineage is worked out from the real generated code (static analysis, which is
   fail-closed when unsure), and we use our own agent loop.

## 5. Tests: two seams

- **Seam A, observed Code Mode execution:** give the engine a *fixed generated script* (TS text,
  so no LLM is involved) plus the real fixture MCP servers. Each test asserts on what goes back to
  the model *and* on the recorded run. Required cases:
  - `total` has private lineage back to `get_salaries`.
  - A private → public call is blocked, and the tracker fixture **received nothing**.
  - Code the analyzer can't follow produces an `error` or unknown-lineage node, is fail-closed,
    and doesn't crash.
  - Payroll rows never appear in what goes back to the model.
- **Seam B, the run turned into the screen (pure functions, no DOM):** `view(run)` builds lanes,
  nodes, edges and steps. `inspect(view, id, mode)` returns the lit set, the edge labels and the
  drawer content. Required cases:
  - Lineage and blast radius light the right sets.
  - The drawer shows each argument's source.
  - Stepping hides later nodes.
  - An error event renders as an error node.
- The Gemini planner is **not** a test seam. Cover it with recorded runs and rehearsal.

## 6. Scope and cuts

**Must ship:** the lane graph, click to trace, the drawer (the tool-call variant at minimum), the
red blocked edge, the context boundary, and script-line sync.

**Drop in this order:**
1. HTTP transport (run everything on stdio)
2. What-if replay
3. The efficiency counter
4. Blast radius
5. The replay bar
6. The strace toggle
7. The model-turn and script-line drawer variants
8. Lineage through loops (mark it unknown and fail closed instead)

**Out of scope:** our own interpreter, Anthropic programmatic tool calling, gateway-only mode
without our agent loop, auth, persistence, and more than three fixture servers.

**Stretch (after 3:00, only if the core is done):** Firecrawl as a real remote, untrusted MCP
source.

## 7. Repo layout and ownership (one worktree and branch per agent)

| Path | Owner | Contents |
|---|---|---|
| `ui/` | Antigravity agent 1 | Vite + React + TypeScript. Seam B functions plus their tests |
| `engine/src/lineage.ts`, `policy.ts` | Codex | Static lineage over the generated TS, and the policy, with unit tests |
| `engine/src/observer.ts`, `engine/fixtures/` | Kiro | Tool wrapper, fixture MCP servers, seam A tests |
| `engine/src/agent.ts` | Antigravity agent 2 | Code Mode spike, the Gemini loop, the two demo tasks, the WebSocket |
| `runs/` | shared | `fake-run.jsonl` and the recorded demo runs |

`engine/` is a single Node and TypeScript project (npm; pnpm is not installed).

**Interfaces** (agree on these, then build them in parallel):

```ts
// Codex: lineage.ts. Pure, with no I/O.
analyze(code: string): { sites: CallSite[]; deps: Record<string /*var*/, string[] /*vars or site ids*/>; errors: {line:number; message:string}[] }
// Codex: policy.ts. Pure.
check(argLineage: Lineage, sink: ServerPolicy): { allow: true } | { allow: false; rule: string; reason: string }
// Kiro: observer.ts. Wraps the MCP tools that Code Mode calls.
wrapTools(clients: McpClients, servers: Record<string, ServerPolicy>, analysis: Analysis, emit: (e: RunEvent) => void): CodeModeTools
type ServerPolicy = { source: "public"|"private"; sink: "public"|"private"; taint: "trusted"|"untrusted" }
```

## 8. Risks

- **Langfuse might already show value lineage.** As far as we checked, it graphs observations
  (steps). If anyone finds value lineage there, change the claim.
- **Gemini writes code outside the subset.** It becomes an `error` node, never a crash. Recorded
  runs cover the demo.
- **Hairball graph.** Keep the scripts to about 10 lines, and show no labels until something is
  selected.
