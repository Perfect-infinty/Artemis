const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { createSkills, parseSkill, slugOf } = require('../electron/skills.js');
const cs = require('../electron/chatsearch.js');
const tools = require('../electron/tools.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-skills-'));
let disabled = []; let notified = 0;
const sk = createSkills({ userDir: path.join(tmp, 'skills'), getDisabled: () => disabled, setDisabled: (l) => { disabled = l; }, notify: () => { notified++; } });
assert.strictEqual(slugOf('Weekly Report!!'), 'weekly-report');
assert.deepStrictEqual(parseSkill('---\nname: A\ndescription: "desc here"\n---\n\nBody text'), { meta: { name: 'A', description: 'desc here' }, body: 'Body text' });
// create / validation
let r = sk.save({ name: 'Weekly report', description: 'Use when asked for the weekly report', body: '1. Open the sheet\n2. Summarize', by: 'agent', mode: 'create' });
assert.ok(r.ok && r.name === 'Weekly report' && !r.updated, JSON.stringify(r));
assert.ok(!sk.save({ name: 'Weekly report', description: 'x', body: 'y', mode: 'create' }).ok, 'duplicate create must fail');
assert.ok(!sk.save({ name: 'Nope', description: 'x', body: 'y', mode: 'update' }).ok, 'update of missing must fail');
assert.ok(!sk.save({ name: '', description: 'x', body: 'y' }).ok); assert.ok(!sk.save({ name: 'a', description: '', body: 'y' }).ok); assert.ok(!sk.save({ name: 'a', description: 'd', body: '' }).ok);
assert.ok(!sk.save({ name: 'big', description: 'd', body: 'x'.repeat(70000) }).ok);
// agent flag preserved on update, list / get / index
r = sk.save({ name: 'weekly report', description: 'Use when asked for the weekly report (v2)', body: 'new steps', by: 'user', mode: 'update' });
assert.ok(r.ok && r.updated && r.name === 'Weekly report');
let list = sk.list(null); assert.strictEqual(list.length, 1); assert.ok(list[0].byAgent && list[0].enabled);
assert.strictEqual(sk.get('Weekly report', null).body, 'new steps');
assert.ok(/- Weekly report: Use when asked/.test(sk.indexText(null)));
// disable removes from index
assert.ok(sk.setEnabled('Weekly report', false, null)); assert.strictEqual(sk.indexText(null), ''); assert.strictEqual(sk.list(null)[0].enabled, false);
sk.setEnabled('Weekly report', true, null);
// project skills
const proj = path.join(tmp, 'proj'); fs.mkdirSync(proj);
r = sk.save({ name: 'Deploy', description: 'Deploy the site', body: 'run deploy.sh', scope: 'project' }, proj);
assert.ok(r.ok && r.source === 'project' && fs.existsSync(path.join(proj, '.artemis', 'skills', 'deploy', 'SKILL.md')));
assert.strictEqual(sk.list(null).length, 1); assert.strictEqual(sk.list(proj).length, 2);
// import folder and file
const ext = path.join(tmp, 'ext', 'my-skill'); fs.mkdirSync(path.join(ext, 'scripts'), { recursive: true });
fs.writeFileSync(path.join(ext, 'SKILL.md'), '---\nname: Imported one\ndescription: From a folder\n---\nDo it.'); fs.writeFileSync(path.join(ext, 'scripts', 'a.py'), 'print(1)');
r = sk.importFrom(ext); assert.ok(r.ok, JSON.stringify(r)); assert.deepStrictEqual(sk.get('Imported one', null).files, ['scripts/a.py']);
assert.ok(!sk.importFrom(path.join(tmp, 'ext')).ok);
fs.writeFileSync(path.join(tmp, 'one.md'), '---\nname: File skill\ndescription: From a file\n---\nSteps'); assert.ok(sk.importFrom(path.join(tmp, 'one.md')).ok);
assert.ok(sk.remove('File skill', null)); assert.ok(!sk.remove('File skill', null)); assert.ok(notified > 3);

