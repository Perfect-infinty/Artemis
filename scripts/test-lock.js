// Tests for the app lock (electron/lock.js): password, recovery code, lockdown, idle lock, IPC guard, Touch ID before sensitive actions.
const assert = require('assert');
const lockLib = require('../electron/lock.js');
const { createLock, hashSecret, checkSecret, makeRecoveryCode, sensitiveCategory, isBlockedChannel, cleanCfg, DEFAULT_CFG, LEVELS_MIN } = lockLib;

(async () => {
  // ---- secrets ----
  { const h = hashSecret('hunter22');
    assert.ok(checkSecret('hunter22', h)); assert.ok(!checkSecret('hunter23', h)); assert.ok(!checkSecret('', h)); assert.ok(!checkSecret('x', null));
    assert.notStrictEqual(hashSecret('hunter22').hash, h.hash, 'a fresh salt each time'); }
  { const c = makeRecoveryCode(); assert.ok(/^([A-Z2-9]{4}-){4}[A-Z2-9]{4}$/.test(c), c); assert.notStrictEqual(c, makeRecoveryCode()); }

  // ---- which approvals are sensitive ----
  assert.strictEqual(sensitiveCategory({ name: 'delete_file' }), 'delete');
  assert.strictEqual(sensitiveCategory({ name: 'library_delete' }), 'delete');
  assert.strictEqual(sensitiveCategory({ name: 'run_command', category: 'shell' }), 'shell');
  assert.strictEqual(sensitiveCategory({ name: 'computer_click', category: 'computer' }), 'computer');
  assert.strictEqual(sensitiveCategory({ name: 'mcp__gmail__send', category: 'mcp:gmail' }), 'connectorWrite');
  assert.strictEqual(sensitiveCategory({ name: 'mcp__gmail__read', category: 'mcp-read:gmail' }), null);
  assert.strictEqual(sensitiveCategory({ name: 'write_file' }), 'write');
  assert.strictEqual(sensitiveCategory({ name: 'send_to_phone', category: 'phone' }), null);
  assert.strictEqual(sensitiveCategory(null), null);

  // ---- the IPC guard: what stays closed while locked ----
  for (const ch of ['chat:run', 'tool:decision', 'term:input', 'files:parse', 'library:list', 'notes:read', 'mcp:save', 'make:run', 'schedule:save', 'settings:set', 'shell:open', 'voice:transcribe', 'providers:save', 'browser:open', 'sentinel:ask', 'sentinel:copy', 'project:pick-logo', 'artemis:tools'])
    assert.ok(isBlockedChannel(ch), ch + ' must be blocked while locked');
  for (const ch of ['store:get', 'store:set', 'settings:get', 'lock:status', 'lock:unlock', 'speaker:verify', 'sentinel:status', 'sentinel:model', 'sentinel:current', 'voice:speak', 'voice:stream', 'voice:permission', 'logs:add', 'usage:get', 'providers:list', 'browser:visible', 'browser:bounds', 'sentinel:action', 'sentinel:widget'])
    assert.ok(!isBlockedChannel(ch), ch + ' must stay open while locked');

  // ---- config clean-up ----
  { const c = cleanCfg({ idleMinutes: 99999, voiceThreshold: 5, maxVoiceFails: 0, sensitive: { delete: false }, enabled: 1 });
    assert.strictEqual(c.idleMinutes, 1440); assert.strictEqual(c.voiceThreshold, 0.7); assert.strictEqual(c.maxVoiceFails, 1);
    assert.strictEqual(c.sensitive.delete, false); assert.strictEqual(c.sensitive.shell, true); assert.strictEqual(c.enabled, true);
    assert.deepStrictEqual(cleanCfg(undefined), DEFAULT_CFG); }

  // ---- the lock itself, on a fake clock ----
  let t = 1_000_000; const store = { v: null }; const states = []; const alerts = []; const logs = [];
  const touch = { ok: true, err: '', available: () => touch.ok, prompt: async () => { if (touch.err) throw new Error(touch.err); } };
  const mk = (over = {}) => createLock({ now: () => t, read: () => store.v, write: (d) => { store.v = JSON.parse(JSON.stringify(d)); }, touchId: touch, onState: (s) => states.push(s), onAlert: (a) => alerts.push(a), log: (l, m) => logs.push(m), ...over });
  let lk = mk();

  // nothing works before a password exists
  assert.strictEqual(lk.enabled(), false); assert.strictEqual(lk.isLocked(), false);
  assert.strictEqual((await lk.lock()).ok, false);
  assert.strictEqual((await lk.setConfig({ enabled: true })).ok, false, 'no password yet');
  assert.strictEqual((await lk.setPassword('abc')).ok, false, 'too short');
  const first = await lk.setPassword('correct horse');
  assert.ok(first.ok && /^([A-Z2-9]{4}-){4}[A-Z2-9]{4}$/.test(first.recoveryCode));
  const recovery = first.recoveryCode;
  assert.strictEqual((await lk.setPassword('another one')).ok, false, 'changing it needs proof');
  assert.strictEqual((await lk.setPassword('another one', { password: 'wrong' })).ok, false);
  { const r = await lk.setPassword('correct horse', { password: 'correct horse' }); assert.ok(r.ok && r.recoveryCode === '', 'the recovery code stays'); }
  assert.ok((await lk.setConfig({ enabled: true, idleMinutes: 5 })).ok);
  assert.strictEqual(lk.enabled(), true); assert.strictEqual(lk.isLocked(), false);
  assert.strictEqual(lk.guard('chat:run'), true, 'unlocked: everything is open');

  // lock now, wrong password, right password
  assert.ok(lk.lock('manual').ok); assert.strictEqual(lk.isLocked(), true); assert.strictEqual(lk.state().reason, 'manual');
  assert.strictEqual(lk.guard('chat:run'), false); assert.strictEqual(lk.guard('lock:status'), true); assert.strictEqual(lk.guard('store:get'), true);
  { const r = await lk.unlock('password', 'nope'); assert.ok(!r.ok && /Wrong password/.test(r.error)); }
  assert.ok((await lk.unlock('password', 'correct horse')).ok); assert.strictEqual(lk.isLocked(), false);

  // the lock survives a restart: the config is on disk, and "lock on start" locks
  lk = mk(); lk.init(); assert.strictEqual(lk.isLocked(), true); assert.strictEqual(lk.state().reason, 'start');
  assert.ok((await lk.unlock('password', 'correct horse')).ok);
  assert.ok((await lk.setConfig({ lockOnStart: false })).ok); lk = mk(); lk.init(); assert.strictEqual(lk.isLocked(), false);
  assert.ok((await lk.setConfig({ lockOnStart: true })).ok);

  // idle: locks after the quiet time, activity (Sentinel, keyboard) starts it over
  lk.activity(); t += 4 * 60000; assert.strictEqual(lk.tick(4 * 60), false);
  t += 2 * 60000; assert.strictEqual(lk.tick(6 * 60), true, 'idle 6 min with a 5 min limit'); assert.strictEqual(lk.state().reason, 'idle');
  assert.ok((await lk.unlock('password', 'correct horse')).ok);
  t += 10 * 60000; lk.activity(); assert.strictEqual(lk.tick(10 * 60), false, 'the system was idle but Sentinel talked a moment ago');
  t += 6 * 60000; assert.strictEqual(lk.tick(1), false, 'the system is not idle (a key was pressed)');
  lk.onSleep(); assert.strictEqual(lk.isLocked(), true, 'locks when the Mac sleeps'); assert.strictEqual(lk.state().reason, 'sleep');
  assert.ok((await lk.unlock('password', 'correct horse')).ok);

  // wrong passwords: the 5th starts a lockdown, an alert goes out, even the right password waits
  lk.lock('manual');
  for (let i = 0; i < 4; i++) assert.ok(!(await lk.unlock('password', 'bad' + i)).ok);
  assert.strictEqual(alerts.length, 0);
  { const r = await lk.unlock('password', 'bad4'); assert.ok(!r.ok && r.locked && /Locked for 5 min/.test(r.error)); }
  assert.strictEqual(alerts.length, 1); assert.deepStrictEqual({ kind: alerts[0].kind, attempts: alerts[0].attempts, minutes: alerts[0].minutes }, { kind: 'password', attempts: 5, minutes: LEVELS_MIN[0] });
  assert.ok(lk.state().lockdown.active);
  { const r = await lk.unlock('password', 'correct horse'); assert.ok(!r.ok && /Too many attempts/.test(r.error), 'the right password is refused during a lockdown'); }
  assert.ok(!(await lk.unlock('touchid')).ok);
  assert.strictEqual((await lk.unlock('recovery', 'WRONG-CODE')).ok, false);
  // a restart does not end it
  lk = mk(); lk.init(); assert.strictEqual(lk.isLocked(), true); assert.strictEqual(lk.state().reason, 'lockdown');
  // it ends by itself; the next one is longer
  t += 5 * 60000 + 1000;
  assert.ok((await lk.unlock('password', 'correct horse')).ok);
  lk.lock('manual'); for (let i = 0; i < 5; i++) await lk.unlock('password', 'bad');
  assert.strictEqual(alerts.length, 2); assert.strictEqual(alerts[1].minutes, LEVELS_MIN[1]);
  // the recovery code works inside a lockdown and clears it
  { const r = await lk.unlock('recovery', recovery.toLowerCase().replace(/-/g, ' ')); assert.ok(r.ok && r.method === 'recovery'); }
  assert.ok(!lk.state().lockdown.active);
  // a quiet day starts the levels over
  lk.lock('manual'); for (let i = 0; i < 5; i++) await lk.unlock('password', 'bad'); t += 3 * 60 * 60000; await lk.unlock('password', 'correct horse');
  t += 25 * 3600 * 1000; lk.lock('manual'); for (let i = 0; i < 5; i++) await lk.unlock('password', 'bad');
  assert.strictEqual(alerts[alerts.length - 1].minutes, LEVELS_MIN[0], 'levels reset after a quiet day');
  t += 6 * 60000; assert.ok((await lk.unlock('password', 'correct horse')).ok);

  // failures that are older than the window do not add up
  lk.lock('manual'); for (let i = 0; i < 4; i++) await lk.unlock('password', 'bad'); t += 6 * 60000;
  assert.ok(!(await lk.unlock('password', 'bad')).locked, 'only 1 failure inside the 5 min window'); assert.ok((await lk.unlock('password', 'correct horse')).ok);

  // Touch ID: unlock, cancel (not counted), failure (counted)
  lk.lock('manual');
  assert.ok((await lk.unlock('touchid')).ok);
  lk.lock('manual'); touch.err = 'User canceled'; { const r = await lk.unlock('touchid'); assert.ok(r.cancelled && !r.ok); }
  for (let i = 0; i < 4; i++) await lk.unlock('touchid'); // cancels never lock
  assert.ok(!lk.state().lockdown.active);
  touch.err = 'Authentication failed'; for (let i = 0; i < 4; i++) assert.ok(!(await lk.unlock('touchid')).locked); { const r = await lk.unlock('touchid'); assert.ok(r.locked); }
  touch.err = ''; t += 6 * 60 * 60000; assert.ok((await lk.unlock('password', 'correct horse')).ok);
  touch.ok = false; lk.lock('manual'); assert.ok(!(await lk.unlock('touchid')).ok); assert.strictEqual(lk.state().touchId, false); touch.ok = true;
  assert.ok((await lk.unlock('password', 'correct horse')).ok);

  // voice: three unrecognised voices lock down; a recognised voice unlocks
  assert.strictEqual(lk.wantsVoiceCheck(), false);
  assert.ok((await lk.setConfig({ voiceOnly: true })).ok); assert.strictEqual(lk.wantsVoiceCheck(), true);
  assert.ok((await lk.setConfig({ voiceOnly: false })).ok); assert.strictEqual(lk.wantsVoiceCheck(), false);
  lk.lock('manual'); assert.strictEqual(lk.wantsVoiceCheck(), true, 'locked with voice unlock: the voice is checked');
  assert.strictEqual(lk.recordFailure('voice'), null); assert.strictEqual(lk.recordFailure('voice'), null);
  lk.voiceSuccess(); assert.strictEqual(lk.recordFailure('voice'), null, 'a success clears the count');
  assert.strictEqual(lk.recordFailure('voice'), null);
  { const info = lk.recordFailure('voice'); assert.ok(info && info.kind === 'voice' && info.attempts === 3); }
  assert.ok(!lk.unlockByVoice().ok, 'no voice unlock during a lockdown');
  t += 5 * 3600 * 1000; assert.ok(lk.unlockByVoice().ok); assert.strictEqual(lk.isLocked(), false);
  assert.ok((await lk.setConfig({ voiceUnlock: false })).ok); lk.lock('manual'); assert.ok(!lk.unlockByVoice().ok); assert.strictEqual(lk.wantsVoiceCheck(), false);
  assert.ok((await lk.unlock('password', 'correct horse')).ok); assert.ok((await lk.setConfig({ voiceUnlock: true })).ok);

  // turning the lock off needs the password; a changed password replaces the old one
  assert.ok(!(await lk.setConfig({ enabled: false })).ok); assert.ok(!(await lk.setConfig({ enabled: false }, { password: 'x' })).ok);
  assert.strictEqual(lk.enabled(), true);
  assert.ok((await lk.setPassword('new secret 1', { password: 'correct horse' })).ok);
  lk.lock('manual'); assert.ok(!(await lk.unlock('password', 'correct horse')).ok); assert.ok((await lk.unlock('password', 'new secret 1')).ok);
  assert.ok((await lk.setConfig({ enabled: false }, { touchid: true })).ok, 'Touch ID is proof too'); assert.strictEqual(lk.enabled(), false); assert.strictEqual(lk.isLocked(), false);
  assert.ok((await lk.setConfig({ enabled: true })).ok);
  { const r = await lk.newRecoveryCode({ password: 'new secret 1' }); assert.ok(r.ok && r.recoveryCode !== recovery); lk.lock('manual'); assert.ok((await lk.unlock('recovery', r.recoveryCode)).ok); }

  // Touch ID before sensitive actions
  assert.deepStrictEqual(await lk.requireSensitive({ name: 'delete_file' }), { ok: true, skipped: true }, 'off by default');
  assert.ok((await lk.setConfig({ sensitiveTouchId: true })).ok);
  assert.strictEqual((await lk.requireSensitive({ name: 'delete_file' })).via, 'touchid');
  assert.ok((await lk.requireSensitive({ name: 'write_file' })).skipped, 'writing files is not on the list by default');
  assert.ok((await lk.requireSensitive({ name: 'send_to_phone', category: 'phone' })).skipped);
  touch.err = 'User canceled'; assert.ok((await lk.requireSensitive({ name: 'run_command', category: 'shell' })).cancelled);
  touch.err = 'Authentication failed'; // Touch ID failed: the password takes over
  { let asked = ''; const lk2 = mk({ askPassword: async (m) => { asked = m; return 'new secret 1'; } });
    assert.strictEqual((await lk2.requireSensitive({ name: 'run_command', category: 'shell' })).via, 'password'); assert.ok(/run a command/.test(asked));
    const lk3 = mk({ askPassword: async () => 'wrong' }); assert.ok(!(await lk3.requireSensitive({ name: 'delete_file' })).ok);
    const lk4 = mk({ askPassword: async () => null }); assert.ok((await lk4.requireSensitive({ name: 'delete_file' })).cancelled); }
  touch.err = ''; touch.ok = false; { const lk5 = mk({ askPassword: async () => 'new secret 1' }); assert.strictEqual((await lk5.requireSensitive({ name: 'delete_file' })).via, 'password', 'no Touch ID on this Mac'); } touch.ok = true;

  // the state events reach the window
  assert.ok(states.length > 10 && states.every((s) => typeof s.locked === 'boolean' && typeof s.enabled === 'boolean'));
  assert.ok(logs.some((m) => /Lockdown/.test(m)));
  console.log('lock: all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
