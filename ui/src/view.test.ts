import { describe, it, expect } from 'vitest';
import {
  parseRun,
  view,
  inspect,
  story,
  getRoundSummary,
  getInitialCollapsedRounds,
  buildLineageChains,
} from './view';
import fakeRunText from '../../runs/fake-run.jsonl?raw';
import runAText from '../../runs/run-a.jsonl?raw';
import runBText from '../../runs/run-b.jsonl?raw';

const fakeEvents = parseRun(fakeRunText);
const vFake = view(fakeEvents);
const runAEvents = parseRun(runAText);
const vRunA = view(runAEvents);
const runBEvents = parseRun(runBText);
const vRunB = view(runBEvents);

describe('Seam B: run view and inspection (Polish Round 5)', () => {
  it('G1 Seam B: getRoundSummary formats round summaries accurately', () => {
    // Fake run Round 1
    const r1 = getRoundSummary(vFake, 1);
    expect(r1.round).toBe(1);
    expect(r1.untrustedCount).toBe(2);
    expect(r1.hasSensitive).toBe(true);
    expect(r1.label).toContain('Round 1');
    expect(r1.label).toContain('2 untrusted');

    // Fake run Round 2
    const r2 = getRoundSummary(vFake, 2);
    expect(r2.round).toBe(2);
    expect(r2.callCount).toBe(3);
    expect(r2.blockedCount).toBe(1);
    expect(r2.privateCount).toBe(2);
    expect(r2.hasSensitive).toBe(true);
  });

  it('G1 Seam B: getInitialCollapsedRounds keeps runs <= 3 rounds expanded, collapses non-sensitive rounds in runs > 3 rounds', () => {
    // Fake run has 2 rounds: starts with 0 collapsed rounds
    const fakeCollapsed = getInitialCollapsedRounds(vFake);
    expect(fakeCollapsed.size).toBe(0);

    // Run B has 2 rounds: starts with 0 collapsed rounds
    const bCollapsed = getInitialCollapsedRounds(vRunB);
    expect(bCollapsed.size).toBe(0);

    // Synthetic 4-round run where Round 3 has only public operations
    const fourRoundRun = [
      { type: 'prompt', text: 'Task', step: 1 },
      { type: 'model_turn', id: 'm1', round: 1, step: 2 },
      { type: 'call', id: 'c1', server: 'payroll', tool: 'get_salaries', sensitivity: 'private', step: 3 },
      { type: 'model_turn', id: 'm2', round: 2, step: 4 },
      { type: 'call', id: 'c2', server: 'tracker', tool: 'list_issues', taint: 'untrusted', step: 5 },
      { type: 'model_turn', id: 'm3', round: 3, step: 6 },
      { type: 'call', id: 'c3', server: 'calculator', tool: 'add', sensitivity: 'public', step: 7 },
      { type: 'model_turn', id: 'm4', round: 4, step: 8 },
      { type: 'blocked', id: 'c4', server: 'public', tool: 'post', rule: 'private→public', step: 9 },
    ];
    const vFour = view(fourRoundRun as any);
    const fourCollapsed = getInitialCollapsedRounds(vFour);

    // Round 3 has no private, blocked, or untrusted nodes -> starts collapsed
    expect(fourCollapsed.has(3)).toBe(true);
    // Rounds 1, 2, 4 have sensitive nodes -> stay expanded
    expect(fourCollapsed.has(1)).toBe(false);
    expect(fourCollapsed.has(2)).toBe(false);
    expect(fourCollapsed.has(4)).toBe(false);
  });

  it('G4: Untrusted reason is not truncated with ellipsis', () => {
    const x1Node = vFake.nodes.find((n) => n.id === 'x1');
    expect(x1Node).toBeDefined();
    expect(x1Node?.chip).toBe('UNTRUSTED');
    expect(x1Node?.untrustedReason).toBeDefined();
    expect(x1Node?.untrustedReason).not.toContain('…');
    expect(x1Node?.untrustedReason).toContain('Issue #42 hides an instruction');
  });

  it('G5: buildLineageChains produces top-to-bottom vertical chains from source to target call', () => {
    // In fake run, blocked call c4 has arguments that trace back to payroll and tracker
    const c4Chains = buildLineageChains(vFake, 'c4');
    expect(c4Chains.length).toBeGreaterThan(0);

    // One chain should start at payroll.get_salaries and lead to this call: body
    const payrollChain = c4Chains.find((chain) =>
      chain.some((step) => step.label.includes('payroll.get_salaries') || step.label.includes('Read payroll')),
    );
    expect(payrollChain).toBeDefined();

    // The last step in chain is target call
    const lastStep = payrollChain![payrollChain!.length - 1];
    expect(lastStep.isTarget).toBe(true);
    expect(lastStep.label).toContain('this call: body');
  });
  it('parses JSONL run into events and creates structured view without YOU lane (S3)', () => {
    expect(vFake.nodes.length).toBeGreaterThan(0);
    expect(vFake.edges.length).toBeGreaterThan(0);
    // S3: No YOU lane, only lanes that have nodes
    expect(vFake.lanes).toEqual(['MODEL', 'SCRIPT', 'tracker', 'payroll', 'hr']);
    expect(vFake.steps).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(vFake.summary).toBeDefined();
    expect(vFake.summary?.model_tokens).toBe(920);
    expect(vFake.summary?.sandbox_tokens).toBe(15060);
  });

  it('S1: Never emits a node per script line in either default or showEveryStep mode', () => {
    // Proves view() never emits kind === 'script' or nodes like 'line-M2-3'
    expect(vFake.nodes.some((n) => n.kind as string === 'script')).toBe(false);
    expect(vRunA.nodes.some((n) => n.kind as string === 'script')).toBe(false);
    expect(vRunB.nodes.some((n) => n.kind as string === 'script')).toBe(false);

    const fullFake = view(fakeEvents, { showEveryStep: true });
    expect(fullFake.nodes.some((n) => n.kind as string === 'script')).toBe(false);
    expect(fullFake.nodes.some((n) => n.id.startsWith('line-'))).toBe(false);

    const fullRunA = view(runAEvents, { showEveryStep: true });
    expect(fullRunA.nodes.some((n) => n.kind as string === 'script')).toBe(false);
    expect(fullRunA.nodes.some((n) => n.id.startsWith('line-'))).toBe(false);
  });

  it('S1: Titles SCRIPT lane values by meaning with their line number', () => {
    // SCRIPT lane holds only values with line
    const reduceValue = vFake.nodes.find((n) => n.id === 'v4');
    expect(reduceValue).toBeDefined();
    expect(reduceValue?.title).toBe('total = 1,284,600 · line 4');
    expect(reduceValue?.chip).toBe('PRIVATE');

    const filterValue = vFake.nodes.find((n) => n.id === 'v2');
    expect(filterValue).toBeDefined();
    expect(filterValue?.title).toBe('urgent issues (3) · line 2');
    expect(filterValue?.chip).toBe('UNTRUSTED');
  });

  it('S6: Formats call signatures and blocked reasons on call/blocked nodes', () => {
    // Blocked tracker call
    const blockedNode = vFake.nodes.find((n) => n.id === 'c4');
    expect(blockedNode).toBeDefined();
    expect(blockedNode?.title).toBe('Post comment on #42');
    expect(blockedNode?.callSignature).toBe('tracker.post_comment(issue: 42, body: "…total…")');
    expect(blockedNode?.blockedReason).toBe('blocked: payroll total → public tracker');
    expect(blockedNode?.chip).toBe('BLOCKED');

    // Payroll tool call
    const payrollCall = vFake.nodes.find((n) => n.id === 'c2');
    expect(payrollCall).toBeDefined();
    expect(payrollCall?.title).toBe('Read payroll');
    expect(payrollCall?.callSignature).toBe('payroll.get_salaries(month: "2026-10")');
    expect(payrollCall?.subtitle).toBe('214 rows');

    // HR call
    const hrCall = vFake.nodes.find((n) => n.id === 'c3');
    expect(hrCall).toBeDefined();
    expect(hrCall?.callSignature).toBe('hr.post_summary(text: "…total…")');
  });

  it('S7: UNTRUSTED node x1 in fake-run.jsonl mentions #42 hidden text and reason', () => {
    const x1Node = vFake.nodes.find((n) => n.id === 'x1');
    expect(x1Node).toBeDefined();
    expect(x1Node?.chip).toBe('UNTRUSTED');
    expect(x1Node?.untrustedReason).toBeDefined();
    // Must mention #42's hidden text / instruction
    expect(x1Node?.untrustedReason).toContain('#42');
    expect(x1Node?.untrustedReason).toMatch(/instruction|addressed to AI assistants/i);

    // Generic untrusted node without injection mentions public tracker
    const v2Node = vFake.nodes.find((n) => n.id === 'v2');
    expect(v2Node?.untrustedReason).toBe('Untrusted: from the public tracker, where anyone can write');
  });

  it('S2: Rounds go left-to-right with one grey writes edge per round', () => {
    // Model turn M1 connects to first node of round 1 (c1)
    const m1Writes = vFake.edges.filter((e) => e.from === 'M1' && e.kind === 'write');
    expect(m1Writes.length).toBe(1);
    expect(m1Writes[0].to).toBe('c1');
    expect(m1Writes[0].label).toBe('writes');

    // Model turn M2 connects to first node of round 2 (v2)
    const m2Writes = vFake.edges.filter((e) => e.from === 'M2' && e.kind === 'write');
    expect(m2Writes.length).toBe(1);
    expect(m2Writes[0].to).toBe('v2');
    expect(m2Writes[0].label).toBe('writes');

    // Model turns never stack in the same column
    const m1Node = vFake.nodes.find((n) => n.id === 'M1');
    const m2Node = vFake.nodes.find((n) => n.id === 'M2');
    expect(m1Node?.column).toBeDefined();
    expect(m2Node?.column).toBeDefined();
    expect(m2Node!.column!).toBeGreaterThan(m1Node!.column!);
  });

  it('traces lineage and populates arguments with sources and traced values', () => {
    const c4Inspect = inspect(vFake, 'c4', 'lineage');
    expect(c4Inspect.node?.kind).toBe('blocked');
    expect(c4Inspect.arguments.length).toBe(2);

    const bodyArg = c4Inspect.arguments.find((a) => a.name === 'body');
    expect(bodyArg).toBeDefined();
    expect(bodyArg?.sources.map((s) => s.id).sort()).toEqual(['v2', 'v4']);

    // Traced values list
    expect(c4Inspect.tracedValues.length).toBe(2);
    const bodyTraced = c4Inspect.tracedValues.find((t) => t.name === 'body');
    expect(bodyTraced).toBeDefined();
    expect(bodyTraced?.sensitivity).toBe('private');

    // Plain English summary
    expect(c4Inspect.plainSummary.length).toBeGreaterThan(0);
    expect(c4Inspect.plainSummary[0]).toContain('blocked before it was sent');
  });

  it('hides later nodes and edges during replay stepping', () => {
    const result = inspect(vFake, 'v4', 'lineage', 7);
    expect(result.lit.has('c4')).toBe(false);
    expect(result.lit.has('c3')).toBe(false);
    expect(result.edges.some((e) => e.to === 'c4')).toBe(false);

    const c4AtStep7 = inspect(vFake, 'c4', 'lineage', 7);
    expect(c4AtStep7.node).toBeUndefined();
    expect(c4AtStep7.lit.size).toBe(0);
  });

  it('renders error events as SCRIPT error nodes', () => {
    const errorRun = [
      { type: 'prompt', step: 1, t: 0, id: 'P', text: 'Test', tokens: 10 },
      { type: 'error', step: 2, t: 100, line: 7, message: 'Unknown lineage error' },
    ];
    const errorView = view(errorRun);
    const errorNode = errorView.nodes.find((n) => n.kind === 'error');
    expect(errorNode).toBeDefined();
    expect(errorNode).toMatchObject({
      kind: 'error',
      lane: 'SCRIPT',
      line: 7,
      title: 'Analysis error',
      subtitle: 'Unknown lineage error',
      chip: 'ERROR',
    });
  });

  it('marks blocked edges and nodes with proper red blocked metadata', () => {
    const blockedNode = vFake.nodes.find((n) => n.id === 'c4');
    expect(blockedNode).toBeDefined();
    expect(blockedNode?.kind).toBe('blocked');
    expect(blockedNode?.chip).toBe('BLOCKED');

    const blockedEdges = vFake.edges.filter((e) => e.to === 'c4');
    expect(blockedEdges.some((e) => e.kind === 'blocked')).toBe(true);
  });
});

