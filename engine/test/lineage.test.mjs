import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { analyze } from '../src/lineage.ts';
import { check } from '../src/policy.ts';

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

test('marks unsupported control flow and dynamic calls unknown', () => {
  const a = analyze(`let total = 0;
for (const row of rows) total += row.salary;
await tools[server].send({total});`);
  assert.ok(a.errors.length >= 2);
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

test('tracks reassignment and fails closed on object mutation', () => {
  const a = analyze(`const rows = await tools.payroll.get_salaries({});
let total = 0;
total = rows.length;
const payload = { amount: 0 };
payload.amount = total;
await tools.tracker.comment(payload);`);
  assert.ok(a.deps.total.includes('rows'));
  assert.ok(a.deps.payload.includes('unknown'));
  assert.deepEqual(a.sites[1].args.unknown, ['unknown']);
});

test('analyzes the direct server calls used by the canonical run', () => {
  const a = analyze('const pay = await payroll.get_salaries({month: "2026-10"});\nconst total = pay.reduce((s, r) => s + r.gross, 0);\nawait tracker.post_comment({issue: 42, body: `total ${total}`});');
  assert.deepEqual(a.sites.map(s => [s.server, s.tool]), [['payroll', 'get_salaries'], ['tracker', 'post_comment']]);
  assert.deepEqual(a.deps.pay, [a.sites[0].id]);
  assert.deepEqual(a.sites[1].args.body, ['total']);
  assert.deepEqual(a.errors, []);
});
