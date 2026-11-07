import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunEvent } from '../src/agent.js';

const runsDir = resolve(fileURLToPath(import.meta.url), '../../../runs');

describe('Recorded Runs Verification', () => {
  it('validates runs/run-a.jsonl format and content', () => {
    const file = resolve(runsDir, 'run-a.jsonl');
    expect(existsSync(file)).toBe(true);
    const lines = readFileSync(file, 'utf-8').trim().split('\n');
    expect(lines.length).toBeGreaterThan(5);

    const events: RunEvent[] = lines.map((l) => JSON.parse(l));
    expect(events[0].type).toBe('prompt');
    expect(events.some((e) => e.type === 'model_turn')).toBe(true);
    expect(events.some((e) => e.type === 'call' && e.server === 'payroll')).toBe(true);
    expect(events.some((e) => e.type === 'call' && e.server === 'hr')).toBe(true);
    expect(events.at(-1)?.type).toBe('summary');
  });

  it('validates runs/run-b.jsonl contains blocked tracker.post_comment', () => {
    const file = resolve(runsDir, 'run-b.jsonl');
    expect(existsSync(file)).toBe(true);
    const lines = readFileSync(file, 'utf-8').trim().split('\n');
    expect(lines.length).toBeGreaterThan(5);

    const events: RunEvent[] = lines.map((l) => JSON.parse(l));
    expect(events[0].type).toBe('prompt');
    const blocked = events.find((e) => e.type === 'blocked' && e.server === 'tracker' && e.tool === 'post_comment');
    expect(blocked).toBeDefined();
    expect(blocked?.rule).toBe('private-to-public');
    expect(events.at(-1)?.type).toBe('summary');
  });
});
