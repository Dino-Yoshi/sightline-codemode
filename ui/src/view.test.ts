import { describe, it, expect } from 'vitest';
import { parseRun, view, inspect } from './view';
import runText from '../../runs/fake-run.jsonl?raw';

const events = parseRun(runText);
const v = view(events);

describe('Seam B: run view and inspection', () => {
  it('parses JSONL run into events and creates structured view', () => {
    expect(v.nodes.length).toBeGreaterThan(0);
    expect(v.edges.length).toBeGreaterThan(0);
    expect(v.lanes).toEqual(['YOU', 'MODEL', 'SCRIPT', 'tracker', 'payroll', 'hr']);
    expect(v.steps).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(v.summary).toBeDefined();
    expect(v.summary?.model_tokens).toBe(920);
    expect(v.summary?.sandbox_tokens).toBe(15060);
  });

  it('traces lineage in both directions and blast radius downstream only', () => {
    // Lineage from v4 (payroll total reduce)
    const lineage = inspect(v, 'v4', 'lineage');
    expect(lineage.node?.id).toBe('v4');
    expect([...lineage.lit]).toEqual(expect.arrayContaining(['c2', 'v3', 'v4', 'c3', 'c4']));
    // Upstream includes c2, v3
    expect(lineage.lit.has('c2')).toBe(true);
    expect(lineage.lit.has('v3')).toBe(true);

    // Blast radius from v4 (only downstream: c3, c4)
    const blast = inspect(v, 'v4', 'blast');
    expect(blast.node?.id).toBe('v4');
    expect([...blast.lit]).toEqual(expect.arrayContaining(['v4', 'c3', 'c4']));
    expect(blast.lit.has('v3')).toBe(false);
    expect(blast.lit.has('c2')).toBe(false);
  });

  it('exposes each argument and its sources in the detail drawer inspection', () => {
    const c4Inspect = inspect(v, 'c4', 'lineage');
    expect(c4Inspect.node?.kind).toBe('blocked');
    expect(c4Inspect.arguments.length).toBe(2);

    const bodyArg = c4Inspect.arguments.find((a) => a.name === 'body');
    expect(bodyArg).toBeDefined();
    expect(bodyArg?.sources.map((s) => s.id).sort()).toEqual(['v2', 'v4']);

    const issueArg = c4Inspect.arguments.find((a) => a.name === 'issue');
    expect(issueArg).toBeDefined();
    expect(issueArg?.sources.map((s) => s.id)).toEqual(['M2']);
  });

  it('hides later nodes and edges during replay stepping', () => {
    // At step 7, step 8 (c3) and step 9 (c4) should not be visible
    const result = inspect(v, 'v4', 'lineage', 7);
    expect(result.lit.has('c4')).toBe(false);
    expect(result.lit.has('c3')).toBe(false);
    expect(result.edges.some((e) => e.to === 'c4')).toBe(false);

    // Inspecting a node that occurred at step 9 when at step 7 should return node: undefined
    const c4AtStep7 = inspect(v, 'c4', 'lineage', 7);
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
    });
  });

  it('marks blocked edges and nodes with proper red blocked metadata', () => {
    const blockedNode = v.nodes.find((n) => n.id === 'c4');
    expect(blockedNode).toBeDefined();
    expect(blockedNode?.kind).toBe('blocked');
    expect(blockedNode?.event.rule).toBe('private→public');

    const blockedEdges = v.edges.filter((e) => e.to === 'c4');
    expect(blockedEdges.some((e) => e.kind === 'blocked')).toBe(true);
  });

  it('creates script line nodes linked to model turns and tool calls', () => {
    const line3 = v.nodes.find((n) => n.id === 'line-M2-3');
    expect(line3).toBeDefined();
    expect(line3?.lane).toBe('SCRIPT');
    expect(line3?.line).toBe(3);
    expect(line3?.subtitle).toContain('payroll.get_salaries');

    // Edge from line 3 to call c2
    const edgeToCall = v.edges.find((e) => e.from === 'line-M2-3' && e.to === 'c2');
    expect(edgeToCall).toBeDefined();
  });
});
