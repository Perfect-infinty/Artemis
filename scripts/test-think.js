// Tests for splitting and stripping <think> blocks.
const assert = require('assert');
(async () => {
  const { splitThink, stripThink } = await import('../src/lib/think.mjs');
  assert.deepStrictEqual(splitThink('hello'), [{ type: 'text', text: 'hello' }]);
  assert.deepStrictEqual(splitThink('<think>plan it</think>\n\nAnswer'), [{ type: 'think', text: 'plan it', done: true }, { type: 'text', text: '\n\nAnswer' }]);
  assert.deepStrictEqual(splitThink('<think>still going'), [{ type: 'think', text: 'still going', done: false }]);
  assert.deepStrictEqual(splitThink('A <think>x</think> B <thinking>y</thinking>'), [{ type: 'text', text: 'A ' }, { type: 'think', text: 'x', done: true }, { type: 'text', text: ' B ' }, { type: 'think', text: 'y', done: true }]);
  assert.deepStrictEqual(splitThink('<think></think>Hi'), [{ type: 'text', text: 'Hi' }]);
  // a lone closing tag: the model never wrote the opening one
  assert.deepStrictEqual(splitThink('plan it first</think>\n\nAnswer'), [{ type: 'think', text: 'plan it first', done: true }, { type: 'text', text: '\n\nAnswer' }]);
  assert.deepStrictEqual(splitThink('</think>Answer'), [{ type: 'text', text: 'Answer' }]);
  assert.deepStrictEqual(splitThink('x</think>A <think>y</think>B'), [{ type: 'think', text: 'x', done: true }, { type: 'text', text: 'A ' }, { type: 'think', text: 'y', done: true }, { type: 'text', text: 'B' }]);
  assert.strictEqual(stripThink('plan it first</think>\n\nAnswer'), 'Answer');
  assert.strictEqual(stripThink('<think>plan</think>\n\nAnswer'), 'Answer');
  assert.strictEqual(stripThink('plain  text '), 'plain  text ');
  assert.strictEqual(stripThink('<think>only thoughts'), '');
  assert.strictEqual(stripThink(null), '');
  console.log('think: all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
