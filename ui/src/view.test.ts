import { describe, it, expect } from 'vitest';
import { parseRun, view, inspect, story } from './view';
import fakeRunText from '../../runs/fake-run.jsonl?raw';
import runAText from '../../runs/run-a.jsonl?raw';
import runBText from '../../runs/run-b.jsonl?raw';

const fakeEvents = parseRun(fakeRunText);
const vFake = view(fakeEvents);
const runAEvents = parseRun(runAText);
const vRunA = view(runAEvents);
const runBEvents = parseRun(runBText);
const vRunB = view(runBEvents);

describe('Seam B: run view and inspection (Polish Round 3)', () => {
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

  it('assigns deterministic layered columns such that every edge goes strictly left-to-right', () => {
    for (const [name, v] of [['fake', vFake], ['runA', vRunA], ['runB', vRunB]] as const) {
      const colMap = new Map(v.nodes.map((n) => [n.id, n.column ?? 1]));
      for (const e of v.edges) {
        const fromCol = colMap.get(e.from) ?? 1;
        const toCol = colMap.get(e.to) ?? 1;
        expect(toCol, `Edge ${e.from} -> ${e.to} in ${name} must go left-to-right (${fromCol} < ${toCol})`).toBeGreaterThan(fromCol);
      }
    }
  });
});
