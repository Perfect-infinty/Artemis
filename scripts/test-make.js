const assert = require('assert');
const { createMake, cleanZone, validZone } = require('../electron/make');

(async () => {
  assert.strictEqual(cleanZone('https://EU1.make.com/foo'), 'eu1.make.com');
  assert.ok(validZone('eu1.make.com')); assert.ok(!validZone('evil'));
  const calls = [];
  const fetchImpl = async (u, o) => {
    calls.push({ url: String(u), method: o.method, auth: o.headers.authorization, body: o.body });
    const path = new URL(u).pathname;
    const reply = (j, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(j) });
    if (path === '/api/v2/organizations') return reply({ organizations: [{ id: 5, name: 'Org', zone: 'eu1.make.com' }] });
    if (path === '/api/v2/teams') return reply({ teams: [{ id: 9, name: 'Team' }] });
    if (path === '/api/v2/scenarios/5/logs') return reply({ scenarioLogs: [{ id: 'a', timestamp: '2026-10-13T10:00:00Z', status: 1, operations: 3, duration: 1200 }, { id: 'b', timestamp: '2026-10-13T09:00:00Z', status: 3, operations: 1, duration: 300 }] });
    if (path === '/api/v2/scenarios' && o.method === 'GET' && new URL(u).searchParams.get('teamId') === '9' && globalThis.__okList) return reply({ scenarios: [{ id: 5, name: 'Lead sync', teamId: 9, isActive: true, scheduling: { type: 'indefinitely', interval: 900 } }, { id: 6, name: 'Backup', teamId: 9, isActive: false }] });
    if (path === '/api/v2/scenarios' && o.method === 'POST') {
      const bp = JSON.parse(JSON.parse(o.body).blueprint);
      const m = bp.flow && bp.flow[0];
      if (m && m.module === 'http:ActionSendData' && m.version < 4) return reply({ detail: `Module not found '${m.module}' version '${m.version}'` }, 400);
      if (m && m.module === 'bad:Module') return reply({ detail: "Module not found 'bad:Module' version '1'" }, 400);
      return reply({ scenario: { id: 77, name: 'x' } });
    }
    if (path === '/api/v2/scenarios/77/start') return reply({ scenario: { id: 77, isActive: true } });
    if (path === '/api/v2/scenarios') return reply({ detail: 'nope' }, 403);
    return reply({});
  };
  const mk = createMake({ getAuth: () => ({ token: 'T0K', zone: 'eu1.make.com' }), fetchImpl });
  const ov = await mk.overview();
  assert.deepStrictEqual(ov[0].teams, [{ id: 9, name: 'Team' }]);
  assert.strictEqual(calls[0].auth, 'Token T0K');
  const bp = { name: 'S', flow: [] };
  const sc = await mk.actions.createScenario({ teamId: 9, blueprint: bp });
  assert.strictEqual(sc.id, 77);
  const post = calls.find((c) => c.method === 'POST');
  const body = JSON.parse(post.body);
  assert.strictEqual(typeof body.blueprint, 'string'); assert.strictEqual(typeof body.scheduling, 'string');
  assert.strictEqual(body.teamId, 9);
  // template: the built-in HTTP module is retried with other versions, then switched on
  const t = await mk.actions.createScenario({ teamId: 9, template: { type: 'http_request', url: 'https://jsonplaceholder.typicode.com/posts?_limit=5', name: 'Demo' }, activate: true });
  assert.strictEqual(t.id, 77); assert.strictEqual(t.isActive, true);
  const tb = JSON.parse(JSON.parse(calls.filter((c) => c.method === 'POST' && new URL(c.url).pathname === "/api/v2/scenarios").pop().body).blueprint);
  assert.strictEqual(tb.flow[0].module, 'http:ActionSendData'); assert.strictEqual(tb.flow[0].version, 4); assert.strictEqual(tb.flow[0].mapper.method, 'get'); assert.strictEqual(tb.name, 'Demo');
  await assert.rejects(() => mk.actions.createScenario({ teamId: 9, blueprint: { name: 'B', flow: [{ id: 1, module: 'bad:Module', version: 1 }] } }), /cannot be guessed/);
  await assert.rejects(() => mk.actions.createScenario({ teamId: 9 }), /template/);
  await mk.actions.setActive({ id: 77, active: true });
  assert.ok(calls.some((c) => c.url.endsWith('/scenarios/77/start')));
  await assert.rejects(() => mk.actions.listScenarios({ teamId: 9 }), /403.*scope|paid/);
  globalThis.__okList = true;
  const all = await mk.listAll();
  assert.strictEqual(all.scenarios.length, 2); assert.strictEqual(all.scenarios[0].url, 'https://eu1.make.com/9/scenarios/5/edit'); assert.strictEqual(all.scenarios[0].teamName, 'Team');
  const lg = await mk.logs({ id: 5 }); assert.deepStrictEqual(lg.map((x) => x.status), [1, 3]);
  globalThis.__okList = false;
  await assert.rejects(() => mk.call('GET', '/../x'), /Invalid/);
  const none = createMake({ getAuth: () => ({ token: '', zone: 'eu1.make.com' }), fetchImpl });
  await assert.rejects(() => none.overview(), /not connected/);
  console.log('make: all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
