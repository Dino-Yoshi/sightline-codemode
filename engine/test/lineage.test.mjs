import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { analyze } from '../src/lineage.ts';
import { check } from '../src/policy.ts';
import { wrapTools } from '../src/observer.ts';

test('tracks tool results and derived values to call arguments', () => {
  const a = analyze(`const rows = await tools.payroll.get_salaries({});
const total = rows.reduce((sum, row) => sum + row.salary, 0);
await tools.hr.send({ amount: total });`);
  assert.equal(a.sites.length, 2);
  assert.deepEqual(a.deps.rows, [a.sites[0].id]);
  assert.deepEqual(a.deps.total, ['rows']);
  assert.deepEqual(a.sites[1].args.amount, ['total']);
  assert.deepEqual(a.errors, []);
});

test('marks unknown loop inputs and dynamic calls unknown', () => {
  const a = analyze(`let total = 0;
for (const row of rows) total += row.salary;
await tools[server].send({total});`);
  assert.ok(a.errors.length >= 1);
  assert.ok(a.deps.total.includes('unknown'));
});

test('handles parse errors without throwing', () => {
  assert.ok(analyze('const x = (').errors.length);
});

test('policy blocks private or unknown lineage at public sinks; taint alone does not block', () => {
  const publicSink = { source: 'public', sink: 'public', taint: 'untrusted' };
  assert.equal(check({ sensitivity: 'private', taint: 'trusted' }, publicSink).allow, false);
  assert.equal(check({ sensitivity: 'unknown', taint: 'untrusted' }, publicSink).allow, false);
  assert.deepEqual(check({ sensitivity: 'public', taint: 'untrusted' }, publicSink), { allow: true });
  assert.deepEqual(check({ sensitivity: 'private', taint: 'trusted' }, { ...publicSink, sink: 'private' }), { allow: true });
});

test('tracks reassignment and object mutation', () => {
  const a = analyze(`const rows = await tools.payroll.get_salaries({});
let total = 0;
total = rows.length;
const payload = { amount: 0 };
payload.amount = total;
await tools.tracker.comment(payload);`);
  assert.ok(a.deps.total.includes('rows'));
  assert.ok(a.deps.payload.includes('total'));
  assert.deepEqual(a.sites[1].args.unknown, ['unknown']);
});

test('analyzes the direct server calls used by the canonical run', () => {
  const a = analyze('const pay = await payroll.get_salaries({month: "2026-10"});\nconst total = pay.reduce((s, r) => s + r.gross, 0);\nawait tracker.post_comment({issue: 42, body: `total ${total}`});');
  assert.deepEqual(a.sites.map(s => [s.server, s.tool]), [['payroll', 'get_salaries'], ['tracker', 'post_comment']]);
  assert.deepEqual(a.deps.pay, [a.sites[0].id]);
  assert.deepEqual(a.sites[1].args.body, ['total']);
  assert.deepEqual(a.errors, []);
});

const recorded = async (run, round) => {
  const { readFile } = await import('node:fs/promises');
  const events = (await readFile(new URL(`../../runs/run-${run}.jsonl`, import.meta.url), 'utf8')).trim().split('\n').map(JSON.parse);
  return events.find(e => e.type === 'model_turn' && e.round === round).script.map(line => line.code).join('\n');
};

test('recorded Gemini scripts retain lineage through wrappers and control flow', async () => {
  for (const [run, round] of [['a', 1], ['a', 2], ['a', 3], ['b', 2], ['b', 3]]) {
    const a = analyze(await recorded(run, round));
    assert.deepEqual(a.errors, [], `${run} round ${round}`);
    assert.ok(a.sites.length, `${run} round ${round} sites`);
  }
  const a = analyze(await recorded('a', 2));
  assert.ok(a.deps.results.includes('res'));
  assert.ok(a.deps.results.includes('total'));
  assert.deepEqual(a.deps.m, ['tryMonths']);
  const b = analyze(await recorded('b', 3));
  assert.deepEqual(b.sites.find(s => s.tool === 'post_comment').args.body, ['total']);
  assert.deepEqual(b.deps.total, ['s2026']);
  assert.deepEqual(b.deps.s2026, [b.sites.find(s => s.tool === 'get_salaries').id]);
});

test('unions data assignments, mutations, literal parts and method arguments', () => {
  const a = analyze(`async () => {
    const rows = await payroll.get_salaries({});
    let x = 0; let out = []; let obj = {};
    if (true) { x = rows.length; } else { x = 1; }
    for (let i = 0; i < 2; i++) { out.push(x); }
    for (const row of rows) { obj.k = row.gross; }
    while (false) { x = obj.k; }
    try { out.push(JSON.stringify(obj)); } catch (e) { out.push(e.message); } finally { out.push(String(x)); }
    const derived = [...out, { ...obj, value: Math.max(x, 1) }, rows.filter(r => r.gross).map(r => r.gross)];
    await tracker.post_comment({ body: derived });
  }`);
  assert.deepEqual(a.errors, []);
  assert.ok(a.deps.x.includes('rows') && a.deps.x.includes('obj'));
  assert.ok(a.deps.out.includes('x') && a.deps.out.includes('obj'));
  assert.ok(a.deps.obj.includes('row'));
  assert.deepEqual(a.deps.row, ['rows']);
  assert.ok(['out', 'obj', 'x', 'rows'].every(d => a.deps.derived.includes(d)));
});

test('unknown identifiers, eval and dynamic tool names remain unknown', () => {
  const a = analyze(`const x = eval(secret); const y = missing.toString(); await tracker.post_comment({body: y}); await tools[server].send({body: x});`);
  assert.ok(a.deps.x.includes('unknown'));
  assert.ok(a.deps.y.includes('unknown'));
  assert.ok(a.errors.length);
});


test('run B round 3 blocks the comment and traces its body to the payroll result', async () => {
  const analysis = analyze(await recorded('b', 3));
  const events = [];
  let sent = false;
  const policies = {
    payroll: { source: 'private', sink: 'private', taint: 'trusted' },
    tracker: { source: 'public', sink: 'public', taint: 'untrusted' },
    hr: { source: 'private', sink: 'private', taint: 'trusted' },
  };
  const clients = {
    payroll: { callTool: async () => [{ gross: 100 }] },
    tracker: { callTool: async () => { sent = true; } },
    hr: { callTool: async () => ({}) },
  };
  const tools = wrapTools(clients, policies, analysis, e => events.push(e));
  await tools.payroll.get_salaries({ month: '2026-10' });
  await tools.tracker.post_comment({ issue: 42, body: 'October payroll total: $100' });
  const payroll = events.find(e => e.type === 'value' && e.sensitivity === 'private');
  const blocked = events.find(e => e.type === 'blocked');
  assert.equal(sent, false);
  assert.deepEqual(blocked.args.body.from, [payroll.id]);
  // New one-sentence reason names the private source and the public sink.
  assert.match(blocked.reason, /comes from payroll\.get_salaries \(private\)/);
  assert.match(blocked.reason, /tracker is public/);
  assert.match(blocked.reason, /so the call was blocked before it was sent\.$/);
  // The payroll total is trusted, so untrusted text is NOT mentioned.
  assert.doesNotMatch(blocked.reason, /untrusted/);
});

test('finds tool calls returned directly from a wrapper', () => {
  const a = analyze('async () => { return await payroll.get_salaries({}); }');
  assert.equal(a.sites[0].tool, 'get_salaries');
  assert.deepEqual(a.errors, []);
});
