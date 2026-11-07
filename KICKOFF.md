# Kickoff: start every agent in about 2 minutes

## Step 0, once (Terminal, in the repo)

Each agent gets its own folder and branch, so the agents can't overwrite each other's work:

```bash
cd ~/Documents/prog/hacks/ZeroToHero27 && git pull
git worktree add ../zth-ui     -b ui
git worktree add ../zth-agent  -b agent
git worktree add ../zth-codex  -b lineage
git worktree add ../zth-kiro   -b observer
for d in ../zth-agent ../zth-codex ../zth-kiro; do cp .env $d/; done
```

## Step 1, at 11:45: start all four at once

| # | Open this folder | In | Paste this prompt |
|---|---|---|---|
| 1 | `../zth-ui` | **Antigravity**, Agent Manager, agent 1 (Gemini 3 Pro or Claude) | `Do GitHub issue #1 in this repo (gh issue view 1). Read AGENTS.md and PROPOSAL.md first. Use your browser to screenshot the UI against runs/fake-run.jsonl and check it against the must-ship list in PROPOSAL §6. Commit and push branch ui often. Stop and report at 1:30 PM.` |
| 2 | `../zth-agent` | **Antigravity**, Agent Manager, agent 2 | `Do GitHub issue #2 in this repo (gh issue view 2). Read AGENTS.md and PROPOSAL.md first. Start with the Code Mode spike and report which runtime path you took within 30 minutes. Commit and push branch agent often. Stop and report at 1:30 PM.` |
| 3 | `../zth-codex` | **Terminal**: `cd ../zth-codex && codex` | `Do GitHub issue #3 in this repo (gh issue view 3). Read AGENTS.md and PROPOSAL.md first. Test-first. Commit and push branch lineage often. Stop at 1:30 PM.` |
| 4 | `../zth-kiro` | **Kiro**, in Spec mode | `Do GitHub issue #4 in this repo (gh issue view 4). Read AGENTS.md and PROPOSAL.md first. Stub lineage.ts and policy.ts with the interfaces in PROPOSAL §7 until branch lineage lands. Commit and push branch observer often. Stop at 1:30 PM.` |

**Your job while they run:** check in about every 30 minutes. If an agent is stuck for more than
15 minutes, give its issue to Codex in a new terminal:
`codex "Take over GitHub issue #N; read its comments and the branch first."`

## Step 2, the later prompts (Antigravity, in the main repo folder)

| When | Paste this prompt |
|---|---|
| **1:30** | `Do GitHub issue #5: merge branches ui, agent, lineage and observer into main, then get a live run A and run B showing in the UI. Verify in your browser.` |
| **2:15** | `Do GitHub issue #6 with me: declutter the UI using the PROPOSAL §2 UX rules. Show me screenshots and wait for my OK on each change.` |
| **3:00** | `Do GitHub issue #7: record runs A and B, add the recorded-mode toggle, and write the README. Push to main.` |
| **3:30** | **You: submit on BuilderBase.** Then use the buffer for fixes, 3 rehearsals, and the Firecrawl stretch. |

**If a step runs late:** cut using PROPOSAL §6 instead of moving the times.
