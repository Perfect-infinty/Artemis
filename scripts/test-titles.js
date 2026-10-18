const assert = require('assert');
const http = require('http');
const { cleanTitle, fallbackTitle, buildTitleMessages, requestTitle, looksLikeReasoning, MAX_TITLE } = require('../electron/titles');

(async () => {
  const { needsTitle, keepsTitle } = await import('../src/lib/titles.mjs');

  // cleanTitle: what models actually send back
  assert.strictEqual(cleanTitle('Fixing the Vite build'), 'Fixing the Vite build');
  assert.strictEqual(cleanTitle('"Fixing the Vite build."'), 'Fixing the Vite build');
  assert.strictEqual(cleanTitle('Title: Planning a trip to Lisbon'), 'Planning a trip to Lisbon');
  assert.strictEqual(cleanTitle('**Title:** “Planning a trip to Lisbon.” 🚀'), 'Planning a trip to Lisbon');
  assert.strictEqual(cleanTitle('# Sourdough starter basics\n\nThis conversation is about bread.'), 'Sourdough starter basics');
  assert.strictEqual(cleanTitle('\n\n  Chat title - Tax return questions  \n'), 'Tax return questions');
  assert.strictEqual(cleanTitle('<think>The user asks about cats</think>\nCat nutrition tips'), 'Cat nutrition tips');
  assert.strictEqual(cleanTitle("'Café menu ideas'"), 'Café menu ideas');
  // models that think out loud: never "Thinking Process", the reasoning itself, or a cut-off analysis as a title
  assert.strictEqual(cleanTitle('Thinking Process:'), '');
  assert.strictEqual(cleanTitle('Thinking...'), '');
  assert.strictEqual(cleanTitle('Thinking'), '');
  assert.strictEqual(cleanTitle('Thinking Process:\n\n1. **Analyze the request:** The user wants'), '');
  assert.strictEqual(cleanTitle('Okay, the user is asking about a bike repair, so I should'), '');
  assert.strictEqual(cleanTitle("Let me think about a good title for this"), '');
  assert.strictEqual(cleanTitle('The user wants a title for a chat about taxes.'), '');
  assert.strictEqual(cleanTitle('Thinking Process:\n1. **Analyze**: bike repair\n\nTitle: Fixing a flat bike tyre'), 'Fixing a flat bike tyre');
  assert.strictEqual(cleanTitle('<thinking>The user wants a title</thinking>'), '');
  assert.strictEqual(cleanTitle('<thought>hm</thought>\nSourdough starter basics'), 'Sourdough starter basics');
  assert.strictEqual(cleanTitle('<|channel|>analysis<|message|>We need a title<|end|><|start|>assistant<|channel|>final<|message|>Sourdough starter basics'), 'Sourdough starter basics');
  assert.strictEqual(cleanTitle('Thinking Process:', 'how do I fix my bike'), 'how do I fix my bike', 'unusable answers still fall back when asked to');
  assert.strictEqual(cleanTitle('Thinking fast and slow: book summary'), 'Thinking fast and slow: book summary', 'a real title that starts with the word stays');
  assert.strictEqual(cleanTitle('Thinking about a career change'), 'Thinking about a career change');
  assert.strictEqual(cleanTitle('Sure thing: pizza dough recipe'), 'Sure thing: pizza dough recipe');
  assert.ok(looksLikeReasoning('**Thinking Process:**') && !looksLikeReasoning('Tax return questions'));
  assert.strictEqual(cleanTitle('Receta de paella valenciana.'), 'Receta de paella valenciana');
  assert.strictEqual(cleanTitle('「東京旅行の計画」'), '東京旅行の計画');
  assert.strictEqual(cleanTitle('`npm` install errors'), 'npm install errors');
  assert.strictEqual(cleanTitle('[Docs link](https://x.y) summary'), 'Docs link summary');
  assert.strictEqual(cleanTitle('Why is the sky blue?'), 'Why is the sky blue?', 'a question mark stays');
  const long = cleanTitle('A very long title that keeps going and going well past the sixty character limit for sure');
  assert.ok(long.length <= MAX_TITLE && !/\s$/.test(long) && long.startsWith('A very long title'), long);
  assert.ok(cleanTitle('x'.repeat(100)).length === MAX_TITLE);
  // unusable answers: '' without a fallback (keep the old title), the first message cut with one
  assert.strictEqual(cleanTitle(''), '');
  assert.strictEqual(cleanTitle('  ""  '), '');
  assert.strictEqual(cleanTitle('🎉🎉'), '');
  assert.strictEqual(cleanTitle(null, 'how do I   fix\nmy bike'), 'how do I fix my bike');
  assert.strictEqual(cleanTitle('...', 'q'.repeat(80)), 'q'.repeat(48));
  assert.strictEqual(fallbackTitle(''), 'New chat');

  // buildTitleMessages: only text, capped, thinking removed
  const msgs = buildTitleMessages({ first: 'Hello there', reply: '<think>secret</think>' + 'r'.repeat(2000) });
  assert.strictEqual(msgs.length, 2); assert.strictEqual(msgs[0].role, 'system');
  assert.ok(/same language/.test(msgs[0].content));
  assert.ok(!msgs[1].content.includes('secret') && msgs[1].content.includes('User: Hello there'));
  assert.ok(msgs[1].content.length < 800, 'reply capped at ~600 chars');
  const drift = buildTitleMessages({ first: 'a', reply: 'b', recent: [{ role: 'user', text: 'now about tax' }, { role: 'assistant', text: 'ok' }] });
  assert.ok(drift[1].content.includes('Latest messages') && drift[1].content.includes('User: now about tax'));

  // needsTitle / keepsTitle: first reply, then 8 messages, then every 20; never for names that are not automatic
  const chat = (n, extra = {}) => ({ messages: Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user' })), ...extra });
  assert.strictEqual(needsTitle(chat(1)), false);
  assert.strictEqual(needsTitle(chat(2)), true);
  assert.strictEqual(needsTitle(chat(4, { titleAt: 2 })), false);
  assert.strictEqual(needsTitle(chat(8, { titleAt: 2 })), true);
  assert.strictEqual(needsTitle(chat(26, { titleAt: 8 })), false);
  assert.strictEqual(needsTitle(chat(28, { titleAt: 8 })), true);
  assert.strictEqual(needsTitle(chat(48, { titleAt: 28 })), true);
  for (const extra of [{ titleManual: true }, { incognito: true }, { source: 'phone' }, { source: 'schedule' }, { imported: 'chatgpt' }]) {
    assert.strictEqual(needsTitle(chat(2, extra)), false, JSON.stringify(extra));
    assert.strictEqual(keepsTitle(chat(2, extra)), true);
  }
  assert.strictEqual(keepsTitle(chat(2, { sentinel: true })), false);

  // requestTitle against a mock /chat/completions server
  let last = null; let mode = 'ok';
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      last = { url: req.url, auth: req.headers.authorization, extra: req.headers['x-extra'], body: JSON.parse(body) };
      if (mode === 'strict' && last.body.max_tokens !== undefined) { res.writeHead(400); res.end('{"error":"max_tokens not supported"}'); return; }
      if (mode === 'fail') { res.writeHead(500); res.end('{}'); return; }
      if (mode === 'slow') return; // never answers
      if (mode === 'think') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: 'Debugging Electron IPC' } }] })); return; }
      if (mode === 'ramble') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Thinking Process:\n\n1. **Analyze the request**' } }] })); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: mode === 'junk' ? '""' : 'Title: "Debugging Electron IPC."' } }], usage: { prompt_tokens: 42, completion_tokens: 6 } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/v1/chat/completions`;
  const base = { url, key: 'k-1', model: 'small-model', headers: { 'x-extra': 'yes' }, first: 'Why does my preload not expose the channel?', reply: 'Because the handler is missing.' };
  let r = await requestTitle(base);
  assert.deepStrictEqual(r, { title: 'Debugging Electron IPC', usage: { prompt: 42, completion: 6 } });
  assert.strictEqual(last.url, '/v1/chat/completions'); assert.strictEqual(last.auth, 'Bearer k-1'); assert.strictEqual(last.extra, 'yes');
  assert.strictEqual(last.body.model, 'small-model'); assert.strictEqual(last.body.stream, false);
  assert.strictEqual(last.body.max_tokens, 60); assert.strictEqual(last.body.temperature, 0.3);
  assert.ok(last.body.messages.every((m) => typeof m.content === 'string'), 'text only, no image parts');
  mode = 'strict'; r = await requestTitle(base);
  assert.strictEqual(r.title, 'Debugging Electron IPC'); assert.strictEqual(last.body.max_tokens, undefined, 'retried without max_tokens');
  mode = 'junk'; r = await requestTitle(base); assert.strictEqual(r.title, '');
  mode = 'think'; r = await requestTitle(base); assert.strictEqual(r.title, '', 'cut off by the token limit: no title');
  mode = 'ramble'; r = await requestTitle(base); assert.strictEqual(r.title, '', 'reasoning in the answer: no title');
  mode = 'fail'; await assert.rejects(() => requestTitle(base), /HTTP 500/);
  mode = 'slow'; const t0 = Date.now(); await assert.rejects(() => requestTitle({ ...base, timeoutMs: 300 })); assert.ok(Date.now() - t0 < 3000, 'times out');
  server.closeAllConnections && server.closeAllConnections(); server.close();
  console.log('titles: all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
