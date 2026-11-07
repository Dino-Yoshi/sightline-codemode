/**
 * Seam A — observed Code Mode execution.
 *
 * Each test feeds the engine a FIXED generated script (TS text, no LLM) plus
 * the REAL fixture MCP servers, then asserts on what goes back to the model and
 * on the recorded run. Required cases (PROPOSAL §5):
 *   1. `total` has private lineage back to `get_salaries`.
 *   2. A private → public call is blocked, and the tracker received nothing.
 *   3. Code the analyzer can't follow produces an error / unknown-lineage node,
 *      is fail-closed, and doesn't crash.
 *   4. Payroll rows never appear in what goes back to the model.
 */
import { test, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { analyze } from '../src/lineage.ts';
import { wrapTools } from '../src/observer.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, '../fixtures');

const SERVERS = {
  payroll: { source: 'private', sink: 'private', taint: 'trusted' },
  tracker: { source: 'public', sink: 'public', taint: 'untrusted' },
  hr: { source: 'private', sink: 'private', taint: 'trusted' },
};

/** Connect to a fixture server over stdio, running the TS source via tsx. */
async function connect(name) {
  const client = new Client({ name: `test-${name}`, version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', resolve(fixtures, `${name}.ts`)],
    cwd: fixtures,
  });
  await client.connect(transport);
  return client;
}

let payroll;
let tracker;
let hr;
let clients;

before(async () => {
  [payroll, tracker, hr] = await Promise.all([connect('payroll'), connect('tracker'), connect('hr')]);
  const toClient = (c) => ({ callTool: (req) => c.callTool(req) });
  clients = { payroll: toClient(payroll), tracker: toClient(tracker), hr: toClient(hr) };
});

after(async () => {
  await Promise.all([payroll?.close(), tracker?.close(), hr?.close()]);
});

const logOf = async (c) => {
  const res = await c.callTool({ name: 'call_log', arguments: {} });
  return JSON.parse(res.content[0].text);
};

test('total has private lineage back to get_salaries', async () => {
  const code = [
    'const pay = await payroll.get_salaries({ month: "2026-10" });',
    'const total = pay.reduce((s, r) => s + r.gross, 0);',
    'await hr.post_summary({ text: `October payroll: ${total}` });',
  ].join('\n');
  const analysis = analyze(code);
  const events = [];
  const tools = wrapTools(clients, SERVERS, analysis, (e) => events.push(e));

  const pay = await tools.payroll.get_salaries({ month: '2026-10' });
  const rows = JSON.parse(pay.content[0].text);
  const total = rows.reduce((s, r) => s + r.gross, 0);
  await tools.hr.post_summary({ text: `October payroll: ${total}` });

  // Static lineage: total <- pay <- payroll.get_salaries (private).
  const salariesSite = analysis.sites.find((s) => s.server === 'payroll' && s.tool === 'get_salaries');
  assert.ok(salariesSite, 'get_salaries call site exists');
  assert.deepEqual(analysis.deps.pay, [salariesSite.id]);
  assert.deepEqual(analysis.deps.total, ['pay']);

  // The payroll result value is recorded as private.
  const payrollResult = events.find((e) => e.type === 'value' && e.op === 'result');
  assert.equal(payrollResult.sensitivity, 'private');

  // 214 private rows exist; the HR sink received only the derived total.
  assert.equal(rows.length, 214);
  const hrLog = await logOf(hr);
  assert.equal(hrLog.length, 1);
  assert.equal(hrLog[0].args.text, `October payroll: ${total}`);
});

test('private -> public call is blocked and the tracker received nothing', async () => {
  const code = [
    'const pay = await payroll.get_salaries({ month: "2026-10" });',
    'const total = pay.reduce((s, r) => s + r.gross, 0);',
    'await tracker.post_comment({ issue: 42, body: `total ${total}` });',
  ].join('\n');
  const analysis = analyze(code);
  const events = [];
  const tools = wrapTools(clients, SERVERS, analysis, (e) => events.push(e));

  const pay = await tools.payroll.get_salaries({ month: '2026-10' });
  const total = JSON.parse(pay.content[0].text).reduce((s, r) => s + r.gross, 0);
  const res = await tools.tracker.post_comment({ issue: 42, body: `total ${total}` });

  // The call was blocked before forwarding.
  assert.equal(res.blocked, true);
  const blocked = events.find((e) => e.type === 'blocked' && e.server === 'tracker');
  assert.ok(blocked, 'a blocked event was emitted for the tracker');
  assert.equal(blocked.rule, 'private-to-public');

  // The tracker fixture received NOTHING (the core done-when assertion).
  const trackerLog = await logOf(tracker);
  assert.deepEqual(trackerLog, []);
});

test('un-analyzable code is fail-closed (unknown -> private) and does not crash', async () => {
  const code = [
    'let total = 0;',
    'for (const r of rows) total += r.gross;',
    'await tracker.post_comment({ issue: 42, body: `${total}` });',
  ].join('\n');
  const analysis = analyze(code);
  const events = [];

  // Analyzer flags control flow it can't follow, and marks total unknown.
  assert.ok(analysis.errors.length >= 1);
  assert.ok(analysis.deps.total.includes('unknown'));

  const tools = wrapTools(clients, SERVERS, analysis, (e) => events.push(e));
  // Does not throw; unknown lineage at a public sink is blocked (fail-closed).
  const res = await tools.tracker.post_comment({ issue: 42, body: 'x' });
  assert.equal(res.blocked, true);

  // Error nodes were surfaced, not a crash.
  assert.ok(events.some((e) => e.type === 'error'));

  // The tracker still received nothing from this blocked call.
  const trackerLog = await logOf(tracker);
  assert.deepEqual(trackerLog, []);
});

test('payroll rows never appear in what goes back to the model', async () => {
  const code = [
    'const pay = await payroll.get_salaries({ month: "2026-10" });',
    'const total = pay.reduce((s, r) => s + r.gross, 0);',
    'await hr.post_summary({ text: `total ${total}` });',
  ].join('\n');
  const analysis = analyze(code);
  const events = [];
  const tools = wrapTools(clients, SERVERS, analysis, (e) => events.push(e));

  await tools.payroll.get_salaries({ month: '2026-10' });

  // Nothing with private sensitivity is ever placed in the model context.
  const inModel = events.filter((e) => e.type === 'value' && e.in_model_context);
  assert.ok(inModel.every((e) => e.sensitivity !== 'private'));

  // The payroll result specifically is marked out-of-context.
  const payrollResult = events.find(
    (e) => e.type === 'value' && e.op === 'result' && e.sensitivity === 'private',
  );
  assert.ok(payrollResult);
  assert.equal(payrollResult.in_model_context, false);
});
