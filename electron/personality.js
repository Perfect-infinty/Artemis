// Personality: how Artemis talks. A preset from personality.json plus the user's own notes, added to the system prompt.
const PRESETS = require('./personality.json');

function text(settings) {
  const s = settings || {};
  const p = PRESETS.find((x) => x.id === (s.personality || ''));
  const custom = String(s.personalityCustom || '').trim().slice(0, 1500);
  return [p && p.text, custom && `Personality notes from the user:\n${custom}`].filter(Boolean).join('\n');
}

module.exports = { PRESETS, text };
