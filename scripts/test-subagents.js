// Role agents: definitions, tool limits, per-agent model, write approval, locks, review. node scripts/test-subagents.js
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sa = require('../electron/subagents');
const tools = require('../electron/tools');
const { runAgent } = require('../electron/agent');

const sse = (res, events) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`); res.write('data: [DONE]\n\n'); res.end(); };
const delta = (d, finish = null) => ({ choices: [{ delta: d, finish_reason: finish }] });
const call = (id, name, args) => delta({ tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args) } }] });

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-agents-'));
  // ---- definitions
  const reg = sa.createAgents({ userDir: path.join(tmp, 'agents') });
  assert.deepStrictEqual(reg.list(null).map((a) => a.name), ['Athena', 'Calliope', 'Hephaestus', 'Themis']);
  assert.ok(reg.find('researcher', null).builtin && reg.find('Athena', null).role === 'Researcher');
  assert.ok(!reg.save({ name: '', body: 'x' }).ok && !reg.save({ name: 'X', body: '' }).ok);
  assert.ok(reg.save({ name: 'Hephaestus', role: 'Coder', description: 'mine', model: 'prov:a:b', tools: ['read', 'bogus'], body: 'Be terse.' }).ok);
  const c = reg.find('Coder', null);
  assert.ok(c.name === 'Hephaestus' && c.overrides);
  assert.ok(!c.builtin && c.model === 'prov:a:b' && c.description === 'mine' && c.body === 'Be terse.' && c.tools.join() === 'read');
  assert.ok(reg.remove('Hephaestus', null).ok && reg.find('Coder', null).builtin);
  // project agents: never override built-in or user agents, capped, marked untrusted; deleting the user file keeps the project file
  {
    const pr = path.join(tmp, 'pr'); const pd = path.join(pr, '.artemis', 'agents'); fs.mkdirSync(pd, { recursive: true });
    fs.writeFileSync(path.join(pd, 'athena.md'), `---\nname: Athena\nrole: Researcher\ndescription: ${'d'.repeat(500)}\ntools: web\n---\n${'b'.repeat(20000)}`);
    fs.writeFileSync(path.join(pd, 'mine.md'), '---\nname: Mine\nrole: Helper\ndescription: m\ntools: read\n---\nDo it.');
    const r3 = sa.createAgents({ userDir: path.join(tmp, 'agents3') });
    assert.ok(r3.find('Athena', pr).builtin && r3.find('researcher', pr).builtin, 'built-in wins over a project file');
    const pa = r3.list(pr).find((a) => a.source === 'project' && a.slug === 'athena-project');
    assert.ok(pa && pa.name === 'Athena (project)' && pa.description.length <= 200 && pa.body.length <= 8000);
    assert.ok(/Mine \(Helper\) \(project-defined, untrusted\)/.test(r3.indexText(pr)));
    r3.save({ name: 'Mine', description: 'user one', tools: ['read'], body: 'User version.' });
    assert.strictEqual(r3.find('mine', pr).source, 'user');
    assert.ok(r3.remove('Mine', pr).ok);
    assert.ok(fs.existsSync(path.join(pd, 'mine.md')), 'the project file is not deleted with the user file');
    assert.strictEqual(r3.find('mine', pr).source, 'project');
  }
  const T = sa.toolNames(['read', 'write']);
  assert.ok(T.has('write_file') && T.has('read_file') && !T.has('delete_file') && !T.has('run_command') && !T.has('delegate'));
  assert.deepStrictEqual(tools.jobsOf({ tasks: ['a', { agent: 'Coder', task: 'b' }, { task: '' }] }), [{ agent: '', task: 'a' }, { agent: 'Coder', task: 'b' }]);
  assert.strictEqual(tools.jobsOf({ tasks: Array(9).fill('t') }).length, 4);

  // ---- file lock: two writers to one file run one after the other
  const order = [];
  const w = (n, ms) => tools.withLocks(['f'], async () => { order.push('s' + n); await new Promise((r) => setTimeout(r, ms)); order.push('e' + n); });
  await Promise.all([w(1, 30), w(2, 5), w(3, 5)]);
  assert.deepStrictEqual(order, ['s1', 'e1', 's2', 'e2', 's3', 'e3']);

  // ---- full run with a fake endpoint
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (d) => (body += d));
    req.on('end', () => {
      const b = JSON.parse(body); const sys = String(b.messages[0].content);
      const isSub = /helper agent working/.test(sys);
      const names = (b.tools || []).map((t) => t.function.name);
      const hasToolMsg = b.messages.some((m) => m.role === 'tool');
      seen.push({ model: b.model, isSub, names, sys });
      if (!isSub) {
        if (hasToolMsg) return sse(res, [delta({ content: 'final answer' }, 'stop')]);
        return sse(res, [call('d1', 'delegate', { tasks: [{ agent: 'Coder', task: 'write x' }, { agent: 'Researcher', task: 'find y' }], review: true }), delta({}, 'tool_calls')]);
      }
      if (/strict reviewer/.test(sys)) return sse(res, [delta({ content: 'OK' }, 'stop')]);
      if (b.model === 'strong') {
        if (hasToolMsg) return sse(res, [delta({ content: 'wrote it' }, 'stop')]);
        return sse(res, [call('w1', 'write_file', { path: 'out/x.txt', content: 'hello' }), delta({}, 'tool_calls')]);
      }
      return sse(res, [delta({ content: 'found y' }, 'stop')]);
    });
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const reg2 = sa.createAgents({ userDir: path.join(tmp, 'agents2') });
  reg2.save({ name: 'Coder', description: 'c', model: 'prov:p:strong', tools: ['read', 'write'], body: 'You are the coder.' });
  reg2.save({ name: 'Researcher', description: 'r', model: 'prov:p:cheap', tools: ['web', 'read'], body: 'You research.' });
  const proj = path.join(tmp, 'proj'); fs.mkdirSync(proj);
  const events = [], approvals = [], usage = [];
  await runAgent({
    baseUrl: base, key: 'k', model: 'main', usageModel: 'main-id', messages: [{ role: 'user', content: 'go' }], root: proj, toolsEnabled: true, webEnabled: true,
    delegateEnabled: true, agents: { find: (n) => reg2.find(n, null), list: () => reg2.list(null), index: () => reg2.indexText(null) },
    resolveModel: (id) => ({ baseUrl: base, key: 'k', model: id.split(':')[2] }),
    autoApprove: true, agentAutoApprove: false, // agents must still ask
    approve: async (info) => { approvals.push(info); return true; },
    onUsage: (u) => usage.push(u.model), send: (e) => events.push(e)
  });
  const starts = events.filter((e) => e.type === 'agent:start');
  assert.deepStrictEqual(starts.map((e) => e.agent).sort(), ['Coder', 'Researcher', 'Themis']);
  assert.ok(starts.every((e) => e.parent === 'd1'));
  assert.strictEqual(approvals.length, 1);
  assert.ok(approvals[0].agent === 'Coder' && /^d1:0:w1$/.test(approvals[0].id) && approvals[0].name === 'write_file');
  assert.strictEqual(fs.readFileSync(path.join(proj, 'out/x.txt'), 'utf8'), 'hello');
  const subs = seen.filter((x) => x.isSub);
  const coder = subs.find((x) => x.model === 'strong'), res = subs.find((x) => x.model === 'cheap'), rev = subs.find((x) => /strict reviewer/.test(x.sys));
  assert.ok(coder && res && rev);
  assert.ok(coder.names.includes('write_file') && !coder.names.includes('delete_file') && !coder.names.includes('delegate') && !coder.names.includes('web_search'));
  assert.ok(res.names.includes('web_search') && !res.names.includes('write_file') && !res.names.includes('delegate'));
  assert.ok(!rev.names.includes('write_file'));
  assert.ok(usage.includes('prov:p:strong') && usage.includes('prov:p:cheap'));
  assert.ok(events.some((e) => e.type === 'tool:call' && e.agent && e.agent.name === 'Coder' && e.id === 'd1:0:w1'));
  assert.ok(events.filter((e) => e.type === 'agent:done' && e.ok).length === 3);
  const mainSys = seen.find((x) => !x.isSub).sys;
  assert.ok(/Available agents/.test(mainSys) && /Researcher/.test(mainSys));
  const toolRes = events.find((e) => e.type === 'tool:result' && e.id === 'd1');
  assert.ok(/### Coder/.test(toolRes.text) && /found y/.test(toolRes.text) && /### Reviewer\nOK/.test(toolRes.text));
  // denied write
  approvals.length = 0; fs.rmSync(path.join(proj, 'out'), { recursive: true });
  await runAgent({ baseUrl: base, key: 'k', model: 'main', messages: [{ role: 'user', content: 'go' }], root: proj, toolsEnabled: true, delegateEnabled: true,
    agents: { find: (n) => reg2.find(n, null), list: () => reg2.list(null), index: () => '' }, resolveModel: (id) => ({ baseUrl: base, key: 'k', model: id.split(':')[2] }),
    approve: async (i) => { approvals.push(i); return false; }, send: () => {} });
  assert.ok(!fs.existsSync(path.join(proj, 'out/x.txt')));
  const { buildSystem } = require('../electron/agent');
  assert.ok(/name: Alex\)?:\nFounder in Berlin/.test(buildSystem({ userName: 'Alex', userAbout: 'Founder in Berlin' })));
  assert.ok(!/About the user/.test(buildSystem({ userName: '', userAbout: '' })) && !/About the user/.test(buildSystem({ userName: 'U', userAbout: 'x', isSub: true })));
  server.close(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log('subagents: all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
