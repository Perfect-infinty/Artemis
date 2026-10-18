const assert = require('assert');
(async () => {
  const { splitMentions, findTokens, liveMentions, tokenBefore, mentionHint, cleanMentions } = await import('../src/lib/mentions.mjs');
  const ms = [{ kind: 'connector', name: 'artemis' }, { kind: 'skill', name: 'My Skill' }, { kind: 'make', name: 'Make' }];

  // split
  assert.deepStrictEqual(splitMentions('hi @artemis do it', ms), [{ text: 'hi ' }, { text: '@artemis', mention: ms[0] }, { text: ' do it' }]);
  assert.deepStrictEqual(splitMentions('@My Skill now', ms).map((p) => !!p.mention), [true, false]);
  assert.deepStrictEqual(splitMentions('', ms), [{ text: '' }]);
  assert.deepStrictEqual(splitMentions('plain', []), [{ text: 'plain' }]);
  assert.strictEqual(splitMentions('x@artemis', ms).length, 1, 'needs a space or start before @');
  assert.strictEqual(splitMentions('@artemisx', ms).length, 1, 'an edited token is no longer a mention');
  assert.strictEqual(splitMentions('@artemis, then\n@Make.', ms).filter((p) => p.mention).length, 2);
  // longer names win over prefixes
  const ov = [{ kind: 'agent', name: 'Re' }, { kind: 'agent', name: 'Re viewer' }];
  assert.deepStrictEqual(findTokens('@Re viewer go', ov).map((h) => h.mention.name), ['Re viewer']);

  // live
  assert.deepStrictEqual(liveMentions('use @artemis', ms), [ms[0]]);
  assert.deepStrictEqual(liveMentions('use @artemi', ms), []);
  assert.deepStrictEqual(liveMentions('@artemis @artemis', ms), [ms[0]]);

  // backspace
  assert.deepStrictEqual(tokenBefore('hi @artemis', 11, ms), { start: 3, end: 11 });
  assert.deepStrictEqual(tokenBefore('hi @artemis ', 12, ms), { start: 3, end: 12 });
  assert.strictEqual(tokenBefore('hi @artemis  ', 13, ms), null);
  assert.strictEqual(tokenBefore('hi @artemis', 10, ms), null);
  assert.deepStrictEqual(tokenBefore('@My Skill x', 10, ms), { start: 0, end: 10 });

  // hint
  assert.strictEqual(mentionHint([]), '');
  assert.strictEqual(mentionHint([ms[0]]), '[The user selected: the "artemis" connector — use its tools for this request]');
  const h = mentionHint([ms[1], { kind: 'agent', name: 'Researcher' }, ms[2]]);
  assert.ok(h.includes('"My Skill" skill — load it with use_skill first') && h.includes('"Researcher" agent — delegate to it') && h.includes('Make — use the Make tools'));
  assert.deepStrictEqual(cleanMentions([null, { kind: 'x', name: 'a' }, { kind: 'skill', name: ' ' }, ms[0], ms[0]]), [ms[0]]);
  console.log('mentions: all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
