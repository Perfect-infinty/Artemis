// Skills in the system prompt, learning tools and sub-agents through the real agent loop. node scripts/test-learn.js
const assert = require('assert'); const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { runAgent } = require('../electron/agent');
const { createSkills } = require('../electron/skills');
const sse = (res, ev) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); for (const e of ev) res.write(`data: ${JSON.stringify(e)}\n\n`); res.write('data: [DONE]\n\n'); res.end(); };
const delta = (d, f = null) => ({ choices: [{ delta: d, finish_reason: f }] });
const call = (id, name, args) => delta({ tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args) } }] });

(async () => {
  const reqs = [];
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => (body += c));
    req.on('end', () => {
      const b = JSON.parse(body); reqs.push(b);
      const sys = b.messages[0].content; const isSub = /You are a helper agent working/.test(sys);
      const last = b.messages[b.messages.length - 1];
      if (isSub) return sse(res, [delta({ content: 'FOUND: 42 [source]' }, 'stop')]);
      if (last.role === 'user' && /research/.test(last.content)) return sse(res, [call('d1', 'delegate', { tasks: ['find the number', 'find the color'], context: 'ctx' }), delta({}, 'tool_calls')]);
      if (last.role === 'user' && /teach/.test(last.content)) return sse(res, [call('s1', 'create_skill', { name: 'Report style', description: 'Use for reports', instructions: '1. Be short' }), delta({}, 'tool_calls')]);
      return sse(res, [delta({ content: 'All done.' }, 'stop')]);
    });
  });
  await new Promise((r) => server.listen(0, r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-'));
  const skills = createSkills({ userDir: path.join(tmp, 's'), getDisabled: () => [], setDisabled: () => {} });
  skills.save({ name: 'Weekly report', description: 'Use when asked for the weekly report', body: 'steps', by: 'user' });
  const api = { index: () => skills.indexText(null), get: (n) => skills.get(n, null), save: (o) => skills.save(o, null) };
  const base = { baseUrl, key: 'k', model: 'm', toolsEnabled: true, memoryEnabled: false, webEnabled: false, shellEnabled: false, approve: async () => false, signal: new AbortController().signal };
  const run = async (extra, text) => { const ev = []; const usage = []; await runAgent({ ...base, ...extra, messages: [{ role: 'user', content: text }], send: (e) => ev.push(e), onUsage: (u) => usage.push(u) }); return { ev, usage }; };

  // 1) skills listed in the system prompt + learning instructions; tools offered
  let r = await run({ skills: api, autoLearn: true, delegateEnabled: true }, 'hello');
  let sys = reqs[0].messages[0].content;
  assert(/Weekly report: Use when asked for the weekly report/.test(sys) && /call use_skill/.test(sys) && /create_skill/.test(sys) && /delegate sends research/.test(sys));
  let names = reqs[0].tools.map((t) => t.function.name);
  assert(['use_skill', 'create_skill', 'update_skill', 'delegate'].every((n) => names.includes(n)));
  // 2) without autoLearn: no learning tools, no learning instructions
  reqs.length = 0; await run({ skills: api, autoLearn: false, delegateEnabled: false }, 'hello');
  names = reqs[0].tools.map((t) => t.function.name);
  assert(names.includes('use_skill') && !names.includes('create_skill') && !names.includes('delegate') && !/Learning:/.test(reqs[0].messages[0].content));
  // 3) the agent saves a skill by itself
  reqs.length = 0; r = await run({ skills: api, autoLearn: true }, 'teach: keep reports short');
  assert(skills.find('Report style', null), 'skill was written'); assert(r.ev.some((e) => e.type === 'notice' && /Saved new skill: Report style/.test(e.text)));
  assert(skills.list(null).find((s) => s.name === 'Report style').byAgent);
  // 4) sub-agents: parallel helpers, isolated, read-only, usage counted, only final answers come back
  reqs.length = 0; r = await run({ skills: api, autoLearn: true, delegateEnabled: true }, 'research please');
  const subReqs = reqs.filter((b) => /You are a helper agent working/.test(b.messages[0].content));
  assert.strictEqual(subReqs.length, 2, 'two helpers ran');
  for (const b of subReqs) {
    const n = (b.tools || []).map((t) => t.function.name);
    assert(!n.includes('delegate') && !n.includes('create_skill') && !n.includes('run_command') && !n.includes('write_file'), 'helpers are read-only: ' + n);
    assert(/Task:\nfind the (number|color)/.test(b.messages[1].content) && /Background:\nctx/.test(b.messages[1].content));
  }
  const toolMsg = reqs[reqs.length - 1].messages.find((m) => m.role === 'tool');
  assert(/### Helper #1: find the number\nFOUND: 42 \[source\]/.test(toolMsg.content) && !/interim/.test(toolMsg.content), toolMsg.content);
  assert(r.usage.length >= 4, 'helper usage is reported: ' + r.usage.length);
  assert(r.ev.some((e) => e.type === 'chunk' && /All done/.test(e.text)));
  fs.rmSync(tmp, { recursive: true, force: true }); server.close();
  console.log('learn: all tests passed');
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
