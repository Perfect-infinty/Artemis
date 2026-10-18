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
  // spoken approvals: only while a tool is waiting
  { const q = (t) => m.parseCommand(t, { awaiting: true });
    for (const t of ['yes', 'Yes.', 'approve', 'allow it', 'go ahead', 'sure', 'okay', 'yes please']) assert.strictEqual(q(t).type, 'approve', t);
    for (const t of ['no', 'deny', 'cancel', 'nope', 'no thanks', "don't"]) assert.strictEqual(q(t).type, 'deny', t);
    assert.strictEqual(q('what is the weather today'), null);
    assert.strictEqual(p('yes'), null); assert.strictEqual(p('approve'), null); // not a command when nothing is waiting
    assert.strictEqual(m.confirmText({ type: 'approve' }), 'Allowed.'); }
  // misc
  is('bye bye', 'bye'); is('Bye-bye.', 'bye'); is('goodbye', 'bye');
  assert.strictEqual(p('what does bye bye mean in french and how do you say it politely'), null);
  assert.strictEqual(m.confirmText(p('bye bye')), 'Bye.');
  is('stop', 'stop'); is('sentinel off', 'sentinelOff'); is('compact', 'compact');
  assert.strictEqual(is('open logs', 'open').page, 'logs'); assert.strictEqual(is('open automations', 'open').page, 'automations');
  // ordinary messages stay messages
  for (const t of ['what time is it', 'summarize this file for me', 'explain how brains work', 'write a short email to my team about the launch', '']) assert.strictEqual(p(t), null, t);
  assert.strictEqual(m.confirmText(p('disable agents')), 'Agents are off.');
  assert.strictEqual(m.confirmText(p('talk to Galahad')), 'Talking to Galahad.'); assert.strictEqual(m.confirmText(p('brain off')), 'Brain is off.');
  { const k = await import('../src/lib/ptt.mjs');
    const ev = (code, o = {}) => ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...o });
    assert.strictEqual(k.comboFromEvent(ev('Space', { altKey: true })), 'Alt+Space');
    assert.strictEqual(k.comboFromEvent(ev('AltRight', { altKey: true })), 'AltRight');
    assert.ok(k.pttMatches('Alt+Space', ev('Space', { altKey: true }))); assert.ok(!k.pttMatches('Alt+Space', ev('Space')));
    assert.ok(k.pttMatches('AltRight', ev('AltRight', { altKey: true }))); assert.ok(!k.pttMatches('AltRight', ev('AltLeft', { altKey: true })));
    assert.ok(k.pttReleased('Alt+Space', ev('Space'))); assert.ok(k.pttReleased('Alt+Space', ev('AltLeft'))); assert.ok(!k.pttReleased('Alt+Space', ev('KeyA')));
    assert.ok(k.pttReleased('AltRight', ev('AltRight'))); assert.ok(!k.pttReleased('AltRight', ev('AltLeft')));
    assert.strictEqual(k.pttLabel('Meta+Shift+KeyV'), '⌘ ⇧ V'); assert.strictEqual(k.pttLabel(''), 'Not set'); }
  // full voice control: answer, chats, widget, app, screen, browser
  is('regenerate', 'regenerate'); is('try again', 'regenerate'); is('continue', 'continue'); is('keep going', 'continue');
  is('repeat that', 'repeat'); is('say that again', 'repeat'); is('stop talking', 'stop'); is('skip', 'stop');
  assert.strictEqual(is('read it slower', 'rate', 'slower').again, true); is('faster', 'rate', 'faster'); is('slow down', 'rate', 'slower'); is('normal speed', 'rate', 'normal');
  is('louder', 'volume'); assert.strictEqual(p('what is the volume of a cube'), null);
  is('copy that', 'copy', 'answer'); is('copy the code', 'copy', 'code'); is('read the code', 'readCode');
  is('look at my screen', 'screen'); is('what is on my screen right now', 'screen');
  is('think harder', 'thinkStep', 'up'); is('turn off thinking', 'think', 'low'); is('thinking auto', 'think', 'auto');
  assert.strictEqual(p('what do you think'), null); assert.strictEqual(p('do you think more is better'), null);
  is('tools off', 'tools', 'off'); is('turn on the tools', 'tools', 'on');
  is('previous chat', 'prevChat'); is('go back to the last chat', 'prevChat'); is('next chat', 'nextChat');
  is('delete this chat', 'deleteChat'); is('pin this chat', 'pinChat', 'pin'); is('unpin the chat', 'pinChat', 'unpin');
  assert.strictEqual(is('rename this chat to Budget plan', 'renameChat').value, 'Budget plan');
  assert.strictEqual(is('find the chat about the tax report', 'findChat').value, 'the tax report');
  is('expand', 'widget', 'expand'); is('make it bigger', 'widget', 'expand'); is('close', 'widget', 'collapse'); is('hide the widget', 'widget', 'collapse'); is('minimize', 'widget', 'collapse');
  is('pin widget', 'widget', 'pin'); is('unpin the widget', 'widget', 'unpin'); is('move the widget to the left', 'widget', 'left'); is('move it right', 'widget', 'right');
  is('open the app', 'showApp'); is('show me', 'showApp'); is('show me in the app', 'showApp'); is('open in app', 'showApp');
  is('Artemis Locke', 'lock'); is('artemis locks', 'lock');
  is('Artemis Lock', 'lock'); is('Artemis, lock the app', 'lock'); is('hey artemis lock', 'lock'); is('Artemis stop', 'stop');
  is('lock', 'lock'); is('lock the app', 'lock'); is('lock artemis now', 'lock'); is('please lock the screen', 'lock'); is('secure the mac', 'lock');
  assert.strictEqual(p('lock the door of the garage and turn off the lights please now'), null); assert.strictEqual(p('what is a lock screen'), null);
  is('mute mic', 'mute'); is('stop listening', 'sentinelOff');
  assert.strictEqual(is('open settings', 'open').page, 'settings'); assert.strictEqual(is('open the terminal', 'open').page, 'terminal'); assert.strictEqual(is('open memory', 'open').page, 'memory');
  assert.strictEqual(is('open youtube.com', 'browse').value, 'youtube.com'); assert.strictEqual(is('go to github dot com', 'browse').value, 'github.com');
  assert.strictEqual(is('open hacker news in the browser', 'browse').value, 'hacker news');
  assert.strictEqual(is('browser open youtube dot com', 'browse').value, 'youtube.com'); assert.strictEqual(is('open the browser and go to github.com', 'browse').value, 'github.com');
  assert.strictEqual(is('open the browser and search for the weather', 'browse').value, 'weather'); assert.strictEqual(is('open the browser', 'open').page, 'browser'); assert.strictEqual(is('browser open', 'open').page, 'browser');
  { const models = [{ id: 'prov:x:gpt-5', name: 'GPT-5' }]; assert.strictEqual(m.parseCommand('use GPT 5', { models, brains }).value, 'prov:x:gpt-5'); assert.strictEqual(m.parseCommand('use Lancelot', { models, brains }).type, 'brain'); }
  // picking from a list read aloud, and finding chats by title
  assert.strictEqual(m.parseChoice('the second one', 3), 1); assert.strictEqual(m.parseChoice('number 3', 3), 2); assert.strictEqual(m.parseChoice('second', 3), 1);
  assert.strictEqual(m.parseChoice('last', 3), 2); assert.strictEqual(m.parseChoice('none', 3), -1); assert.strictEqual(m.parseChoice('five', 3), null); assert.strictEqual(m.parseChoice('what is the weather', 3), null);
  { const chats = [{ id: 'a', title: 'Tax report 2025', updatedAt: 1 }, { id: 'b', title: 'Holiday plans', updatedAt: 2 }, { id: 'c', title: 'Taxes for the company', updatedAt: 3 }];
    assert.deepStrictEqual(m.findChats(chats, 'the tax report').map((c) => c.id), ['a', 'c']); assert.deepStrictEqual(m.findChats(chats, 'holiday').map((c) => c.id), ['b']); assert.deepStrictEqual(m.findChats(chats, 'about'), []); }
  for (const c of ['widget', 'rate', 'think', 'tools', 'pinChat', 'copy', 'showApp', 'open']) assert.ok(m.confirmText({ type: c, value: c === 'rate' ? 'slower' : c === 'think' ? 'high' : 'on', label: 'Logs' }), c);
  assert.strictEqual(m.confirmText({ type: 'open', label: 'Settings' }), 'I opened Settings in the app.');
  // the chat controls panel by voice
  { const projects = [{ id: 'p1', name: 'Tax Report' }, { id: 'p2', name: 'Website Redesign' }, { id: 'p3', name: 'Artemis' }];
    const brains2 = [...brains, { slug: 'merlin-the-wise', name: 'Merlin the Wise' }];
    const c = (t) => m.parseCommand(t, { brains: brains2, projects });
    const eq = (t, type, value) => { const r = c(t); assert(r, `no command for "${t}"`); assert.strictEqual(r.type, type, t); if (value !== undefined) assert.strictEqual(r.value, value, t); return r; };
    // brain
    eq('use brain Galahad', 'brain', 'galahad'); eq('use brain galahat', 'brain', 'galahad'); eq('brain percival', 'brain', 'percival'); eq('switch brain to lancelott', 'brain', 'lancelot');
    eq('use brain merlin', 'brain', 'merlin-the-wise'); eq('brain council', 'brain', 'council'); eq('no brain', 'brain', ''); eq('brain off', 'brain', '');
    eq('use brain zorro', 'brainAsk', 'zorro'); eq('which brain am I using', 'brainWhich'); eq('which brain', 'brainWhich');
    assert.strictEqual(m.confirmText(c('use brain galahad')), 'Talking to Galahad.');
    // tools
    eq('tools on', 'tools', 'on'); eq('tools off', 'tools', 'off'); eq('no tools', 'tools', 'off');
    // think
    eq('think low', 'think', 'low'); eq('think medium', 'think', 'medium'); eq('think high', 'think', 'high'); eq('think auto', 'think', 'auto');
    assert.strictEqual(eq('think off', 'think', 'low').off, true); eq('set thinking to high', 'think', 'high'); eq('reasoning level medium', 'think', 'medium');
    eq('think harder', 'thinkStep', 'up'); eq('think more', 'thinkStep', 'up'); eq('think less', 'thinkStep', 'down');
    assert.ok(/low/.test(m.confirmText(c('think off'))));
    // agents
    eq('agents on', 'agents', 'on'); eq('agents off', 'agents', 'off'); eq('no agents', 'agents', 'off');
    // permissions
    eq('permissions ask', 'perm', 'ask'); eq('ask me first', 'perm', 'ask'); eq('set permissions to ask first', 'perm', 'ask');
    eq('auto-allow everything', 'perm', 'auto'); eq('full access', 'perm', 'auto'); eq('permissions auto allow', 'perm', 'auto'); eq('auto-allow all', 'perm', 'auto');
    eq('auto-allow edits', 'permEdits'); assert.ok(/without asking/.test(m.confirmText(c('full access'))));
    // project
    eq('project tax report', 'project', 'p1'); eq('switch to project website', 'project', 'p2'); eq('move this chat to project artemis', 'project', 'p3');
    eq('switch to project websit redesign', 'project', 'p2'); eq('project artemiss', 'project', 'p3'); eq('move it to the tax report project', 'project', 'p1');
    eq('no project', 'project', null); eq('remove this chat from the project', 'project', null); eq('which project', 'projectWhich'); eq('which project am I in', 'projectWhich');
    eq('project gardening', 'projectAsk', 'gardening'); assert.strictEqual(m.confirmText(c('project tax report')), 'Moved to Tax Report.');
    assert.strictEqual(is('open projects', 'open').page, 'projects');
    // usage and status
    for (const t of ['usage', "what's my usage", 'how much did I spend today', 'what is my cost today', 'how much did this cost']) eq(t, 'usage');
    assert.strictEqual(is('open usage', 'open').page, 'usage');
    for (const t of ['status', 'what are my settings', "what's the status"]) eq(t, 'status');
    assert.strictEqual(m.usageText({ t: 12345, c: 0.0412 }, { t: 800, c: 0.002 }), 'Today: 12.3 thousand tokens, about $0.04. This chat: 800 tokens, about less than a cent.');
    assert.strictEqual(m.usageText({ t: 0, c: 0 }, { t: 0, c: 0 }), 'Today: 0 tokens. This chat: 0 tokens.');
    assert.strictEqual(m.statusText({ model: 'GPT-5', brain: 'Galahad', project: 'Tax Report', think: 'high', tools: 'on', agents: 'off', perm: 'ask' }), 'Model GPT-5, brain Galahad, project Tax Report, think high, tools on, agents off, ask first.');
    assert.strictEqual(m.statusText({ model: 'GPT-5', brain: '', project: '', think: 'auto', tools: 'off', agents: 'on', perm: 'auto' }), 'Model GPT-5, no brain, no project, think auto, tools off, agents on, auto-allow everything.');
    // fuzzy matching
    assert.strictEqual(m.fuzzyPick(projects, 'tax'), projects[0]); assert.strictEqual(m.fuzzyPick(projects, 'the website project'), projects[1]);
    assert.strictEqual(m.fuzzyPick(projects, 'redesign'), projects[1]); assert.strictEqual(m.fuzzyPick(projects, 'artemus'), projects[2]);
    assert.strictEqual(m.fuzzyPick(projects, 'xy'), null); assert.strictEqual(m.fuzzyPick(projects, 'cooking'), null); assert.strictEqual(m.fuzzyPick([], 'tax'), null);
    assert.strictEqual(m.fuzzyPick(brains2, 'gallahad').slug, 'galahad');
    // ordinary sentences stay messages
    for (const t of ['what do you think about my project plan', 'how do brains work in this app', 'tell me about the tax report project and what is left to do']) assert.strictEqual(c(t), null, t); }
  console.log('sentinel-commands tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
