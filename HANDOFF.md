# Handoff: status only

**`PROPOSAL.md` is the spec.** This file only tracks status, the environment and the schedule.
**To start the agents, follow `KICKOFF.md`.**

## Status (updated 2026-11-07, around 11:30)

- The spec is locked in `PROPOSAL.md`. The structure is locked as `design/mockups/hybrid.html`,
  but its look is not.
- The build issues are on GitHub, labelled `ready-for-agent`.
- `runs/fake-run.jsonl` is the canonical example run. The UI is built against it.
- **Code Mode runtime decision (11:50)**: Cloudflare's `@cloudflare/codemode` `DynamicWorkerExecutor` requires Cloudflare Workers dynamic dispatch (`WorkerLoader` binding) and `cloudflare:workers` runtime primitives not present in local Node. Per `PROPOSAL.md` §3 and GitHub issue #2 fallback, we took the **Node `vm` runtime path**: real Code Mode prompt and TypeScript/JavaScript code generation driven by Gemini (`gemini-3.7-flash` via Vertex AI), with execution of the generated code inside a Node `vm` sandbox via the tool wrapper.

## Schedule (solo with agents; submit at 3:30, hard close 5:30)

| When | Where | Job |
|---|---|---|
| 11:45 → 1:30 | Antigravity agent 1 · Antigravity agent 2 · Codex · Kiro | UI · planner · interpreter and policy · gateway and fixtures (in parallel) |
| 1:30 → 2:15 | Antigravity | Merge the branches; a live run streams into the UI |
| 2:15 → 3:00 | Antigravity, with you | Clean up the look |
| 3:00 → 3:30 | Antigravity agent 2 | Record runs A and B, write the README |
| 3:30 | You | **Submit on BuilderBase** |
| 3:30 → 5:30 | You | Buffer: fixes, 3 rehearsals, Firecrawl stretch |

If a build runs past its slot, cut using the drop order in `PROPOSAL.md` §6 rather than moving
the times. If an agent stalls, Codex takes over its issue.

## Environment

- Gemini runs on Vertex AI (`google-genai`, `GOOGLE_GENAI_USE_VERTEXAI=true`, location `global`,
  `GEMINI_MODEL=gemini-3.7-flash`). Each machine needs its own git-ignored `.env` and a
  `gcloud auth application-default login`. Both were verified working on the Mac at 10:45.
- SerpAPI and Firecrawl accounts are linked to the user's GitHub. They're not in `.env` yet.
- **The repo is public.** Never commit `.env` or `predocs/`.
