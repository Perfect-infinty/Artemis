const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const b = require('../electron/brains');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brains-'));
  let changed = 0;
  const reg = b.createBrains({ userDir: dir, notify: () => changed++ });
  let l = reg.list();
  assert.deepStrictEqual(l.map((x) => x.name), ['Lancelot', 'Galahad', 'Percival']);
  assert(l.every((x) => x.builtin && x.body && x.model === ''));
  // choose a model for one brain -> file override, order kept
  assert(reg.save({ name: 'Galahad', role: 'The Guardian', description: 'x', model: 'prov:cf:kimi', body: 'Be careful.' }).ok);
  l = reg.list();
  assert.deepStrictEqual(l.map((x) => x.name), ['Lancelot', 'Galahad', 'Percival']);
  assert.strictEqual(reg.find('galahad').model, 'prov:cf:kimi');
  assert.strictEqual(reg.find('Galahad').body, 'Be careful.');
  // a fourth brain
  assert(reg.save({ name: 'Tristan', role: 'Tester', description: '', model: '', body: 'You test things.' }).ok);
  assert.strictEqual(reg.list().length, 4);
  assert.strictEqual(reg.list()[3].name, 'Tristan');
  assert(!reg.save({ name: '', body: 'x' }).ok); assert(!reg.save({ name: 'A', body: '' }).ok);
  // deleting an override brings back the default
  assert(reg.remove('galahad').ok);
  assert.strictEqual(reg.find('galahad').model, '');
  assert(reg.remove('tristan').ok); assert.strictEqual(reg.list().length, 3);
  assert(changed >= 4);

  // persona text
  assert(/Lancelot/.test(b.personaText(reg.find('lancelot'))));

  // tally: majority + 2-vote rule
  const brains = reg.list();
  const V = (brain, answerer, skills = [], agents = []) => ({ brain, ok: true, answerer, skills, agents, reason: '' });
  let t = b.tally([V('Lancelot', 'Galahad', ['seo'], ['Athena']), V('Galahad', 'Galahad', ['seo'], []), V('Percival', 'Percival', [], ['Athena'])], brains);
  assert.strictEqual(t.answerer, 'Galahad'); assert.deepStrictEqual(t.skills, ['seo']); assert.deepStrictEqual(t.agents, ['Athena']); assert(!t.unanimous);
  t = b.tally([V('Lancelot', 'percival'), V('Galahad', 'Percival'), V('Percival', 'PERCIVAL')], brains);
  assert.strictEqual(t.answerer, 'Percival'); assert(t.unanimous);
  // all different -> first brain in order wins the tie
  t = b.tally([V('Lancelot', 'Percival'), V('Galahad', 'Galahad'), V('Percival', 'Lancelot')], brains);
  assert.strictEqual(t.answerer, 'Lancelot');
  // one failed voter is ignored; single voter's skill counts
  t = b.tally([{ brain: 'Lancelot', ok: false }, V('Galahad', 'Galahad', ['x']), { brain: 'Percival', ok: false }], brains);
  assert.strictEqual(t.answerer, 'Galahad'); assert.deepStrictEqual(t.skills, ['x']);
  // nobody answered -> first brain
  t = b.tally([{ ok: false }, { ok: false }], brains);
  assert.strictEqual(t.answerer, 'Lancelot');
  assert.strictEqual(b.verdictHint({ skills: [], agents: [] }), '');
  assert(/use_skill/.test(b.verdictHint({ skills: ['seo'], agents: [] })) && /delegate/.test(b.verdictHint({ skills: [], agents: ['Athena'] })));

  // deliberate: runs every brain in parallel, a failing brain does not break it
  const seen = [];
  const out = await b.deliberate({
    brains, conversation: 'USER: write a blog post', skillsIndex: '- seo: x', agentsIndex: '- Calliope (Writer): x',
    call: async (br, sys, user) => {
      seen.push(br.name); assert(sys.includes(br.name) && sys.includes('- seo: x') && sys.includes('Calliope')); assert(user.includes('blog'));
      if (br.name === 'Percival') throw new Error('HTTP 429');
      return { answerer: 'Percival', skills: ['seo'], agents: ['Calliope'], reason: 'writing task' };
    }
  });
  assert.deepStrictEqual(seen.sort(), ['Galahad', 'Lancelot', 'Percival']);
  assert.strictEqual(out.votes.filter((v) => v.ok).length, 2);
  assert.strictEqual(out.verdict.answerer, 'Percival'); assert.deepStrictEqual(out.verdict.agents, ['Calliope']);

  // askJson: parses JSON out of chatter, reports usage, throws on HTTP errors
  let usage = null;
  const fake = (body, ok = true) => async () => ({ ok, status: ok ? 200 : 500, json: async () => body });
  const r = await b.askJson({ url: 'u', key: 'k', model: 'm', system: 's', user: 'u', onUsage: (u) => { usage = u; }, fetchImpl: fake({ choices: [{ message: { content: 'Sure! {"answerer":"Lancelot","skills":[]} done' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) });
  assert.strictEqual(r.answerer, 'Lancelot'); assert.deepStrictEqual(usage, { model: 'm', prompt: 10, completion: 5, estimated: false });
  assert.strictEqual(await b.askJson({ url: 'u', model: 'm', system: 's', user: 'u', fetchImpl: fake({ choices: [{ message: { content: 'no json here' } }] }) }), null);
  await assert.rejects(() => b.askJson({ url: 'u', model: 'm', system: 's', user: 'u', fetchImpl: fake({}, false) }), /HTTP 500/);
  // reasoning text before the answer is ignored; a reply cut off by the token limit says so
  const th = await b.askJson({ url: 'u', model: 'm', system: 's', user: 'u', fetchImpl: fake({ choices: [{ message: { content: '<think>maybe {"answerer":"X"}</think>{"answerer":"Galahad"}' } }] }) });
  assert.strictEqual(th.answerer, 'Galahad');
  await assert.rejects(() => b.askJson({ url: 'u', model: 'm', system: 's', user: 'u', fetchImpl: fake({ choices: [{ message: { content: '<think>long' }, finish_reason: 'length' }] }) }), /cut off/);
  console.log('brains: all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
