# Handoff: read this first (written 2026-11-07, 10:35 PT)

For the next Claude session (on the Mac) and any teammate. `PROPOSAL.md` is the build plan.
This file records the decisions made since, which take priority over the proposal where they
differ.

## Status

- **Idea locked:** MCPVision, "strace for Code Mode". It's a live graph of how data moves
  between the MCP tool calls of a Code Mode script.
- **No demo code exists yet.** Event rule: demo code gets written after 11:00. The mockups in
  `design/mockups/` are throwaway design references, not the app.
- The user's bar for originality is **"nobody has built this"**. These were rejected because
  they already exist:
  - prompt-injection benchmarks and scanners (promptfoo, AgentDojo, IPI-proxy);
  - A2A/MCP unifier gateways;
  - WebMCP scanners;
  - plain tracing (Langfuse, LangSmith, Phoenix).
- **Our differentiator:** Langfuse graphs *steps*. We graph *values*: where each argument came
  from and where each result went, inside one script. Never say "first". Say "we couldn't
  find".
- Name check: CodeVision and MCPTrace are taken on GitHub. MCPVision was free on GitHub, npm and
  PyPI.

## Decisions since PROPOSAL.md

1. **The layout is swimlanes, not the three-pane graph.** See `design/mockups/lanes.html` and
   `lanes-*.png`.
   - Rows: YOU, MODEL, SCRIPT, then one row per MCP server. Top to bottom is cause, left to
     right is time (Code Mode rounds).
   - The key point it must show: **the prompt and model never call tools. The model writes
     code, and the code calls tools.**
   - Edge meanings: asks/writes, code calls a tool, public data, private data (amber),
     influenced by untrusted text (pink dashed), blocked (red dashed).
2. **Clicking a node** traces it: upstream and downstream stay lit, everything else fades, and
   edges along the path show the actual values. It also **opens a detail drawer** (not built in
   the mockups yet):
   - **Tool call:** each argument with *where it came from* (the differentiator), the policy
     decision with its reason, timing, transport (stdio/HTTP), the raw MCP JSON-RPC, and buttons
     for trace back, jump to line, and replay to here.
   - **Value:** its contents, type, tokens, sandbox or model context, the chain it came from,
     and where it went.
   - **Model turn:** exactly what the model saw (token counts, untrusted parts highlighted)
     and the script it wrote.
   - **Script line:** the code, the values it read, and the calls it made.
3. **Signature features:**
   - *Blast radius* (everything an untrusted input touched, including decisions).
   - *Context boundary* (what the model saw versus what stayed in the sandbox, with token
     counts).
   - An *strace toggle* (the same run as a flat log).
   - Stretch: *what-if replay*.
4. **Visual polish comes last.** The user wants the visuals, UX, detail and graph to be the
   product, but the current style is "generic". Get structure and flow right first.

## How it hooks in (architecture)

MCPVision is a **Code Mode gateway**. The agent sees only `search_tools()` and `execute(code)`.
MCPVision runs the code in **our own Python-subset interpreter** (an `ast` whitelist, never
`exec`), tracks a provenance id on every value, and forwards each tool call to the real MCP
servers unchanged. Trace events stream to the UI over WebSocket. The JSONL contract is in
`PROPOSAL.md` §3.

Honest limits to state out loud:
- It uses a Python subset, not TypeScript Code Mode.
- In gateway mode we don't see the user's prompt. For the demo we run our own Gemini agent
  loop, so we do see it.

## Environment

- Gemini runs through **Vertex AI** (`google-genai`, `GOOGLE_GENAI_USE_VERTEXAI=true`, location
  `global`). See `.env.example`. Each machine has its own git-ignored `.env`, and
  `gcloud auth application-default login` must have been run on it.
- Model probe from earlier today: the cheap Flash-Lite tier followed injected instructions,
  and the 3.7/3.8 Flash tiers resisted all 29 attempts. The demo's poisoned issue may need
  tuning, so record good runs to JSONL for a recorded-mode fallback.
- `predocs/` is git-ignored and stays local to the Linux box. **The repo is public.** Never
  commit secrets or `predocs/`.

## Next steps (from 11:00)

1. Scaffold: `uv` (Python 3.13) for the backend; Vite + React + `@xyflow/react` + ELK for the
   UI.
2. Build the UI first, against a hand-written `fake-trace.jsonl` in the lane layout. In
   parallel: interpreter, then the MCP fixture servers (payroll on stdio, tracker on HTTP), then
   the Gemini planner.
3. Never cut: the lane graph, click-to-trace, the detail drawer, the red blocked edge, and the
   context boundary.