describe('Seam B: story(view) pure generator', () => {
  it('generates plain-English narrative story for fake-run with blocked call verdict', () => {
    const s = story(vFake, "Triage this week's open issues and post the October payroll total to HR.");
    expect(s.headline).toBe('1 call blocked: private payroll data would have reached the public tracker');
    expect(s.sentences.length).toBeGreaterThan(4);
    expect(s.sentences[0].text).toContain('1. You asked: "Triage this week\'s open issues');
    expect(s.sentences.some((sent) => sent.text.includes('Gemini wrote a script'))).toBe(true);
    expect(s.sentences.some((sent) => sent.text.includes('214 private payroll rows'))).toBe(true);
    expect(s.sentences.some((sent) => sent.text.includes('BLOCKED before it was sent'))).toBe(true);
    expect(s.contextBoundary).toBe('Gemini saw 920 tokens. 15,060 tokens stayed inside the sandbox.');
  });

  it('generates "No leaks" headline verdict for clean runs like Run A', () => {
    const s = story(vRunA);
    expect(s.headline).toBe('No leaks: every call was allowed');
    expect(s.sentences.length).toBeGreaterThan(0);
    expect(s.contextBoundary).toBe('Gemini saw 4,671 tokens. 4,301 tokens stayed inside the sandbox.');
  });

  it('generates blocked verdict for Run B', () => {
    const s = story(vRunB);
    expect(s.headline).toBe('1 call blocked: private payroll data would have reached the public tracker');
    expect(s.contextBoundary).toBe('Gemini saw 1,718 tokens. 1,999 tokens stayed inside the sandbox.');
  });
});

