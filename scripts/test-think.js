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
  { const { speechText, STEP } = await import('../src/lib/think.mjs');
    // a second step that thinks without an opening tag must not be read aloud
    const raw = 'Sure.</thinking>\n\nLet me look.' + STEP + 'The tools are now available. I will take a screenshot.\n</thinking>';
    assert.ok(!/thinking|tools are now/.test(speechText(raw, true)), speechText(raw, true));
    assert.strictEqual(speechText(raw + '\n\nDone, Boss.', true), 'Sure.</thinking>'.replace(/^.*$/, '') + '\n\nLet me look.\n\n\n\nDone, Boss.'.replace(/^\n\n\n\n/, '\n\n'));
    assert.strictEqual(speechText('Hello there', false), 'Hello there'); assert.strictEqual(speechText('still thinking', true), ''); }
  { // thinking blocks on steps (the reasoning channel), and the history sent back to the model
    const { addThinking, stepParts, thoughtLabel, lastThinkLine, THINK_CAP, speechText } = await import('../src/lib/think.mjs');
    let t = addThinking(undefined, 'Let me ', 1000); t = addThinking(t, 'plan.', 2000);
    assert.deepStrictEqual(t, { text: 'Let me plan.', start: 1000 });
    assert.strictEqual(addThinking({ text: 'a', start: 1, ms: 50 }, 'b', 9).ms, undefined, 'new reasoning after an end is live again');
    const big = addThinking(undefined, 'x'.repeat(THINK_CAP + 10));
    assert.strictEqual(big.text.length, THINK_CAP); assert.strictEqual(big.cut, true);
    assert.deepStrictEqual(stepParts({ text: 'Answer', thinking: { text: 'why', start: 5, ms: 1200 } }), { text: 'Answer', thinking: 'why', ms: 1200, start: 5, open: false, cut: false });
    const legacy = stepParts({ text: '<think>old style</think>\n\nHi' });
    assert.strictEqual(legacy.text, 'Hi'); assert.strictEqual(legacy.thinking, 'old style'); assert.strictEqual(legacy.open, false);
    assert.strictEqual(stepParts({ text: 'first</think>Answer' }).thinking, 'first');
    assert.strictEqual(stepParts({ text: '<think>still' }).open, true);
    const code = stepParts({ text: '```html\n<think>example</think>\n```' });
    assert.strictEqual(code.thinking, ''); assert.ok(code.text.includes('<think>example'));
    assert.strictEqual(thoughtLabel(12400), 'Thought for 12s'); assert.strictEqual(thoughtLabel(300), 'Thought for a moment');
    assert.strictEqual(thoughtLabel(65000), 'Thought for 1m 5s'); assert.strictEqual(thoughtLabel(undefined), 'Thought process');
    assert.strictEqual(lastThinkLine('one\n**two**\n\n'), 'two');
    let hist = null; try { hist = await import('../src/lib/history.js'); } catch { console.log('think: history.js needs a Node that detects ES modules, its checks were skipped'); } // a .js file in ESM syntax
    if (hist) { const { toApiMessages, assistantText } = hist;
    const m = { role: 'assistant', steps: [
      { text: '', thinking: { text: 'SECRET-THOUGHT-1', ms: 10 }, toolCalls: [{ id: 'c1', name: 'list_dir', args: {}, result: 'a.txt' }] },
      { text: '<think>SECRET-THOUGHT-2</think>Final answer', thinking: { text: 'SECRET-THOUGHT-3', ms: 10 }, toolCalls: [] }] };
    const api = toApiMessages([{ role: 'user', content: 'hi' }, m]);
    assert.ok(!/SECRET-THOUGHT/.test(JSON.stringify(api)), 'thinking is never sent back to the model');
    assert.strictEqual(api[api.length - 1].content, 'Final answer');
    assert.strictEqual(assistantText(m), 'Final answer'); }
    // Sentinel: the empty pair App.jsx adds when reasoning came on its own channel releases the hold of a THINK_FIRST model
    assert.strictEqual(speechText('<think></think>Hello there.', true), 'Hello there.'); }
  console.log('think: all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
