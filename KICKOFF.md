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

## Step 1: start the four agents, one at a time, in this order

Rules:
- **One folder per agent.** Never open `ZeroToHero27` itself in any of them.
- **Paste the prompt exactly as written.** It already tells the agent which issue to do and
  which branch to use.
- Start the riskiest job first.

### 1A. Antigravity, Code Mode spike (start this first; it's the biggest risk)
1. Open Antigravity. Go to **File → Open Folder** and choose
   `~/Documents/prog/hacks/zth-agent`.
2. Open the Agent panel and pick a **Gemini** model. Paste:
   ```
   Do GitHub issue #2 in this repo (gh issue view 2). Read AGENTS.md and PROPOSAL.md first. Start with the Code Mode spike and report which runtime path you took within 30 minutes. Commit and push branch agent often. Stop and report at 1:30 PM.
   ```
3. ✅ You should see it read issue #2, then PROPOSAL.md.

### 1B. Codex, lineage and policy (a Terminal tab)
1. Open a **new Terminal tab** and paste this whole line:
   ```
   cd ~/Documents/prog/hacks/zth-codex && codex "Do GitHub issue #3 in this repo (gh issue view 3). Read AGENTS.md and PROPOSAL.md first. Test-first. Commit and push branch lineage often. Stop at 1:30 PM."
   ```
2. ✅ You should see Codex start and read issue #3. Approve its commands when it asks.

### 1C. Kiro, fixture servers and the tool wrapper
1. Open Kiro. Go to **File → Open Folder** and choose `~/Documents/prog/hacks/zth-kiro`.
2. In the chat, pick **Spec** mode if it asks (Vibe is fine too). Paste:
   ```
   Do GitHub issue #4 in this repo (gh issue view 4). Read AGENTS.md and PROPOSAL.md first. Stub lineage.ts and policy.ts with the interfaces in PROPOSAL §7 until branch lineage lands. Commit and push branch observer often. Stop at 1:30 PM.
   ```
3. ✅ You should see it read issue #4. If Spec mode writes a plan, approve it.

### 1D. Antigravity, the UI (a SECOND Antigravity window)
1. In Antigravity, go to **File → New Window**, then **File → Open Folder** and choose
   `~/Documents/prog/hacks/zth-ui`.
2. Open the Agent panel and pick **Gemini 3 Pro** (best at UI). Paste:
   ```
   Do GitHub issue #1 in this repo (gh issue view 1). Read AGENTS.md and PROPOSAL.md first. Use your browser to screenshot the UI against runs/fake-run.jsonl and check it against the must-ship list in PROPOSAL §6. Commit and push branch ui often. Stop and report at 1:30 PM.
   ```
3. ✅ You should see it read issue #1, then start building in `ui/`.

**Check that you got it right:** you should have 2 Antigravity windows (`zth-agent`, `zth-ui`),
1 Terminal tab running Codex (`zth-codex`), and 1 Kiro window (`zth-kiro`). If a window's title
says `ZeroToHero27`, close it, because that's the wrong folder.

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
