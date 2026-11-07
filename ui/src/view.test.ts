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

describe('Seam B: run view and inspection', () => {
  it('parses JSONL run into events and creates structured view', () => {
    expect(vFake.nodes.length).toBeGreaterThan(0);
    expect(vFake.edges.length).toBeGreaterThan(0);
    expect(vFake.lanes).toEqual(['YOU', 'MODEL', 'SCRIPT', 'tracker', 'payroll', 'hr']);
    expect(vFake.steps).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(vFake.summary).toBeDefined();
    expect(vFake.summary?.model_tokens).toBe(920);
    expect(vFake.summary?.sandbox_tokens).toBe(15060);
  });

  it('assigns plain English titles, subtitles, and single status chips to nodes', () => {
    // Model turn node
    const modelNode = vFake.nodes.find((n) => n.kind === 'model_turn' && n.round === 2);
    expect(modelNode).toBeDefined();
    expect(modelNode?.title).toBe('Gemini wrote a script (round 2)');
    expect(modelNode?.chip).toBe('UNTRUSTED');

    // Blocked tracker call
    const blockedNode = vFake.nodes.find((n) => n.id === 'c4');
    expect(blockedNode).toBeDefined();
    expect(blockedNode?.title).toBe('Post comment on #42');
    expect(blockedNode?.chip).toBe('BLOCKED');

    // Payroll tool call
    const payrollCall = vFake.nodes.find((n) => n.id === 'c2');
    expect(payrollCall).toBeDefined();
    expect(payrollCall?.title).toBe('Read payroll');
    expect(payrollCall?.subtitle).toBe('214 rows');

    // Value reduce node
    const reduceValue = vFake.nodes.find((n) => n.id === 'v4');
    expect(reduceValue).toBeDefined();
    expect(reduceValue?.title).toBe('Sum the gross pay');
    expect(reduceValue?.subtitle).toBe('1284600');
    expect(reduceValue?.chip).toBe('PRIVATE');
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

  it('creates script line nodes linked to model turns and tool calls when showEveryStep is true', () => {
    const fullView = view(fakeEvents, { showEveryStep: true });
    const line3 = fullView.nodes.find((n) => n.id === 'line-M2-3');
    expect(line3).toBeDefined();
    expect(line3?.lane).toBe('SCRIPT');
    expect(line3?.line).toBe(3);
    expect(line3?.subtitle).toContain('payroll.get_salaries');

    const edgeToCall = fullView.edges.find((e) => e.from === 'line-M2-3' && e.to === 'c2');
    expect(edgeToCall).toBeDefined();
  });
});

describe('Seam B: story(view) pure generator', () => {
  it('generates plain-English narrative story for fake-run with blocked call verdict', () => {
    const s = story(vFake);
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
  it('collapses purely intermediate script nodes into edge annotations by default', () => {
    // In default collapsed view, script line nodes are collapsed
    expect(vFake.nodes.some((n) => n.kind === 'script')).toBe(false);

    // In full view with showEveryStep: true, script lines and all steps are present
    const full = view(fakeEvents, { showEveryStep: true });
    expect(full.nodes.some((n) => n.kind === 'script')).toBe(true);
    expect(full.nodes.length).toBeGreaterThan(vFake.nodes.length);
  });

  it('deduplicates repeated identical tool calls into a single node with repeat badge and list', () => {
    // Run A has 4 calls to tracker.list_issues (c3, c6, c9, c13)
    const collapsedTrackerCall = vRunA.nodes.find((n) => n.event.server === 'tracker' && n.event.tool === 'list_issues');
    expect(collapsedTrackerCall).toBeDefined();
    expect(collapsedTrackerCall?.repeatCount).toBe(4);
    expect(collapsedTrackerCall?.title).toContain('×4');
    expect(collapsedTrackerCall?.repeatedEvents?.length).toBe(4);

    // When showEveryStep is true, all 4 calls exist separately
    const fullRunA = view(runAEvents, { showEveryStep: true });
    const trackerCalls = fullRunA.nodes.filter((n) => n.event.server === 'tracker' && n.event.tool === 'list_issues');
    expect(trackerCalls.length).toBe(4);
  });
});
