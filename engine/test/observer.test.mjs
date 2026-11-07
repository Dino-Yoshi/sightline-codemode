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

  // BUG 2: the reason is one plain sentence naming the private source and sink.
  assert.equal(
    blocked.reason,
    'total comes from payroll.get_salaries (private) and tracker is public, so the call was blocked before it was sent.',
  );
  // The salary values are trusted, so untrusted text is NOT mentioned.
  assert.doesNotMatch(blocked.reason, /untrusted/);

  // BUG 2: the blocked event's args[*].from lists the value ids, as allowed calls do.
  const payrollResult = events.find((e) => e.type === 'value' && e.op === 'result');
  assert.deepEqual(blocked.args.body.from, [payrollResult.id]);

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

// --- BUG 1: a tool call site inside a loop must cover every iteration. --------

test('a post_comment call site inside a loop covers every iteration (no false block)', async () => {
  // One static site for tracker.post_comment, but many runtime calls (one per
  // open issue). All posted data is public (from tracker.list_issues), so every
  // iteration must be allowed and the tracker must receive all of them.
  const code = [
    'const openIssues = await tracker.list_issues({ state: "open" });',
    'const triaged = [];',
    'for (const issue of openIssues) {',
    '  const comment = `Triaged #${issue.id} ${issue.title}`;',
    '  await tracker.post_comment({ issue: issue.id, body: comment });',
    '  triaged.push({ id: issue.id });',
    '}',
  ].join('\n');
  const analysis = analyze(code);

  // Only ONE static post_comment site exists for the whole loop.
  const postSites = analysis.sites.filter((s) => s.server === 'tracker' && s.tool === 'post_comment');
  assert.equal(postSites.length, 1);

  const events = [];
  const tools = wrapTools(clients, SERVERS, analysis, (e) => events.push(e));

  const issuesRes = await tools.tracker.list_issues({ state: 'open' });
  const issues = JSON.parse(issuesRes.content[0].text);
  assert.ok(issues.length > 1, 'the fixture lists more than one issue');

  for (const issue of issues) {
    const res = await tools.tracker.post_comment({
      issue: issue.id,
      body: `Triaged #${issue.id} ${issue.title}`,
    });
    // Public -> public: never blocked, on any iteration.
    assert.notEqual(res?.blocked, true, `issue #${issue.id} must not be blocked`);
  }

  // No blocked events at all, and every comment actually reached the tracker.
  assert.equal(events.filter((e) => e.type === 'blocked').length, 0);
  const trackerLog = await logOf(tracker);
  // Tracker state persists across tests, so assert THESE comments all arrived.
  for (const issue of issues) {
    const body = `Triaged #${issue.id} ${issue.title}`;
    assert.ok(
      trackerLog.some((c) => c.tool === 'post_comment' && c.args.body === body),
      `tracker received the comment for issue #${issue.id}`,
    );
  }
  // Extra runtime calls still carry a real line number (mapped to the loop site).
  const callEvents = events.filter((e) => e.type === 'call' && e.tool === 'post_comment');
  assert.equal(callEvents.length, issues.length);
  assert.ok(callEvents.every((e) => e.line === postSites[0].line));
});

test('a loop site still blocks when the posted data is private (fix does not weaken policy)', async () => {
  // The same loop shape, but the body carries a private payroll total. Every
  // iteration, including the extra ones mapped to the loop site, must be blocked.
  const code = [
    'const pay = await payroll.get_salaries({ month: "2026-10" });',
    'const total = pay.reduce((s, r) => s + r.gross, 0);',
    'const openIssues = await tracker.list_issues({ state: "open" });',
    'for (const issue of openIssues) {',
    '  await tracker.post_comment({ issue: issue.id, body: `total ${total}` });',
    '}',
  ].join('\n');
  const analysis = analyze(code);
  const events = [];
  const tools = wrapTools(clients, SERVERS, analysis, (e) => events.push(e));

  await tools.payroll.get_salaries({ month: '2026-10' });
  const issuesRes = await tools.tracker.list_issues({ state: 'open' });
  const issues = JSON.parse(issuesRes.content[0].text);

  for (const issue of issues) {
    const res = await tools.tracker.post_comment({ issue: issue.id, body: 'total 1699983' });
    assert.equal(res.blocked, true);
  }

  const blocked = events.filter((e) => e.type === 'blocked');
  assert.equal(blocked.length, issues.length);
  // Every block names the private source and the public sink.
  for (const b of blocked) {
    assert.equal(
      b.reason,
      'total comes from payroll.get_salaries (private) and tracker is public, so the call was blocked before it was sent.',
    );
  }
  const trackerLog = await logOf(tracker);
  // The tracker fixture state persists across tests, so assert on THIS body:
  // none of the private payroll comments may have arrived.
  assert.equal(trackerLog.filter((c) => c.tool === 'post_comment' && c.args.body === 'total 1699983').length, 0);
});

// --- BUG 2: the reason mentions untrusted text only when it is truly present. -

test('the block reason mentions untrusted text only when an untrusted value is in the lineage', async () => {
  // The body mixes a private payroll total with untrusted tracker text, so the
  // reason must name both the private source and the untrusted influence.
  const code = [
    'const pay = await payroll.get_salaries({ month: "2026-10" });',
    'const total = pay.reduce((s, r) => s + r.gross, 0);',
    'const issues = await tracker.list_issues({ state: "open" });',
    'const title = issues[0].title;',
    'await tracker.post_comment({ issue: 42, body: `${title}: ${total}` });',
  ].join('\n');
  const analysis = analyze(code);
  const events = [];
  const tools = wrapTools(clients, SERVERS, analysis, (e) => events.push(e));

  await tools.payroll.get_salaries({ month: '2026-10' });
  await tools.tracker.list_issues({ state: 'open' });
  const res = await tools.tracker.post_comment({ issue: 42, body: 'Login timeout: 1699983' });
  assert.equal(res.blocked, true);

  const blocked = events.find((e) => e.type === 'blocked' && e.server === 'tracker');
  assert.match(blocked.reason, /payroll\.get_salaries \(private\)/);
  assert.match(blocked.reason, /untrusted/);
  assert.match(blocked.reason, /tracker is public/);
  // Still one plain sentence ending with the blocked-before-sent clause.
  assert.match(blocked.reason, /so the call was blocked before it was sent\.$/);

  // args[*].from lists value ids for the blocked call too.
  const payrollResult = events.find((e) => e.type === 'value' && e.op === 'result' && e.sensitivity === 'private');
  assert.ok(blocked.args.body.from.includes(payrollResult.id));
});
