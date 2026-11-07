# MCPVision

> **strace for Code Mode.** See where every value in your agent's script came from and where it went, and block private data before it leaks.

Built in one day at **Zero To Demo** (NemulAI × Hack District, 2026-11-07), Frontier track.

## The problem

In **Code Mode**, the model doesn't call tools one at a time. It writes one script that calls many tools at once. That's fast and saves tokens, but the script is a black box: your private data flows through code nobody reads, and nothing stops it from ending up somewhere public.

Tracing tools show you the *steps* an agent took. MCPVision shows you the *values*: where every argument came from, where every result went, what the model actually saw, and what stayed hidden from it.

## What you see

- **The lane graph.** One row for the model, one for the script, and one per MCP server. Time runs left to right, one column per action. The rows make one thing obvious: **the model never calls tools.** The model writes code, and the code calls tools.
- **Click to trace.** Click any value or call, and everything it came from and everything it fed lights up while the rest fades. The drawer walks the chain in plain words: `payroll.get_salaries` ↓ `pay` (line 2) ↓ `total` (line 3) ↓ this call's `body`.
- **The Story panel.** A plain-English, numbered account of the run, with a one-line verdict on top ("1 call blocked: private payroll data would have reached the public tracker"). Click a sentence to jump to its node.
- **The red blocked edge.** When private data heads for a public destination, the call is **not sent**. The drawer gives the reason in one sentence.
- **The context boundary.** How many tokens the model saw versus how many stayed inside the sandbox. In the demo, 214 private payroll rows are processed and **0 of them reach Gemini**.
- **Script pane sync.** Click a line of the generated code to jump to the node it produced, and replay highlights each line as it runs.
- **strace view.** The same run as a flat, colour-coded log. This is what you had before.

Replay runs at 0.25×, 0.5×, 1× or 2×, follows the newest node, and lets you step with ← / →. Long runs collapse uneventful rounds and add a minimap.

## The demo: three runs

| Run | What happens | What saves you |
|---|---|---|
| **Recorded live A**: "Triage this week's open issues and send the October 2026 payroll total to HR." | Issue #42 on the public tracker hides an instruction aimed at AI assistants. It reaches Gemini's context (marked UNTRUSTED). Gemini ignores it. | The model, and **the graph proves it**: nothing private went public. |
| **Recorded live B**: "Post the October 2026 payroll total as a comment on issue #42 and send it to HR." | An honest human mistake. Gemini does exactly what it was asked. | **MCPVision.** The comment is blocked before it's sent; the HR summary goes through. |
| **Simulated**: the injection succeeds | A hand-written run showing what happens if #42's hidden instruction works and the model tries to post payroll publicly. | **MCPVision.** Same block, and the reason notes the instruction came from #42, not from you. |

The real block reason from run B:

> message comes from payroll.get_salaries (private) and tracker is public, so the call was blocked before it was sent.

**The protection doesn't depend on the model behaving.**

## How it works

```
your task
  │
  ▼
Gemini (Vertex AI, gemini-3.7-flash)          ← only ever writes code
  │
  ▼
Cloudflare @cloudflare/codemode                ← turns the model's output into a TypeScript script
  │
  ▼
Node vm sandbox runs the script
  │  every tool call goes through the MCPVision wrapper:
  ├──► lineage: static data-flow over the generated TypeScript + the real runtime values
  ├──► policy check, BEFORE the call is forwarded
  ├──► 3 MCP servers over stdio: payroll (private) · tracker (public, untrusted) · hr (HR-only)
  └──► run events (JSONL) ──► WebSocket ──► UI
```

Gemini doesn't know MCPVision exists. MCPVision sits between the script and the MCP servers, so it sees every call the script makes.

### The policy: one rule

A value with **private** lineage can't reach a **public** sink.

- **Unknown lineage counts as private.** If the analyzer can't follow some code, it fails closed.
- **Untrusted is a label, not a block.** Everything from the public tracker is marked UNTRUSTED (pink) because anyone can write there. It's shown and explained, but it never blocks a call on its own.
- **We don't try to detect prompt injections.** We mark untrusted sources and track where every value flows. A clever injection can fool a detector. It can't change where the data came from.

## Run it

**Recorded runs need nothing but Node.** Live runs need Gemini on Vertex AI.

Prerequisites: Node.js 22+. For live runs, also a Google Cloud project with Vertex AI enabled, and `gcloud auth application-default login`.

```bash
cp .env.example .env              # live runs only: set GOOGLE_CLOUD_PROJECT
cd engine && npm install && cd ..
cd ui && npm install && cd ..

# Terminal 1 (live runs only): the engine and WebSocket server
cd engine && npx tsx src/agent.ts ws

# Terminal 2: the UI
cd ui && npx vite
```

Open http://localhost:5173 and pick a run.

## Tests

Two seams, no LLM in either:

- **Seam A, observed execution** (`cd engine && npm test`): fixed generated scripts run against the real fixture MCP servers. The tests assert that `total` traces back to `get_salaries`, that a private → public call is blocked and **the tracker receives nothing**, that code the analyzer can't follow fails closed without crashing, and that payroll rows never reach the model.
- **Seam B, run to screen** (`cd ui && npm test`): pure functions turn a recorded run into lanes, nodes, edges, the trace and the Story, including time-ordered columns and a check that no edge crosses a node.

## Honest limits

- **The sandbox is Node `vm`, not Cloudflare's.** We use Cloudflare's real `codemode` code generation, but its executor needs the Cloudflare Workers runtime, so the script runs in Node's `vm` behind our wrapper.
- **Lineage is static analysis** of the real generated code, plus runtime values. It fails closed when unsure.
- **Implicit flows aren't tracked** (`if (secret > 0) post("yes")`).
- **Our own agent loop** wraps Code Mode, so we can show every prompt and model turn.
- **Fixture servers**, not real payroll or issue trackers. The simulated run is hand-written and labelled as such in the UI.

## Credits

- **CaMeL** (Google DeepMind) for the idea of tracking values rather than steps.
- **Cloudflare Code Mode** (`@cloudflare/codemode`).
- We couldn't find a tool that does value-level lineage and pre-send blocking for Code Mode scripts.
