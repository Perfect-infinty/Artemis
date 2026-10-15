// Tests for Sentinel's spoken commands.
const assert = require('assert');
(async () => {
  const m = await import('../src/lib/sentinel-commands.mjs');
  const brains = [{ slug: 'lancelot', name: 'Lancelot' }, { slug: 'galahad', name: 'Galahad' }, { slug: 'percival', name: 'Percival' }];
  const p = (t) => m.parseCommand(t, { brains });
  const is = (t, type, value) => { const c = p(t); assert(c, `no command for "${t}"`); assert.strictEqual(c.type, type, t); if (value !== undefined) assert.strictEqual(c.value, value, t); return c; };
  // agents
  is('disable agents', 'agents', 'off'); is('Disable AI agents.', 'agents', 'off'); is('turn off agents', 'agents', 'off'); is('agents on', 'agents', 'on');
  is('enable the agents', 'agents', 'on'); is('turn on sub agents', 'agents', 'on');
  assert.strictEqual(p('what are agents'), null); assert.strictEqual(p('tell me how the agents work in this app'), null);
  // brain
  is('disable brain', 'brain', ''); is('brains off', 'brain', '');;
  is('turn on the council', 'brain', 'council'); is('brain on', 'brain', 'council');;
  is('talk to Galahad', 'brain', 'galahad'); is('use Lancelot', 'brain', 'lancelot'); is('percival brain', 'brain', 'percival');
  assert.strictEqual(p('Galahad was a knight of the round table and he did many things in the stories'), null);
  // permissions
  is('auto approve on', 'perm', 'auto'); is('turn off auto approve', 'perm', 'ask');; is('ask me first', 'perm', 'ask');
  // chats
  is('new chat', 'newChat'); is('open a new chat', 'newChat'); is('start a fresh conversation', 'newChat');
  is('incognito chat', 'incognito'); is('new incognito chat', 'incognito');
  assert.strictEqual(p('write a story about a new chat app'), null);
  // model
  { const models = [{ id: 'openai', name: 'GPT-5 mini' }, { id: 'claude', name: 'Claude Sonnet' }, { id: 'prov:x:gpt-5', name: 'GPT-5' }];
    const q = (t) => m.parseCommand(t, { models });
    assert.strictEqual(q('switch model to GPT five mini').value, 'openai'); assert.strictEqual(q('use model claude sonnet').value, 'claude');
    assert.strictEqual(q('change the model to GPT 5').value, 'prov:x:gpt-5'); assert.strictEqual(q('set model to Claude Sonnet').type, 'model');
    assert.strictEqual(q('change model').type, 'modelAsk'); assert.strictEqual(q('what is a language model and how does it work in practice for me'), null);
    assert.strictEqual(m.confirmText(q('switch model to claude sonnet')), 'Model: Claude Sonnet.'); }
  // misc
  is('bye bye', 'bye'); is('Bye-bye.', 'bye'); is('goodbye', 'bye');
  assert.strictEqual(p('what does bye bye mean in turkish and how do you say it politely'), null);
  assert.strictEqual(m.confirmText(p('bye bye')), 'Bye.');
  is('stop', 'stop'); is('sentinel off', 'sentinelOff'); is('compact', 'compact');
  assert.strictEqual(is('open logs', 'open').page, 'logs'); assert.strictEqual(is('open automations', 'open').page, 'automations');
  // ordinary messages stay messages
  for (const t of ['what time is it', 'summarize this file for me', 'explain how brains work', 'write a short email to my team about the launch', '']) assert.strictEqual(p(t), null, t);
  assert.strictEqual(m.confirmText(p('disable agents')), 'Agents are off.');
  assert.strictEqual(m.confirmText(p('talk to Galahad')), 'Talking to Galahad.'); assert.strictEqual(m.confirmText(p('brain off')), 'Brain is off.');
  console.log('sentinel-commands tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