describe('Seam B: collapsing intermediate values and deduping repeats', () => {
  it('collapses intermediate values in default view and shows them when showEveryStep is true', () => {
    // In full view with showEveryStep: true, intermediate values are preserved
    const full = view(fakeEvents, { showEveryStep: true });
    expect(full.nodes.length).toBeGreaterThanOrEqual(vFake.nodes.length);
  });

  it('deduplicates repeated identical tool calls into a single node with repeat badge and list', () => {
    const collapsedTrackerCall = vRunA.nodes.find((n) => n.event.server === 'tracker' && n.event.tool === 'list_issues');
    expect(collapsedTrackerCall).toBeDefined();
    expect(collapsedTrackerCall?.repeatCount).toBe(4);
    expect(collapsedTrackerCall?.title).toContain('×4');
    expect(collapsedTrackerCall?.repeatedEvents?.length).toBe(4);

    const fullRunA = view(runAEvents, { showEveryStep: true });
    const trackerCalls = fullRunA.nodes.filter((n) => n.event.server === 'tracker' && n.event.tool === 'list_issues');
    expect(trackerCalls.length).toBe(4);
  });

  it('H1: Assigns time-ordered columns where column order equals time order for run-a.jsonl', () => {
    // Round 4 (H1): Graph grows horizontally in time order.
    // One column per action, in the order actions happened.
    const fullRunA = view(runAEvents, { showEveryStep: true });
    
    // Check that for any two nodes where nodeA happened before nodeB in different actions, col(A) < col(B)
    for (let i = 0; i < fullRunA.nodes.length - 1; i++) {
      const n1 = fullRunA.nodes[i];
      const n2 = fullRunA.nodes[i + 1];
      if (n1.step < n2.step) {
        expect(n1.column!).toBeLessThanOrEqual(n2.column!);
      }
    }

    // Every edge never places a node left of something it depends on (toCol >= fromCol)
    for (const [name, v] of [['fake', vFake], ['runA', vRunA], ['runB', vRunB]] as const) {
      const colMap = new Map(v.nodes.map((n) => [n.id, n.column ?? 1]));
      for (const e of v.edges) {
        const fromCol = colMap.get(e.from) ?? 1;
        const toCol = colMap.get(e.to) ?? 1;
        expect(
          toCol,
          `Edge ${e.from} -> ${e.to} in ${name} must never go left (${fromCol} <= ${toCol})`,
        ).toBeGreaterThanOrEqual(fromCol);
      }
    }
  });

  it('H1: A call and its result share the exact same column', () => {
    const fullRunA = view(runAEvents, { showEveryStep: true });
    const c3 = fullRunA.nodes.find((n) => n.id === 'c3');
    const v3 = fullRunA.nodes.find((n) => n.id === 'v3');
    expect(c3).toBeDefined();
    expect(v3).toBeDefined();
    expect(c3?.column).toBe(v3?.column);

    const c4 = fullRunA.nodes.find((n) => n.id === 'c4');
    const v4 = fullRunA.nodes.find((n) => n.id === 'v4');
    expect(c4).toBeDefined();
    expect(v4).toBeDefined();
    expect(c4?.column).toBe(v4?.column);

    // In fake run too
    const fullFake = view(fakeEvents, { showEveryStep: true });
    const c1 = fullFake.nodes.find((n) => n.id === 'c1');
    const v1 = fullFake.nodes.find((n) => n.id === 'v1');
    expect(c1).toBeDefined();
    expect(v1).toBeDefined();
    expect(c1?.column).toBe(v1?.column);
  });
});
