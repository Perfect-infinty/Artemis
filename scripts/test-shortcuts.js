const assert = require('assert');
(async () => {
  const S = await import('../src/lib/shortcuts.mjs');
  const ev = (o) => ({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, key: '', code: '', ...o });

  // parse
  assert.deepStrictEqual(S.parseAccelerator('CommandOrControl+Shift+Space'), { cmd: false, ctrl: false, cmdOrCtrl: true, alt: false, shift: true, key: 'Space' });
  assert.strictEqual(S.parseAccelerator('cmdorctrl+k').key, 'K');
  assert.ok(S.parseAccelerator('Option+Cmd+F5').alt);
  assert.strictEqual(S.parseAccelerator('Ctrl++').key, 'Plus');
  assert.strictEqual(S.parseAccelerator('Alt+Return').key, 'Enter');
  assert.strictEqual(S.parseAccelerator(''), null);
  assert.strictEqual(S.parseAccelerator('Shift'), null); // no key
  assert.strictEqual(S.parseAccelerator('Cmd+K+J'), null); // two keys
  assert.strictEqual(S.parseAccelerator('Cmd+Banana'), null);
  assert.strictEqual(S.parseAccelerator('Cmd++Shift'), null);

  // normalize: same shortcut written differently
  assert.strictEqual(S.normalizeAccelerator('CmdOrCtrl+shift+space', true), S.normalizeAccelerator('Shift+Command+Space', true));
  assert.notStrictEqual(S.normalizeAccelerator('CmdOrCtrl+K', false), S.normalizeAccelerator('Command+K', false));
  assert.strictEqual(S.normalizeAccelerator('CmdOrCtrl+K', false), 'Ctrl+K');
  assert.strictEqual(S.normalizeAccelerator('nope'), '');

  // match (mac)
  assert.ok(S.matchesAccelerator('CommandOrControl+K', ev({ metaKey: true, key: 'k', code: 'KeyK' }), true));
  assert.ok(!S.matchesAccelerator('CommandOrControl+K', ev({ ctrlKey: true, key: 'k', code: 'KeyK' }), true));
  assert.ok(!S.matchesAccelerator('CommandOrControl+K', ev({ metaKey: true, shiftKey: true, key: 'K', code: 'KeyK' }), true)); // extra modifier
  assert.ok(S.matchesAccelerator('Alt+Cmd+K', ev({ metaKey: true, altKey: true, key: '˚', code: 'KeyK' }), true)); // Option changes the typed character
  assert.ok(S.matchesAccelerator('CommandOrControl+Shift+Space', ev({ metaKey: true, shiftKey: true, key: ' ', code: 'Space' }), true));
  assert.ok(S.matchesAccelerator('Cmd+/', ev({ metaKey: true, key: '/', code: 'Slash' }), true));
  assert.ok(S.matchesAccelerator('Cmd+1', ev({ metaKey: true, key: '1', code: 'Digit1' }), true));
  assert.ok(S.matchesAccelerator('Cmd+Up', ev({ metaKey: true, key: 'ArrowUp', code: 'ArrowUp' }), true));
  assert.ok(S.matchesAccelerator('F6', ev({ key: 'F6', code: 'F6' }), true));
  assert.ok(!S.matchesAccelerator('', ev({ metaKey: true, key: 'k', code: 'KeyK' }), true));
  // match (Windows / Linux): CommandOrControl is Ctrl
  assert.ok(S.matchesAccelerator('CommandOrControl+K', ev({ ctrlKey: true, key: 'k', code: 'KeyK' }), false));
  assert.ok(!S.matchesAccelerator('CommandOrControl+K', ev({ metaKey: true, key: 'k', code: 'KeyK' }), false));

  // format
  assert.strictEqual(S.formatAccelerator('CommandOrControl+Shift+Space', true), '⌘⇧Space');
  assert.strictEqual(S.formatAccelerator('CommandOrControl+K', true), '⌘K');
  assert.strictEqual(S.formatAccelerator('Ctrl+Alt+Shift+Cmd+Left', true), '⌘⌃⌥⇧←');
  assert.strictEqual(S.formatAccelerator('CommandOrControl+Shift+Space', false), 'Ctrl+Shift+Space');
  assert.strictEqual(S.formatAccelerator('CmdOrCtrl+Shift+F', false), 'Ctrl+Shift+F');
  assert.strictEqual(S.formatAccelerator('', true), '');
  assert.strictEqual(S.formatAccelerator('Cmd+Nope', true), '');

  // recorder
  assert.strictEqual(S.eventToAccelerator(ev({ metaKey: true, shiftKey: true, code: 'Space', key: ' ' }), true), 'CommandOrControl+Shift+Space');
  assert.strictEqual(S.eventToAccelerator(ev({ ctrlKey: true, code: 'KeyK', key: 'k' }), false), 'CommandOrControl+K');
  assert.strictEqual(S.eventToAccelerator(ev({ ctrlKey: true, metaKey: true, code: 'KeyK' }), true), 'CommandOrControl+Control+K');
  assert.strictEqual(S.eventToAccelerator(ev({ shiftKey: true, code: 'KeyA', key: 'A' }), true), ''); // would fire while typing
  assert.strictEqual(S.eventToAccelerator(ev({ metaKey: true, code: 'MetaLeft', key: 'Meta' }), true), ''); // lone modifier
  assert.strictEqual(S.eventToAccelerator(ev({ code: 'F5', key: 'F5' }), true), 'F5');
  // what the recorder writes parses back to the same event
  for (const e of [ev({ metaKey: true, altKey: true, code: 'Slash', key: '÷' }), ev({ metaKey: true, code: 'BracketLeft', key: '[' })]) {
    assert.ok(S.matchesAccelerator(S.eventToAccelerator(e, true), e, true));
  }

  // push-to-talk combo (src/lib/ptt.mjs) -> global accelerator; electron/ptt-accel.js must agree
  const P = await import('../src/lib/ptt.mjs');
  const M = require('../electron/ptt-accel.js');
  assert.strictEqual(P.pttAccelerator('Alt+Space', true), 'Alt+Space');
  assert.strictEqual(P.pttAccelerator('Ctrl+Shift+KeyV', true), 'Control+Shift+V');
  assert.strictEqual(P.pttAccelerator('Meta+Shift+Digit5', true), 'Command+Shift+5');
  assert.strictEqual(P.pttAccelerator('Meta+KeyT', false), 'Super+T');
  assert.strictEqual(P.pttAccelerator('Alt+ArrowUp', true), 'Alt+Up');
  assert.strictEqual(P.pttAccelerator('Meta+Alt+Slash', true), 'Command+Alt+/');
  assert.strictEqual(P.pttAccelerator('F6', true), 'F6'); // F-keys may be global on their own
  assert.strictEqual(P.pttAccelerator('Shift+F13', true), 'Shift+F13');
  assert.strictEqual(P.pttAccelerator('AltRight', true), ''); // lone modifier: Electron cannot register it
  assert.strictEqual(P.pttAccelerator('MetaLeft', true), '');
  assert.strictEqual(P.pttAccelerator('Space', true), ''); // would steal the space bar from every app
  assert.strictEqual(P.pttAccelerator('Shift+KeyA', true), '');
  assert.strictEqual(P.pttAccelerator('Alt+IntlBackslash', true), ''); // unknown key
  assert.strictEqual(P.pttAccelerator('', true), '');
  assert.ok(P.pttGlobalOk('Alt+Space', true) && !P.pttGlobalOk('AltRight', true) && !P.pttGlobalOk('', true));
  for (const c of ['Alt+Space', 'Ctrl+Shift+KeyV', 'Meta+Shift+Digit5', 'Alt+ArrowUp', 'Meta+Alt+Slash', 'Ctrl+Backslash', 'F6', 'AltRight', 'Space', 'Shift+KeyA', 'Alt+IntlBackslash', 'Alt+Enter', 'Ctrl+Quote']) {
    for (const mac of [true, false]) assert.strictEqual(M.pttAccelerator(c, mac), P.pttAccelerator(c, mac), `main and renderer disagree on ${c}`);
  }
  // what the push-to-talk recorder writes becomes a valid accelerator
  for (const e of [ev({ altKey: true, code: 'Space' }), ev({ metaKey: true, shiftKey: true, code: 'KeyV' }), ev({ ctrlKey: true, code: 'Comma' })]) {
    assert.ok(S.parseAccelerator(P.pttAccelerator(P.comboFromEvent(e), true)), 'recorded combo parses as an accelerator');
  }

  // push-to-talk must be a combination: the recorder waits on modifiers, rejects single keys and ⇧ + a letter
  assert.deepStrictEqual(P.recordCombo(ev({ altKey: true, code: 'AltLeft', key: 'Alt' })), { combo: '', mods: ['Alt'], error: '' }); // still waiting, ⌥ shown live
  assert.strictEqual(P.modsLabel(['Alt', 'Shift']), '⌥⇧');
  assert.strictEqual(P.recordCombo(ev({ altKey: true, code: 'Space', key: ' ' })).combo, 'Alt+Space');
  assert.strictEqual(P.recordCombo(ev({ metaKey: true, shiftKey: true, code: 'KeyK', key: 'k' })).combo, 'Shift+Meta+KeyK');
  assert.strictEqual(P.recordCombo(ev({ code: 'Space', key: ' ' })).error, P.PTT_COMBO_HINT); // single key
  assert.strictEqual(P.recordCombo(ev({ code: 'F6', key: 'F6' })).combo, '');
  assert.strictEqual(P.recordCombo(ev({ shiftKey: true, code: 'KeyA', key: 'A' })).error, P.PTT_COMBO_HINT); // types text
  assert.ok(/cannot be used/.test(P.recordCombo(ev({ altKey: true, code: 'IntlBackslash' })).error));
  assert.ok(P.pttComboOk('Alt+Space') && P.pttComboOk('Shift+Meta+KeyK') && P.pttComboOk('Ctrl+Numpad5'));
  for (const old of ['Space', 'F6', 'AltRight', 'Shift+KeyA', '']) assert.ok(!P.pttComboOk(old), 'legacy ' + old);
  // every valid combo works from other apps, in both converters
  for (const c of ['Alt+Space', 'Shift+Meta+KeyK', 'Ctrl+Alt+KeyP', 'Alt+Numpad5', 'Meta+NumpadAdd']) {
    assert.ok(P.pttGlobalOk(c, true) && P.pttGlobalOk(c, false), c);
    for (const mac of [true, false]) assert.strictEqual(M.pttAccelerator(c, mac), P.pttAccelerator(c, mac), `main and renderer disagree on ${c}`);
  }
  assert.strictEqual(M.pttAccelerator('Alt+Space', true), 'Alt+Space');
  assert.strictEqual(M.pttAccelerator('Shift+Meta+KeyK', true), 'Command+Shift+K');
  assert.strictEqual(P.pttAccelerator('Alt+Numpad5', true), 'Alt+num5');
  // hold in the window: all modifiers of the combo + the key; released when the key or a required modifier goes up
  assert.ok(P.pttMatches('Alt+Space', ev({ altKey: true, code: 'Space' })));
  assert.ok(!P.pttMatches('Alt+Space', ev({ code: 'Space' }))); // modifier missing
  assert.ok(!P.pttMatches('Alt+Space', ev({ altKey: true, code: 'AltLeft' }))); // only the modifier so far
  assert.ok(P.pttMatches('Shift+Meta+KeyK', ev({ metaKey: true, shiftKey: true, code: 'KeyK' })));
  assert.ok(!P.pttMatches('Shift+Meta+KeyK', ev({ metaKey: true, code: 'KeyK' })));
  assert.ok(P.pttReleased('Alt+Space', ev({ code: 'Space' })) && P.pttReleased('Alt+Space', ev({ code: 'AltRight' })) && P.pttReleased('Alt+Space', ev({ code: 'AltLeft' })));
  assert.ok(!P.pttReleased('Alt+Space', ev({ code: 'ShiftLeft' })));
  assert.ok(P.pttReleased('Shift+Meta+KeyK', ev({ code: 'ShiftLeft' })) && P.pttReleased('Shift+Meta+KeyK', ev({ code: 'MetaRight' })));
  assert.strictEqual(P.pttLabel('Alt+Space'), '⌥ Space');
  // an old single-key setting keeps working in the window
  assert.ok(P.pttMatches('AltRight', ev({ altKey: true, code: 'AltRight' })) && P.pttMatches('F6', ev({ code: 'F6' })));

  console.log('shortcuts tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
