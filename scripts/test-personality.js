const assert = require('assert');
const { text, PRESETS } = require('../electron/personality');
const { buildSystem } = (() => { try { return require('../electron/agent'); } catch { return {}; } })();
assert.strictEqual(text({}), '');
assert(/direct and informal/.test(text({ personality: 'direct' })));
assert(/sarcastic/.test(text({ personality: 'friendly', personalityCustom: 'Talk like a sarcastic friend' })) && /warm and friendly/.test(text({ personality: 'friendly', personalityCustom: 'x' })));
assert.strictEqual(text({ personality: 'nope' }), '');
assert(PRESETS.every((p) => p.id === '' || p.text));
if (buildSystem) {
  const sys = buildSystem({ personality: text({ personality: 'concise' }), hasTools: false });
  assert(/Your name is Artemis/.test(sys) && /extremely concise/.test(sys));
  assert(!/Your name is Artemis/.test(buildSystem({ isSub: true, hasTools: false })));
}
console.log('personality: all tests passed');
