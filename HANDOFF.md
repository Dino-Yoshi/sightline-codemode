# Handoff: status only

**`PROPOSAL.md` is the spec. `README.md` is the public description.** This file only tracks status.

## Status: submitted (2026-11-07, Zero To Demo, Frontier track)

- **Submitted on BuilderBase:** the repo (github.com/Dino-Yoshi/sightline-codemode), a 64-second
  demo video, the description and a two-slide pitch deck.
- **Product name:** SightLine (formerly MCPVision), "strace for Code Mode".
- **`main` is the submitted version.** The UI was frozen for the demo; tags `demo-freeze` and
  `demo-safe-1410` mark known-good states.

## What works

- Gemini (Vertex AI, `gemini-3.7-flash`) writes scripts with Cloudflare's real `@cloudflare/codemode`
  code generation.
- The scripts run in a Node `vm` sandbox. Every tool call goes through the SightLine wrapper: lineage
  (static data-flow over the generated TypeScript plus runtime values), then the policy check before
  forwarding, then three fixture MCP servers over stdio (payroll, tracker, hr).
- One rule: private lineage can't reach a public sink. Unknown lineage counts as private. Untrusted
  text is labelled but never blocks on its own.
- The UI shows time-ordered lanes, click to trace, the Story panel, the drawer, strace, replay at
  0.25–2×, follow, collapsible rounds and a minimap, plus live runs over a WebSocket.
- Runs: `runs/run-a.jsonl` and `runs/run-b.jsonl` are recorded live Gemini runs.
  `runs/fake-run.jsonl` is a hand-written simulated run, labelled as such in the UI.
- Tests: engine 26 (seam A plus unit tests), UI 43 (seam B plus component tests).

## Known limits and next steps

- **Real Cloudflare executor:** `DynamicWorkerExecutor` needs the Cloudflare Workers runtime
  (`WorkerLoader` binding). Two time-boxed attempts to run it locally through workerd/Miniflare
  produced nothing, so we stayed on Node `vm` as PROPOSAL §3 planned. Next step: a Miniflare worker
  with a `worker_loaders` binding that forwards tool calls back to the Node wrapper.
- **Live runs vary:** Gemini writes a different script each time, and run A often uses all 4 rounds.
  Present the recorded runs and do one live B.
- **The "hidden instruction" quote is a text heuristic,** not an injection detector.
- **Brand spacing:** the header renders "Sight Line" with a gap. It's cosmetic and was left alone
  for the demo.

## Environment

- Each machine needs its own git-ignored `.env` (see `.env.example`) and
  `gcloud auth application-default login`.
- To run: `cd engine && npx tsx src/agent.ts ws` and `cd ui && npx vite`, then open
  http://localhost:5173. Recorded runs need no credentials.
- SerpAPI and Firecrawl accounts are linked to the user's GitHub. They're not in `.env`.
- **The repo is public.** Never commit `.env` or `predocs/`.