// chat search
const chats = [
  { id: 'c1', title: 'Invoice script', projectId: 'p1', updatedAt: Date.parse('2026-10-01'), messages: [{ role: 'user', content: 'write a python script for invoices' }, { role: 'assistant', steps: [{ text: 'Here is the invoice script using pandas', toolCalls: [] }] }] },
  { id: 'c2', title: 'Trip', updatedAt: Date.parse('2026-10-05'), messages: [{ role: 'user', content: 'plan Lisbon trip', attachments: [{ name: 'map.pdf' }] }] },
  { id: 'c3', title: 'Secret', incognito: true, messages: [{ role: 'user', content: 'invoice invoice' }] }
];
const hits = cs.searchChats(chats, 'invoice pandas', { projects: [{ id: 'p1', name: 'Work' }] });
assert.strictEqual(hits.length, 1); assert.strictEqual(hits[0].id, 'c1'); assert.strictEqual(hits[0].project, 'Work'); assert.ok(/pandas/.test(hits[0].snippet));
assert.strictEqual(cs.searchChats(chats, 'lisbon')[0].id, 'c2'); assert.deepStrictEqual(cs.searchChats(chats, 'zzz'), []); assert.deepStrictEqual(cs.searchChats(chats, ''), []);
assert.deepStrictEqual(cs.recentChats(chats, 5).map((c) => c.id), ['c2', 'c1']);
assert.deepStrictEqual(cs.chatTurns(chats[0]).map((t) => t.role), ['user', 'assistant']);
assert.ok(/User: write a python/.test(cs.transcript(chats[0])));

// tool wiring
const names = (f) => tools.definitions(f).map((d) => d.function.name);
assert.ok(!names({}).includes('use_skill'));
assert.ok(names({ skillsEnabled: true }).includes('use_skill') && !names({ skillsEnabled: true }).includes('create_skill'));
assert.ok(names({ skillsEnabled: true, learnEnabled: true }).includes('create_skill') && names({ skillsEnabled: true, learnEnabled: true }).includes('update_skill'));
assert.ok(names({ chatsEnabled: true }).includes('search_chats') && names({ delegateEnabled: true }).includes('delegate'));
(async () => {
  const ctxBase = { root: null, skills: { get: (n) => sk.get(n, null), save: (o) => sk.save(o, null) }, send: () => {} };
  let out = await tools.run('use_skill', { name: 'Weekly report' }, ctxBase); assert.ok(out.ok && /new steps/.test(out.text));
  out = await tools.run('use_skill', { name: 'nothing' }, ctxBase); assert.ok(!out.ok);
  // learning without autoLearn must ask for approval; declined -> nothing saved
  let asked = 0;
  out = await tools.run('create_skill', { name: 'Fresh', description: 'd', instructions: 'i' }, { ...ctxBase, autoLearnAllowed: true, autoLearn: false, approve: async () => { asked++; return false; } });
  assert.ok(out.denied && asked === 1 && !sk.find('Fresh', null));
  out = await tools.run('create_skill', { name: 'Fresh', description: 'd', instructions: 'i' }, { ...ctxBase, autoLearnAllowed: true, autoLearn: true, approve: async () => { throw new Error('should not ask'); } });
  assert.ok(out.ok && sk.find('Fresh', null));
  out = await tools.run('create_skill', { name: 'Fresh', description: 'd', instructions: 'i' }, { ...ctxBase, autoLearnAllowed: true, autoLearn: true }); assert.ok(!out.ok && /already exists/.test(out.text));
  out = await tools.run('update_skill', { name: 'Fresh', instructions: 'better' }, { ...ctxBase, autoLearnAllowed: true, autoLearn: true }); assert.ok(out.ok && sk.get('Fresh', null).body === 'better' && sk.get('Fresh', null).description === 'd');
  out = await tools.run('create_skill', { name: 'Blocked', description: 'd', instructions: 'i' }, { ...ctxBase, autoLearnAllowed: false }); assert.ok(!out.ok);
  // chats + delegate
  const chatsCtx = { chats: { search: (q) => cs.searchChats(chats, q), read: (id) => (id === 'c1' ? cs.transcript(chats[0]) : null) } };
  out = await tools.run('search_chats', { query: 'invoice' }, chatsCtx); assert.ok(out.ok && /\[c1\]/.test(out.text));
  out = await tools.run('read_chat', { id: 'c1' }, chatsCtx); assert.ok(/invoice script/i.test(out.text));
  out = await tools.run('read_chat', { id: 'zz' }, chatsCtx); assert.ok(!out.ok);
  const calls = [];
  out = await tools.run('delegate', { tasks: ['a', 'b'], context: 'ctx' }, { delegate: async (j, c) => { calls.push([j.task, c]); return 'answer ' + j.task; } });
  assert.ok(out.ok && /Helper #1: a\nanswer a/.test(out.text) && /Helper #2: b\nanswer b/.test(out.text) && calls.length === 2);
  out = await tools.run('delegate', { task: 'solo' }, { delegate: async (j) => 'done ' + j.task }); assert.strictEqual(out.text, 'done solo');
  out = await tools.run('delegate', {}, { delegate: async () => 'x' }); assert.ok(!out.ok);
  out = await tools.run('delegate', { task: 'x' }, {}); assert.ok(!out.ok);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('skills: all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
