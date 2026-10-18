// Tests for src/lib/find.mjs (find in chat / note).
const assert = require('assert');

(async () => {
  const f = await import('../src/lib/find.mjs');

  // foldCase keeps the length
  assert.strictEqual(f.foldCase('HeLLo'), 'hello');
  assert.strictEqual(f.foldCase('İstanbul').length, 'İstanbul'.length);
  assert.strictEqual(f.foldCase('ÉCOLE Café'), 'école café');

  // single segments, case-insensitive, several per node, non-overlapping
  assert.deepStrictEqual(f.findMatches(['Hello world', 'say hello, HELLO'], 'hello'), [
    { node: 0, start: 0, endNode: 0, end: 5 },
    { node: 1, start: 4, endNode: 1, end: 9 },
    { node: 1, start: 11, endNode: 1, end: 16 }
  ]);
  assert.strictEqual(f.findMatches(['aaaa'], 'aa').length, 2);
  assert.deepStrictEqual(f.findMatches(['abc'], ''), []);
  assert.deepStrictEqual(f.findMatches([], 'x'), []);
  assert.deepStrictEqual(f.findMatches(['abc'], 'zz'), []);
  // plain strings never join
  assert.deepStrictEqual(f.findMatches(['foo', 'bar'], 'obar'), []);

  // a match spanning adjacent segments of the same group, not across groups
  const A = {}, B = {};
  const segs = [{ text: 'The qu', group: A }, { text: 'ick', group: A }, { text: ' fox', group: A }, { text: 'quick', group: B }];
  assert.deepStrictEqual(f.findMatches(segs, 'quick'), [
    { node: 0, start: 4, endNode: 1, end: 3 },
    { node: 3, start: 0, endNode: 3, end: 5 }
  ]);
  assert.deepStrictEqual(f.findMatches([{ text: 'ab', group: A }, { text: 'cd', group: B }], 'bc'), []);
  // the end lands in the segment holding the last character, not at offset 0 of the next one
  assert.deepStrictEqual(f.findMatches([{ text: 'ab', group: A }, { text: 'cd', group: A }], 'ab'), [{ node: 0, start: 0, endNode: 0, end: 2 }]);
  // empty segments in between are skipped
  assert.deepStrictEqual(f.findMatches([{ text: 'a', group: A }, { text: '', group: A }, { text: 'b', group: A }], 'ab'), [{ node: 0, start: 0, endNode: 2, end: 1 }]);
  // non-ASCII text
  assert.deepStrictEqual(f.findMatches(['Crème BRÛLÉE 🍮 brûlée'], 'brûlée'), [
    { node: 0, start: 6, endNode: 0, end: 12 },
    { node: 0, start: 16, endNode: 0, end: 22 }
  ]);

  // wrapping
  assert.strictEqual(f.wrapIndex(5, 3), 2);
  assert.strictEqual(f.wrapIndex(-1, 3), 2);
  assert.strictEqual(f.wrapIndex(4, 0), 0);
  assert.strictEqual(f.stepIndex(2, 3, 1), 0);
  assert.strictEqual(f.stepIndex(0, 3, -1), 2);
  assert.strictEqual(f.stepIndex(0, 0, 1), 0);

  // keepIndex: same match found again, else clamped
  const ms = [{ k: 'a' }, { k: 'b' }, { k: 'c' }];
  assert.strictEqual(f.keepIndex(ms, (m) => m.k === 'c', 0), 2);
  assert.strictEqual(f.keepIndex(ms, (m) => m.k === 'z', 7), 2);
  assert.strictEqual(f.keepIndex(ms, null, 1), 1);
  assert.strictEqual(f.keepIndex([], null, 4), 0);

  // labels
  assert.strictEqual(f.countLabel(2, 12, 'q'), '3 of 12');
  assert.strictEqual(f.countLabel(0, 0, 'q'), 'No results');
  assert.strictEqual(f.countLabel(0, 0, ''), '');

  // keys
  const k = (o) => ({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, key: '', code: '', ...o });
  assert.ok(f.isFindKey(k({ metaKey: true, key: 'f', code: 'KeyF' }), true));
  assert.ok(f.isFindKey(k({ metaKey: true, key: 'а', code: 'KeyF' }), true), 'physical key on another layout');
  assert.ok(!f.isFindKey(k({ ctrlKey: true, key: 'f' }), true));
  assert.ok(f.isFindKey(k({ ctrlKey: true, key: 'f' }), false));
  assert.ok(!f.isFindKey(k({ metaKey: true, shiftKey: true, key: 'F' }), true));
  assert.ok(!f.isFindKey(k({ metaKey: true, ctrlKey: true, key: 'f' }), true), 'Ctrl+Cmd+F is full screen');
  assert.strictEqual(f.findStepKey(k({ metaKey: true, key: 'g', code: 'KeyG' }), true), 1);
  assert.strictEqual(f.findStepKey(k({ metaKey: true, shiftKey: true, key: 'G', code: 'KeyG' }), true), -1);
  assert.strictEqual(f.findStepKey(k({ key: 'F3', shiftKey: true }), true), -1);
  assert.strictEqual(f.findStepKey(k({ key: 'g' }), true), 0);

  console.log('find: all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
