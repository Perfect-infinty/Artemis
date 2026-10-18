const assert = require('assert');
const { createScheduler, nextRunAfter, describe } = require('../electron/scheduler.js');
const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime();
const from = at(2026, 10, 13, 14, 0); // Tuesday
assert.strictEqual(nextRunAfter({ repeat: { type: 'daily', at: '15:30' } }, from), at(2026, 10, 13, 15, 30));
assert.strictEqual(nextRunAfter({ repeat: { type: 'daily', at: '09:00' } }, from), at(2026, 10, 14, 9, 0));
assert.strictEqual(nextRunAfter({ repeat: { type: 'weekdays', at: '08:00' } }, at(2026, 10, 16, 10, 0)), at(2026, 10, 19, 8, 0)); // Fri -> Mon
assert.strictEqual(nextRunAfter({ repeat: { type: 'weekly', at: '10:00', days: [1, 3] } }, from), at(2026, 10, 14, 10, 0)); // Wed
assert.strictEqual(nextRunAfter({ repeat: { type: 'monthly', at: '09:00', dayOfMonth: 31 } }, at(2026, 11, 1, 0, 0)), at(2026, 11, 30, 9, 0)); // clamped
assert.strictEqual(nextRunAfter({ repeat: { type: 'interval', every: 30 } }, from), from + 30 * 60000);
assert.strictEqual(nextRunAfter({ repeat: { type: 'once', date: '2026-10-20', at: '12:00' } }, from), at(2026, 10, 20, 12, 0));
assert.strictEqual(nextRunAfter({ repeat: { type: 'once', date: '2026-10-01', at: '12:00' } }, from), null);
assert.strictEqual(describe({ repeat: { type: 'weekly', at: '10:00', days: [1, 3] } }), 'Mon, Wed at 10:00');
assert.strictEqual(describe({ repeat: { type: 'interval', every: 120 } }), 'Every 2 hours');

(async () => {
  let store = [], t = from; const ran = [];
  const s = createScheduler({ read: () => store, write: (l) => { store = l; }, now: () => t, run: async (job, o) => { ran.push([job.id, !!o.manual]); return job.prompt === 'fail' ? { ok: false, error: 'boom' } : { ok: true }; } });
  assert.throws(() => s.save({ name: '', prompt: 'x', repeat: { type: 'daily' } }), /name/);
  assert.throws(() => s.save({ name: 'a', prompt: 'x', repeat: { type: 'interval', every: 1 } }), /5 minutes/);
  const a = s.save({ name: 'Report', prompt: 'summarize', repeat: { type: 'interval', every: 60 } });
  assert.strictEqual(a.reminder, false);
  const rm = s.save({ name: 'Water', prompt: 'Time to drink water!', reminder: true, repeat: { type: 'interval', every: 60 } });
  assert.strictEqual(rm.reminder, true); assert.strictEqual(s.list().find((j) => j.id === rm.id).reminder, true); s.remove(rm.id);
  const f = s.save({ name: 'Bad', prompt: 'fail', repeat: { type: 'once', date: '2026-10-13', at: '14:30' } });
  assert.strictEqual(a.nextRun, from + 3600000);
  s.tick(); await new Promise((r) => setTimeout(r, 5)); assert.strictEqual(ran.length, 0);   // not due yet
  t = at(2026, 10, 13, 14, 31); s.tick(); await new Promise((r) => setTimeout(r, 10));
  assert.deepStrictEqual(ran, [[f.id, false]]);
  const fj = s.list().find((j) => j.id === f.id);
  assert.strictEqual(fj.lastStatus, 'error'); assert.strictEqual(fj.lastError, 'boom'); assert.strictEqual(fj.enabled, false); // one-time jobs switch themselves off
  t = from + 3600000 + 1000; s.tick(); await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(ran.length, 2);
  const aj = s.list().find((j) => j.id === a.id);
  assert.strictEqual(aj.lastStatus, 'ok'); assert.strictEqual(aj.runs, 1); assert.strictEqual(aj.nextRun, t + 3600000);
  await s.runNow(a.id); assert.deepStrictEqual(ran[2], [a.id, true]);
  assert.strictEqual(s.list().find((j) => j.id === a.id).nextRun, t + 3600000); // running by hand does not change the schedule
  s.toggle(a.id, false); assert.strictEqual(s.list().find((j) => j.id === a.id).nextRun, null);
  s.remove(a.id); assert.ok(!s.list().some((j) => j.id === a.id));
  // one-time jobs in the past are rejected, and a stale one is switched off once instead of rewritten every tick
  assert.throws(() => s.save({ name: 'Old', prompt: 'x', repeat: { type: 'once', date: '2026-10-01', at: '12:00' } }), /already passed/);
  assert.ok(s.save({ name: 'Old off', prompt: 'x', enabled: false, repeat: { type: 'once', date: '2026-10-01', at: '12:00' } }).id);
  let writes = 0;
  store = [{ id: 'old', name: 'Old', prompt: 'x', enabled: true, nextRun: null, repeat: { type: 'once', date: '2026-10-01', at: '12:00' } }];
  const s2 = createScheduler({ read: () => store, write: (l) => { writes++; store = l; }, now: () => t, run: async () => ({ ok: true }) });
  s2.tick(); s2.tick(); s2.tick();
  assert.strictEqual(writes, 1); assert.strictEqual(store[0].enabled, false);
  s2.toggle('old', true); assert.strictEqual(store[0].enabled, false, 'cannot switch on a past one-time job');
  console.log('scheduler: all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
