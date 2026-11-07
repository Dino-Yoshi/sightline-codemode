# MCPVision

> strace for Code Mode: see where every value in your agent's script came from and where it went, and block private data before it leaks

## The Problem

In Code Mode, the model writes one script that calls many tools instead of making individual tool calls across multiple round trips. This is fast and token-efficient, but it turns agent execution into a black box. Private data can easily leak across tools through generated code that nobody reads.

## What You See

### The lane graph
The main canvas arranges events into distinct horizontal lanes: YOU, MODEL, SCRIPT, and one row for each connected MCP server (`payroll`, `tracker`, `hr`). Time progresses from left to right across agent rounds. The graph visually proves that the model writes code and the code calls the tools.

### Click to trace
Click any node and everything it came from and everything it fed lights up; the rest of the run fades. The drawer lists the real values that flowed along that path (for example "total = 1,699,983 · from line 3 · private"), so the canvas itself stays clean.

### The Story panel
A plain-English narrative panel on the right explains the key milestones and decisions of the run step by step. Clicking any sentence in the story automatically focuses the canvas on that event and opens its detailed inspection drawer.

### The red blocked edge
When a tool call attempts to send private data to a public destination, MCPVision cuts the connection with a red dashed edge. The call is halted before leaving the runtime, and the detail drawer displays the exact policy rule and reason.

### The context boundary
The tinted MODEL lane tracks the exact tokens that entered model context versus tokens that stayed strictly inside the sandbox. This shows whether private records or untrusted prompt injections were exposed to the model or kept isolated.

### strace view
A toggle in the top bar switches the visual graph into a flat, chronological execution trace. This provides developers with a fast, familiar console log of every tool call, return value, policy decision, and error.

## The Demo

MCPVision includes two realistic demo tasks evaluated against three fixture MCP servers (`payroll`, `tracker`, and `hr`):

- **Run A: "Triage this week's open issues and send the October 2026 (2026-10) payroll total to HR. Do it in one script."**
  The agent fetches open tickets from the public issue tracker and reads 214 employee salary records from payroll. It aggregates the total salary expense inside the sandbox and posts the summary to HR. The context boundary proves that 214 private salary rows never entered model context. Although issue #42 contains an injected prompt instruction, the graph proves that private data never reached the public tracker.

- **Run B: "Post the October 2026 (2026-10) payroll total as a comment on issue #42 and send it to HR. Do it in one script."**
  The agent attempts an honest mistake: calculating the October payroll total and publishing it as a public comment on issue #42 while sending it to HR. MCPVision tracks the lineage of the comment body back to `payroll.get_salaries` and intercepts the call before it is transmitted. The allowed summary reaches HR, while the public comment is blocked:

  > `"message comes from payroll.get_salaries (private) and tracker is public, so the call was blocked before it was sent."`

## How It Works

```
task
  │
  ▼
Gemini on Vertex AI (gemini-3.7-flash)
  │
  ▼
Cloudflare @cloudflare/codemode (generates TypeScript script)
  │
  ▼
Node vm sandbox (executes script)
  │
  ▼
MCPVision tool wrapper (intercepts every tool call)
  │
  ├──► Static lineage analysis (TypeScript AST) + runtime values
  │
  ├──► Policy check (evaluates data sensitivity before transport)
  │      │
  │      ▼
  ├──► 3 fixture MCP servers over stdio (payroll [private] · tracker [public] · hr [private])
  │
  └──► Run events (JSONL stream over WebSocket) ──► Interactive UI
```

Lineage is computed by combining conservative static data-flow analysis over the generated TypeScript AST with the actual argument and result values intercepted at the tool wrapper.

### The Policy Rule

A value with **private** lineage cannot reach a **public** sink.

- **Unknown lineage counts as private** (fail-closed): if the static analyzer cannot fully resolve a data dependency, it treats the value as private.
- **Taint is tracked but never blocks alone**: untrusted text (such as prompt injections from external issues) is highlighted in pink and named in explanations, but it only blocks when combined with private data escaping to an untrusted public sink.

## Run It

### Prerequisites

- Node.js 22+
- A Google Cloud Platform (GCP) project with Vertex AI enabled
- Authenticated locally via `gcloud auth application-default login`

### Setup

1. Configure your environment:
   Create a `.env` file in the repository root (or copy from `.env.example`):
   ```bash
   GOOGLE_GENAI_USE_VERTEXAI=true
   GOOGLE_CLOUD_PROJECT=your-gcp-project-id
   GOOGLE_CLOUD_LOCATION=global
   GEMINI_MODEL=gemini-3.7-flash
   ```

2. Install dependencies:
   ```bash
   cd engine && npm install
   cd ../ui && npm install
   ```

3. Start the engine and UI:
   ```bash
   # Terminal 1: start the WebSocket server and agent runner
   cd engine && npx tsx src/agent.ts ws

   # Terminal 2: start the UI dev server
   cd ui && npx vite
   ```

4. Open `http://localhost:5173` in your browser.

> **Note:** Recorded runs (Run A, Run B, and the canonical run) can be loaded, stepped through, and inspected in the UI without any GCP credentials or live backend.

## Tests

The project is structured around two clean test seams:

- **Seam A (Observed Code Mode Execution):**
  Feeds fixed TypeScript scripts into the engine and asserts on static lineage extraction, fail-closed policy enforcement, context boundaries, and verification that blocked calls never reach the MCP server's stdio transport.
  ```bash
  cd engine && npm test
  ```

- **Seam B (Pure UI View Functions):**
  Tests the data transformation pipeline from JSONL event logs into graph nodes, lanes, edges, step indexes, lineage highlights, and plain-English Story sentences with pure functions without requiring a DOM.
  ```bash
  cd ui && npm test
  ```

## Honest Limits

- **Execution environment:** Generated scripts run in a Node `vm` context rather than Cloudflare's Workers sandbox, as Cloudflare's dynamic worker executor depends on Cloudflare Workers runtime bindings (`WorkerLoader`).
- **Static lineage:** Lineage is determined via static analysis of the generated code. When code structure cannot be resolved with certainty, it fails closed by treating values as private.
- **Implicit flows:** Control-flow dependencies (such as `if (secretValue === 42) { postPublic(); }`) are not tracked.
- **Custom agent loop:** We wrapped Cloudflare Code Mode inside our own agent loop to capture full prompt history, turn structure, and context boundaries.
- **Local fixtures:** The demo uses three local stdio fixture servers rather than remote network services.

## Credits

- **CaMeL (Google DeepMind):** For the core concept of value-level data tracking rather than step-level tracing.
- **Cloudflare Code Mode:** For the `@cloudflare/codemode` TypeScript code generation and tool wrapping model.
- We couldn't find a tool that does value-level lineage and policy enforcement for Code Mode scripts.
