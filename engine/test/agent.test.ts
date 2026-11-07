import { describe, it, expect } from 'vitest';
import {
  VmExecutor,
  DEMO_TASKS,
  DEFAULT_DEFINITIONS,
  createFixtureObserver,
  runAgent,
  runTask,
  type RunEvent,
} from '../src/agent.js';
import { MockLanguageModelV3 } from 'ai/test';

describe('VmExecutor', () => {
  it('executes javascript code in sandbox', async () => {
    const namespaces = {
      math: {
        add: async (args: Record<string, unknown>) => (args.a as number) + (args.b as number),
      },
    };
    const executor = new VmExecutor(namespaces);
    const code = 'async () => await math.add({ a: 10, b: 25 })';
    const result = await executor.execute(code);
    expect(result.result).toBe(35);
  });

  it('handles execution errors gracefully', async () => {
    const executor = new VmExecutor({});
    const code = 'async () => { throw new Error("Sandbox explosion"); }';
    const result = await executor.execute(code);
    expect(result.error).toContain('Sandbox explosion');
  });

  it('times out on infinite loops', async () => {
    const executor = new VmExecutor({}, 100);
    const code = 'async () => { while(true) {} }';
    const result = await executor.execute(code);
    expect(result.error).toBeDefined();
  });
});

describe('createFixtureObserver & Policy', () => {
  it('allows safe HR post summary of payroll total', async () => {
    const events: RunEvent[] = [];
    const emit = (e: Record<string, unknown>) => events.push({ ...e, t: 10, step: events.length + 1 } as RunEvent);
    const code = `
      const pay = await payroll.get_salaries({ month: "2026-10" });
      const total = pay.reduce((s, r) => s + r.gross, 0);
      await hr.post_summary({ text: \`October payroll: \${total}\` });
    `;
    const tools = await createFixtureObserver(code, emit);
    const payRes = await tools.payroll.get_salaries({ month: '2026-10' }) as { content: { type: string; text: string }[] };
    const pay = JSON.parse(payRes.content[0].text) as Array<{ gross: number }>;
    expect(pay.length).toBe(214);
    const total = pay.reduce((s, r) => s + r.gross, 0);
    expect(total).toBe(1699983);
    const hrResult = await tools.hr.post_summary({ text: `October payroll: ${total}` });
    expect(hrResult).toEqual({ content: [{ type: 'text', text: 'stored (1)' }] });

    const callEvents = events.filter(e => e.type === 'call');
    expect(callEvents.length).toBe(2);
    expect(callEvents[0].server).toBe('payroll');
    expect(callEvents[1].server).toBe('hr');
  });

  it('blocks private payroll data sent to public tracker sink', async () => {
    const events: RunEvent[] = [];
    const emit = (e: Record<string, unknown>) => events.push({ ...e, t: 10, step: events.length + 1 } as RunEvent);
    const code = `
      const pay = await payroll.get_salaries({ month: "2026-10" });
      const total = pay.reduce((s, r) => s + r.gross, 0);
      await tracker.post_comment({ issue: 42, body: \`Total is \${total}\` });
    `;
    const tools = await createFixtureObserver(code, emit);
    await tools.payroll.get_salaries({ month: '2026-10' });
    const blockedRes = await tools.tracker.post_comment({ issue: 42, body: 'Total is 1284600' });
    expect(blockedRes).toHaveProperty('blocked', true);

    const blockedEvents = events.filter(e => e.type === 'blocked');
    expect(blockedEvents.length).toBe(1);
    expect(blockedEvents[0].server).toBe('tracker');
    expect(blockedEvents[0].tool).toBe('post_comment');
    expect(blockedEvents[0].rule).toBe('private-to-public');
    expect(blockedEvents[0].reason).toContain('Private lineage');
  });
});

describe('runAgent with mock model', () => {
  it('executes a multi-turn agent flow and emits structured event stream', async () => {
    const events: RunEvent[] = [];
    let roundCounter = 0;

    const mockModel = new MockLanguageModelV3({
      modelId: 'gemini-3.7-flash',
      doGenerate: async () => {
        roundCounter++;
        if (roundCounter === 1) {
          return {
            rawCall: { rawPrompt: null, rawSettings: {} },
            finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
            usage: {
              inputTokens: { total: 50, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 50, text: undefined, reasoning: undefined },
            },
            content: [
              {
                type: 'tool-call',
                toolCallId: 'call_1',
                toolName: 'codemode',
                input: JSON.stringify({
                  code: 'async () => {\n  const issues = await tracker.list_issues({ state: "open" });\n  return { issuesCount: issues.length };\n}',
                }),
              },
            ],
            warnings: [],
          };
        }
        if (roundCounter === 2) {
          return {
            rawCall: { rawPrompt: null, rawSettings: {} },
            finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
            usage: {
              inputTokens: { total: 100, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 80, text: undefined, reasoning: undefined },
            },
            content: [
              {
                type: 'tool-call',
                toolCallId: 'call_2',
                toolName: 'codemode',
                input: JSON.stringify({
                  code: 'async () => {\n  const pay = await payroll.get_salaries({ month: "2026-10" });\n  const total = pay.reduce((s, r) => s + r.gross, 0);\n  await hr.post_summary({ text: `October payroll: ${total}` });\n  return { total };\n}',
                }),
              },
            ],
            warnings: [],
          };
        }
        return {
          rawCall: { rawPrompt: null, rawSettings: {} },
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: {
            inputTokens: { total: 120, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 20, text: undefined, reasoning: undefined },
          },
          content: [
            {
              type: 'text',
              text: 'Task complete.',
            },
          ],
          warnings: [],
        };
      },
    });

    await runTask('A', {
      model: mockModel,
      emit: e => events.push(e),
      maxRounds: 3,
    });

    const types = events.map(e => e.type);
    expect(types[0]).toBe('prompt');
    expect(types).toContain('model_turn');
    expect(types).toContain('call');
    expect(types).toContain('value');
    expect(types[types.length - 1]).toBe('summary');

    const promptEvent = events.find(e => e.type === 'prompt');
    expect(promptEvent?.text).toBe(DEMO_TASKS.A);

    const modelTurns = events.filter(e => e.type === 'model_turn');
    expect(modelTurns.length).toBe(2);
    expect(modelTurns[0].round).toBe(1);
    expect(modelTurns[1].round).toBe(2);

    const calls = events.filter(e => e.type === 'call');
    expect(calls.some(c => c.server === 'tracker' && c.tool === 'list_issues')).toBe(true);
    expect(calls.some(c => c.server === 'payroll' && c.tool === 'get_salaries')).toBe(true);
    expect(calls.some(c => c.server === 'hr' && c.tool === 'post_summary')).toBe(true);

    const summary = events.find(e => e.type === 'summary');
    expect(summary?.rounds).toBe(2);
    expect(summary?.model_tokens).toBeGreaterThan(0);
    expect(summary?.sandbox_tokens).toBeGreaterThan(0);
  });
});
