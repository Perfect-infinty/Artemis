const assert = require('assert');
const { createClaudeUsage, parseUsage, readLogin } = require('../electron/claude-usage');
(async () => {
  // structured limits
  const a = parseUsage({ limits: [{ kind: 'session', percent: 42.34, resets_at: '2026-10-14T15:00:00Z' }, { kind: 'weekly_all', percent: 10, resets_at: '2026-10-19T00:00:00Z' }, { kind: 'weekly_scoped', percent: 5, resets_at: '2026-10-19T00:00:00Z', scope: { model: { display_name: 'Opus' } } }] });
  assert.deepStrictEqual(a.rows.map((r) => [r.key, r.percent]), [['session', 42.3], ['weekly', 10], ['weekly:Opus', 5]]);
  // flat keys
  const b = parseUsage({ five_hour: { utilization: 7, resets_at: '2026-10-14T15:00:00Z' }, seven_day: { utilization: 20, resets_at: null }, seven_day_opus: null, extra_usage: { is_enabled: true, monthly_limit: 50, used_credits: 3, utilization: 6 } });
  assert.strictEqual(b.rows.length, 2); assert.strictEqual(b.extra.used, 3);
  assert.strictEqual(parseUsage({}).rows.length, 0);
  // login from keychain json
  const lg = await readLogin({ readKeychainFn: async () => JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: 9e15, subscriptionType: 'max' } }), home: '/nonexistent', env: {} });
  assert.strictEqual(lg.plan, 'max');
  assert.strictEqual(await readLogin({ readKeychainFn: async () => 'garbage', home: '/nonexistent', env: {} }), null);
  // flow
  let calls = 0; let seen = {};
  const ok = createClaudeUsage({ login: async () => ({ accessToken: 'secret', expiresAt: 0, plan: 'pro' }), fetchFn: async (u, o) => { calls++; seen = o.headers; return { status: 200, ok: true, json: async () => ({ five_hour: { utilization: 1, resets_at: null } }) }; } });
  const r1 = await ok(); const r2 = await ok();
  assert.ok(r1.ok && r2.ok && calls === 1); assert.strictEqual(seen['anthropic-beta'], 'oauth-2025-04-20'); assert.ok(!JSON.stringify(r1).includes('secret'));
  await ok({ force: true }); assert.strictEqual(calls, 2);
  assert.strictEqual((await createClaudeUsage({ login: async () => null })()).kind, 'no-login');
  assert.strictEqual((await createClaudeUsage({ login: async () => ({ accessToken: 't', expiresAt: 5 }), now: () => 100 })()).kind, 'expired');
  assert.strictEqual((await createClaudeUsage({ login: async () => ({ accessToken: 't' }), fetchFn: async () => ({ status: 401, ok: false }) })()).kind, 'expired');
  assert.strictEqual((await createClaudeUsage({ login: async () => ({ accessToken: 't' }), fetchFn: async () => { throw new Error('offline'); } })()).kind, 'network');
  console.log('claude-usage: all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
