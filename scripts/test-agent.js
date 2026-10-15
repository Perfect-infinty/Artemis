// Agent loop test with a fake OpenAI-compatible SSE server. node scripts/test-agent.js
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runAgent } = require('../electron/agent');

const sse = (res, events) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`);
  res.write('data: [DONE]\n\n'); res.end();
};
const delta = (d, finish = null) => ({ choices: [{ delta: d, finish_reason: finish }] });

(async () => {
  const requests = [];
  let mode = 'normal'; let flakyHits = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const b = JSON.parse(body);
      requests.push({ auth: req.headers.authorization, url: req.url, body: b, headers: req.headers });
      const n = requests.length;
      if (mode === 'strict-parts') { // every content must be a list of parts
        const bad = b.messages.findIndex((m) => typeof m.content === 'string');
        if (bad >= 0) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ result: null, success: false, errors: [{ code: 5005, message: `AiError: Bad input: Error: oneOf at '/' not met, 0 matches: Type mismatch of '/messages/${bad}/content', 'string' not in 'array'` }] })); }
        return sse(res, [delta({ content: 'parts ok' }, 'stop')]);
      }
      if (mode === 'strict-text') { // text only: a list of parts is rejected
        const bad = b.messages.findIndex((m) => Array.isArray(m.content));
        if (bad >= 0) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: `Type mismatch of '/messages/${bad}/content', 'array' not in 'string'` } })); }
        return sse(res, [delta({ content: 'text ok' }, 'stop')]);
      }
      if (mode === 'lazy') {
        const names = (b.tools || []).map((t) => t.function.name);
        if (!names.some((x) => x.startsWith('mcp__'))) return sse(res, [delta({ tool_calls: [{ index: 0, id: 'u1', function: { name: 'use_connector', arguments: '{"name":"mail"}' } }] }), delta({}, 'tool_calls')]);
        return sse(res, [delta({ content: 'lazy ok' }, 'stop')]);
      }
      if (mode === 'groups') {
        const names = (b.tools || []).map((t) => t.function.name);
        if (!names.includes('run_command')) return sse(res, [delta({ tool_calls: [{ index: 0, id: 'g1', function: { name: 'use_tools', arguments: '{"names":["shell"]}' } }] }), delta({}, 'tool_calls')]);
        return sse(res, [delta({ content: 'groups ok' }, 'stop')]);
      }
      if (mode === 'trim') return sse(res, [delta({ content: 'trim ok' }, 'stop')]);
      if (mode === 'note') {
        if (b.messages[b.messages.length - 1].role !== 'tool') return sse(res, [delta({ tool_calls: [{ index: 0, id: 'n1', function: { name: 'task_note', arguments: '{"text":"plan A: do X then Y"}' } }] }), delta({}, 'tool_calls')]);
        return sse(res, [delta({ content: 'note ok' }, 'stop')]);
      }
      if (mode === 'steps') {
        if (b.stream === false) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ choices: [{ message: { content: 'Goal: steps.' } }] })); }
        if (n > 46) return sse(res, [delta({ content: 'steps done' }, 'stop')]);
        return sse(res, [delta({ tool_calls: [{ index: 0, id: 'w' + n, function: { name: 'write_file', arguments: JSON.stringify({ path: 'steps.txt', content: 'x' + n }) } }] }), delta({}, 'tool_calls')]);
      }
      if (mode === 'budget') {
        if (b.stream === false) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ choices: [{ message: { content: 'Goal: test. SUMMARY-MARK' } }] })); }
        return sse(res, [delta({ tool_calls: [{ index: 0, id: 'b' + n, function: { name: 'list_dir', arguments: '{}' } }] }), delta({}, 'tool_calls'), { choices: [], usage: { prompt_tokens: 100000, completion_tokens: 10 } }]);
      }
      if (mode === 'effort-ok') return sse(res, [delta({ content: 'effort ok' }, 'stop')]);
      if (mode === 'effort-strict') {
        if ('reasoning_effort' in b) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: "Unrecognized request argument supplied: reasoning_effort" } })); }
        return sse(res, [delta({ content: 'effort dropped' }, 'stop')]);
      }
      if (mode === 'cap' && b.tools) {
        if (b.tools.length > 128) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: "'tools' : maximum number of items is 128" } })); }
        return sse(res, [delta({ content: 'cap ok' }, 'stop')]);
      }
      if (mode === 'strict' && b.tools) {
        // like Groq gpt-oss: rejects an empty `items: {}` or an untyped property
        const bad = JSON.stringify(b.tools).includes('"items":{}') || JSON.stringify(b.tools).includes('"value":{}');
        if (bad) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: "tools[12].function.parameters: invalid JSON schema (items must have a type)" } })); }
        return sse(res, [delta({ content: 'strict ok' }, 'stop')]);
      }
      if (mode === 'flaky' && b.tools) {
        flakyHits++;
        if (flakyHits <= 2) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'Failed to call a function. Please adjust your prompt. See \'failed_generation\' for more details.', code: 'tool_use_failed' } })); }
        return sse(res, [delta({ content: 'flaky ok' }, 'stop')]);
      }
      if (mode === 'notools' && b.tools) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'tools are not supported for this model' } }));
      }
      if (mode === 'notools') return sse(res, [delta({ content: 'answer without tools' }, 'stop')]);
      const lastRole = b.messages[b.messages.length - 1].role;
      if (n === 1) {
        // text + two tool calls, arguments in pieces
        return sse(res, [
          delta({ content: 'Writing the ' }),
          delta({ content: 'file.' }),
          delta({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'write_file', arguments: '{"path":"a/b.txt",' } }] }),
          delta({ tool_calls: [{ index: 0, function: { arguments: '"content":"hello"}' } }] }),
          delta({ tool_calls: [{ index: 1, id: 'c2', function: { name: 'memory_save', arguments: '{"text":"User lives in Berlin"}' } }] }),
          delta({}, 'tool_calls')
        ]);
      }
      assert.strictEqual(lastRole, 'tool');
      return sse(res, [delta({ content: 'Done.' }), delta({}, 'stop')]);
    });
  });
  await new Promise((r) => server.listen(0, r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-'));
  const mem = [];
  const events = [];
  const approvals = [];
  const base = {
    baseUrl, key: 'sk_test', model: 'm', maxTokens: 100, custom: 'CUSTOM', project: { name: 'P', instructions: 'INSTRUCTIONS' }, root,
    toolsEnabled: true, memoryEnabled: true, autoApprove: false,
    memoryApi: {
      list: () => mem,
      add: (text) => { const i = { id: 'k' + mem.length, text }; mem.push(i); return i; },
      remove: () => true
    },
    send: (e) => events.push(e),
    approve: async (info) => { approvals.push(info); return true; }
  };

  // 1) normal flow: tool call → approval → result → final answer
  await runAgent({ ...base, messages: [{ role: 'user', content: 'yaz' }] });
  assert.strictEqual(requests[0].auth, 'Bearer sk_test');
  assert.strictEqual(requests[0].url, '/v1/chat/completions');
  assert(requests[0].body.tools.some((t) => t.function.name === 'write_file'));
  assert(requests[0].body.tools.some((t) => t.function.name === 'memory_save'));
  const sys = requests[0].body.messages[0].content;
  assert(sys.includes('CUSTOM') && sys.includes('INSTRUCTIONS') && sys.includes(root));
  assert.strictEqual(fs.readFileSync(path.join(root, 'a/b.txt'), 'utf8'), 'hello');
  assert.strictEqual(approvals.length, 1);
  assert.strictEqual(approvals[0].id, 'c1');
  assert.strictEqual(mem.length, 1);
  const types = events.map((e) => e.type);
  assert.deepStrictEqual(types.filter((t) => t !== 'chunk'), ['tool:call', 'tool:result', 'tool:call', 'tool:result', 'step:new']);
  assert.strictEqual(events.filter((e) => e.type === 'chunk').map((e) => e.text).join(''), 'Writing the file.Done.');
  // the 2nd request must rebuild the history correctly
  const h = requests[1].body.messages;
  assert.strictEqual(h[2].role, 'assistant');
  assert.strictEqual(h[2].tool_calls.length, 2);
  assert.strictEqual(h[2].tool_calls[0].function.arguments, '{"path":"a/b.txt","content":"hello"}');
  assert.deepStrictEqual(h.slice(3).map((m) => m.tool_call_id), ['c1', 'c2']);
  // the system prompt must contain the current memory in the second turn
  assert(requests[1].body.messages[0].content.includes('Berlin'));

  // 2) reddedilen onay
  requests.length = 0; events.length = 0; mem.length = 0;
  fs.rmSync(path.join(root, 'a'), { recursive: true });
  await runAgent({ ...base, approve: async () => false, messages: [{ role: 'user', content: 'yaz' }] });
  assert(!fs.existsSync(path.join(root, 'a/b.txt')));
  assert(events.find((e) => e.type === 'tool:result' && e.id === 'c1').denied);

  // 3) model without tool support → retry without tools
  mode = 'notools'; requests.length = 0; events.length = 0;
  await runAgent({ ...base, messages: [{ role: 'user', content: 'hello' }] });
  assert(events.some((e) => e.type === 'notice'));
  assert.strictEqual(events.filter((e) => e.type === 'chunk').map((e) => e.text).join(''), 'answer without tools');
  assert(!requests[requests.length - 1].body.tools);

  // 3b) strict endpoint rejects the tool schema → retried with simplified schemas, tools stay on
  mode = 'strict'; requests.length = 0; events.length = 0;
  await runAgent({ ...base, messages: [{ role: 'user', content: 'hello' }] });
  assert.strictEqual(requests.length, 2);
  assert(requests[0].body.tools && requests[1].body.tools, 'tools must stay on');
  assert(!JSON.stringify(requests[1].body.tools).includes('"items":{}'));
  assert(!events.some((e) => e.type === 'notice'));
  assert.strictEqual(events.filter((e) => e.type === 'chunk').map((e) => e.text).join(''), 'strict ok');

  // 3a0) endpoint wants every content as parts: retried in that format; text-only endpoint: images are dropped with a notice
  const img = { role: 'user', content: [{ type: 'text', text: 'what is this?' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }] };
  mode = 'strict-parts'; requests.length = 0; events.length = 0;
  await runAgent({ ...base, toolsEnabled: false, messages: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi there' }, img] });
  assert.strictEqual(requests.length, 2);
  assert(requests[1].body.messages.every((m) => Array.isArray(m.content)), 'every content is a list of parts');
  assert.strictEqual(events.filter((e) => e.type === 'chunk').map((e) => e.text).join(''), 'parts ok');
  mode = 'strict-text'; requests.length = 0; events.length = 0;
  await runAgent({ ...base, toolsEnabled: false, messages: [{ role: 'user', content: 'hello' }, img] });
  assert.strictEqual(requests.length, 2);
  assert(requests[1].body.messages.every((m) => typeof m.content === 'string'));
  assert(events.some((e) => e.type === 'notice' && /cannot see images/.test(e.text)));
  assert.strictEqual(events.filter((e) => e.type === 'chunk').map((e) => e.text).join(''), 'text ok');

  // 3a) reasoning level is sent as reasoning_effort; headers of the provider ride along
  const P = require('../electron/providers');
  P.registerHeaders([{ baseUrl, headers: { 'cf-aig-gateway-id': 'default' } }]);
  mode = 'effort-ok'; requests.length = 0; events.length = 0;
  await runAgent({ ...base, reasoningEffort: 'high', toolsEnabled: false, messages: [{ role: 'user', content: 'hello' }] });
  assert.strictEqual(requests[0].body.reasoning_effort, 'high');
  assert.strictEqual(requests[0].headers['cf-aig-gateway-id'], 'default');
  requests.length = 0;
  await runAgent({ ...base, reasoningEffort: 'auto', toolsEnabled: false, messages: [{ role: 'user', content: 'hello' }] });
  assert(!('reasoning_effort' in requests[0].body), 'auto/empty sends nothing');
  P.registerHeaders([]);
  // an endpoint that rejects the field: dropped, run goes on, and it is not retried every step
  mode = 'effort-strict'; requests.length = 0; events.length = 0;
  await runAgent({ ...base, reasoningEffort: 'medium', toolsEnabled: false, messages: [{ role: 'user', content: 'hello' }] });
  assert.strictEqual(requests.length, 2);
  assert(!('reasoning_effort' in requests[1].body));
  assert(events.some((e) => e.type === 'notice' && /reasoning level/.test(e.text)));
  assert.strictEqual(events.filter((e) => e.type === 'chunk').map((e) => e.text).join(''), 'effort dropped');

  // 3b2) endpoint caps the number of tools (Groq: 128) → fewer tools are sent, tools stay on, built-in tools first
  mode = 'cap'; requests.length = 0; events.length = 0;
  const manyMcp = { definitions: () => Array.from({ length: 150 }, (_, i) => ({ type: 'function', function: { name: `mcp__srv__t${i}`, description: 'x', parameters: { type: 'object', properties: {} } } })) };
  await runAgent({ ...base, mcp: manyMcp, messages: [{ role: 'user', content: 'hello' }] });
  assert.strictEqual(requests.length, 2);
  assert(requests[0].body.tools.length > 128 && requests[1].body.tools.length === 128);
  assert(requests[1].body.tools.some((t) => t.function.name === 'write_file'), 'built-in tools kept first');
  assert.strictEqual(events.filter((e) => e.type === 'chunk').map((e) => e.text).join(''), 'cap ok');

  // 3b3) connectors on demand: only use_connector is sent first; after it is called the connector's tools join the list
  mode = 'lazy'; requests.length = 0; events.length = 0;
  const mk = (slug, tools) => tools.map((t) => ({ type: 'function', function: { name: `mcp__${slug}__${t}`, description: 'x', parameters: { type: 'object', properties: {} } } }));
  const used = new Set();
  const lazyMcp = {
    definitions: (slugs) => (Array.isArray(slugs) ? (slugs.includes('mail') ? mk('mail', ['search', 'send']) : []) : [...mk('mail', ['search', 'send']), ...mk('cal', ['list'])]),
    index: () => [{ slug: 'mail', name: 'Mail', tools: ['search', 'send'] }, { slug: 'cal', name: 'Calendar', tools: ['list'] }],
    resolveSlug: (q) => (String(q).toLowerCase() === 'mail' ? 'mail' : ''), info: () => null, call: async () => ({}),
  };
  await runAgent({ ...base, mcp: lazyMcp, mcpLazy: true, messages: [{ role: 'user', content: 'mail' }] });
  const n0 = requests[0].body.tools.map((t) => t.function.name);
  assert(n0.includes('use_connector') && !n0.some((x) => x.startsWith('mcp__')), 'no connector tools before use_connector');
  const n1 = requests[1].body.tools.map((t) => t.function.name);
  assert(n1.includes('mcp__mail__search') && !n1.includes('mcp__cal__list'), 'only the switched-on connector is sent');
  assert(/Available: mail \(Mail/.test(requests[0].body.messages[0].content), 'system prompt lists connectors');
  assert.strictEqual(events.filter((e) => e.type === 'chunk').map((e) => e.text).join(''), 'lazy ok');
  // with lazy off everything is sent at once
  requests.length = 0; events.length = 0; mode = 'cap';
  // 3b4) heavy tool groups (shell here) are sent only after use_tools
  mode = 'groups'; requests.length = 0; events.length = 0;
  await runAgent({ ...base, shellEnabled: true, lazyTools: true, messages: [{ role: 'user', content: 'ls' }] });
  const g0 = requests[0].body.tools.map((t) => t.function.name), g1 = requests[1].body.tools.map((t) => t.function.name);
  assert(g0.includes('use_tools') && !g0.includes('run_command'), 'shell tool hidden at first');
  assert(g1.includes('run_command') && !g1.includes('use_tools'), 'shell tool on after use_tools');
  assert(/More tools are switched on only when needed: shell/.test(requests[0].body.messages[0].content));
  assert.strictEqual(events.filter((e) => e.type === 'chunk').map((e) => e.text).join(''), 'groups ok');
  // off: everything at once, no use_tools
  mode = 'trim'; requests.length = 0; events.length = 0;
  await runAgent({ ...base, shellEnabled: true, lazyTools: false, messages: [{ role: 'user', content: 'ls' }] });
  const a0 = requests[0].body.tools.map((t) => t.function.name);
  assert(a0.includes('run_command') && !a0.includes('use_tools'));
  // old tool outputs are trimmed, the latest three stay whole
  requests.length = 0; events.length = 0;
  const big = 'x'.repeat(5000), hist = [{ role: 'user', content: 'q' }];
  for (let i = 0; i < 6; i++) hist.push({ role: 'assistant', content: null, tool_calls: [{ id: 't' + i, type: 'function', function: { name: 'read_file', arguments: '{}' } }] }, { role: 'tool', tool_call_id: 't' + i, content: big + i });
  hist.push({ role: 'user', content: 'sum up' });
  await runAgent({ ...base, messages: hist });
  const toolMsgs = requests[0].body.messages.filter((m) => m.role === 'tool');
  assert.strictEqual(toolMsgs.length, 6);
  assert(toolMsgs[0].content.length < 1500 && /trimmed to save tokens/.test(toolMsgs[0].content) && toolMsgs[2].content.length < 1500);
  assert(toolMsgs[3].content.length > 5000 && toolMsgs[5].content.length > 5000, 'latest three kept whole');
  // 3b-1) trimming runs in batches: two old outputs alone change nothing (an untouched prefix keeps the provider cache)
  requests.length = 0; events.length = 0;
  const few = [{ role: 'user', content: 'q' }];
  for (let i = 0; i < 5; i++) few.push({ role: 'assistant', content: null, tool_calls: [{ id: 'f' + i, type: 'function', function: { name: 'read_file', arguments: '{}' } }] }, { role: 'tool', tool_call_id: 'f' + i, content: big + i });
  few.push({ role: 'user', content: 'sum up' });
  await runAgent({ ...base, messages: few });
  assert(requests[0].body.messages.filter((m) => m.role === 'tool').every((m) => m.content.length > 5000), 'below the batch size nothing is cut');
  // 3b-2) a file that was edited later: its old read is cleared at once, and the big arguments of an applied edit are dropped
  requests.length = 0; events.length = 0;
  const stale = 'y'.repeat(9000), bigArgs = JSON.stringify({ path: 'a.js', old_str: 'o'.repeat(3000), new_str: 'n'.repeat(3000) });
  const h2 = [{ role: 'user', content: 'q' },
    { role: 'assistant', content: null, tool_calls: [{ id: 's0', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.js"}' } }] }, { role: 'tool', tool_call_id: 's0', content: stale },
    { role: 'assistant', content: null, tool_calls: [{ id: 's1', type: 'function', function: { name: 'edit_file', arguments: bigArgs } }] }, { role: 'tool', tool_call_id: 's1', content: 'Edited a.js' }];
  for (let i = 2; i < 5; i++) h2.push({ role: 'assistant', content: null, tool_calls: [{ id: 's' + i, type: 'function', function: { name: 'list_dir', arguments: '{}' } }] }, { role: 'tool', tool_call_id: 's' + i, content: 'ok' + i });
  h2.push({ role: 'user', content: 'go on' });
  await runAgent({ ...base, messages: h2 });
  const sent2 = requests[0].body.messages;
  const rd = sent2.find((m) => m.role === 'tool' && m.tool_call_id === 's0');
  assert(rd.content.length < 300 && /a\.js/.test(rd.content), 'stale read cleared: ' + rd.content);
  assert(!JSON.stringify(sent2).includes('ooooooo') && /_omitted/.test(JSON.stringify(sent2)), 'applied edit arguments dropped');
  // 3b-3) task_note stays in the system prompt at every step
  mode = 'note'; requests.length = 0; events.length = 0;
  await runAgent({ ...base, messages: [{ role: 'user', content: 'plan it' }] });
  assert(requests.length >= 2 && !/plan A/.test(requests[0].body.messages[0].content) && /plan A: do X then Y/.test(requests[1].body.messages[0].content), 'task note comes back in the system prompt');
  // 3b-4) over the token budget the run is summarized and goes on (once; without changes it then stops)
  mode = 'budget'; requests.length = 0; events.length = 0;
  const long = []; for (let i = 0; i < 4; i++) long.push({ role: 'user', content: 'u' + i }, { role: 'assistant', content: 'a' + i });
  long.push({ role: 'user', content: 'start' });
  await runAgent({ ...base, runTokenBudget: 150000, messages: long });
  const notes = events.filter((e) => e.type === 'notice').map((e) => e.text);
  assert(notes.some((t) => /summarized and it carries on/.test(t)), 'carried on after a summary: ' + notes.join(' | '));
  assert(notes.some((t) => /^Stopped:/.test(t)), 'stops when it keeps going without changes: ' + notes.join(' | '));
  assert(requests.some((r) => JSON.stringify(r.body.messages).includes('SUMMARY-MARK')), 'the summary reached the model');
  // 3b-5) the 40-step limit does not cut off a run that keeps changing things: it is summarized and goes on
  mode = 'steps'; requests.length = 0; events.length = 0;
  await runAgent({ ...base, messages: [{ role: 'user', content: 'many steps' }] });
  assert(!events.some((e) => e.type === 'notice' && /Tool loop stopped/.test(e.text)), 'no hard stop');
  assert(events.some((e) => e.type === 'notice' && /task carries on/.test(e.text)), 'carried on past 40 steps');
  assert.strictEqual(events.filter((e) => e.type === 'chunk').map((e) => e.text).join(''), 'steps done');
  mode = 'trim';
  // 3c) transient tool_use_failed is retried, tools are not switched off
  mode = 'flaky'; flakyHits = 0; requests.length = 0; events.length = 0;
  await runAgent({ ...base, messages: [{ role: 'user', content: 'hello' }] });
  assert.strictEqual(requests.length, 3);
  assert(requests.every((r) => r.body.tools));
  assert(!events.some((e) => e.type === 'notice'));
  assert.strictEqual(events.filter((e) => e.type === 'chunk').map((e) => e.text).join(''), 'flaky ok');

  // 3d) real "tools not supported" message still turns tools off and shows the reason
  mode = 'notools'; requests.length = 0; events.length = 0;
  await runAgent({ ...base, messages: [{ role: 'user', content: 'hello' }] });
  assert(events.some((e) => e.type === 'notice' && /not supported for this model/.test(e.text)));

  // 4) HTTP error message
  const bad = http.createServer((q, r) => { r.writeHead(401, { 'content-type': 'application/json' }); r.end(JSON.stringify({ error: { message: 'invalid key' } })); });
  await new Promise((r) => bad.listen(0, r));
  await assert.rejects(
    runAgent({ ...base, baseUrl: `http://127.0.0.1:${bad.address().port}`, messages: [{ role: 'user', content: 'x' }] }),
    /invalid key/
  );

  // 5) tools are not sent when tools are off
  mode = 'notools'; requests.length = 0;
  await runAgent({ ...base, toolsEnabled: false, messages: [{ role: 'user', content: 'x' }] });
  assert(!requests[0].body.tools);

  server.close(); bad.close();
  fs.rmSync(root, { recursive: true, force: true });
  console.log('agent: all tests passed');
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });

// ---- token tasarrufu: compactHistory
{
  const { compactHistory } = require('../electron/agent.js');
  const big = 'x'.repeat(60000);
  const h = [{ role: 'user', content: 'go' }];
  for (let i = 0; i < 8; i++) { h.push({ role: 'assistant', content: null, tool_calls: [{ id: 't' + i, type: 'function', function: { name: 'read_file', arguments: '{}' } }] }); h.push({ role: 'tool', tool_call_id: 't' + i, content: big }); }
  const before = JSON.stringify(h).length;
  assert.strictEqual(compactHistory(h, 20000), true);
  const after = JSON.stringify(h).length;
  assert.ok(after < before / 3, `compact ${before} -> ${after}`);
  assert.ok(h[h.length - 1].content.length === 60000, 'the last tool output must be kept');
  assert.strictEqual(compactHistory([{ role: 'user', content: 'hi' }], 20000), false);
  console.log('agent: compactHistory ok');
}


// text memory markers for servers that cannot call tools
{
  const assert = require('assert');
  const { makeTagStripper } = require('../electron/agent');
  const run = (chunks) => { const tags = []; const st = makeTagStripper((k, v) => tags.push([k, v])); let out = ''; for (const c of chunks) out += st.push(c); out += st.flush(); return { out, tags }; };
  let r = run(['Okay, I will. ', '[[remem', 'ber: Alex prefers short answers]]']);
  assert.strictEqual(r.out.trim(), 'Okay, I will.'); assert.deepStrictEqual(r.tags, [['remember', 'Alex prefers short answers']]);
  r = run(['See [[wiki link]] and [', '[forget: ab12]] done']);
  assert.strictEqual(r.out.replace(/\s+/g, ' '), 'See [[wiki link]] and done'); assert.deepStrictEqual(r.tags, [['forget', 'ab12']]);
  r = run(['array[0] and [[unclosed']);
  assert.strictEqual(r.out, 'array[0] and [[unclosed'); assert.strictEqual(r.tags.length, 0);
  const { buildSystem } = require('../electron/agent');
  assert.ok(/\[\[remember:/.test(buildSystem({ memoryEnabled: true, memory: [], hasTools: false, textMemory: true })));
  assert.ok(!/\[\[remember:/.test(buildSystem({ memoryEnabled: true, memory: [], hasTools: true })));
  const pv = require('../electron/providers');
  assert.strictEqual(pv.cannotCallTools({ name: 'Anthropic (Claude API)', baseUrl: 'http://localhost:3456/v1' }), true);
  assert.strictEqual(pv.cannotCallTools({ name: 'Anthropic (Claude API)', baseUrl: 'https://api.anthropic.com/v1' }), false);
  assert.strictEqual(pv.cannotCallTools({ name: 'Claude proxy', baseUrl: 'http://localhost:3456/v1', noTools: false }), false);
  console.log('agent: text memory markers ok');
}

// DeepSeek writes calls as <｜DSML｜invoke ...> text with extra attributes: they become real calls; a cut-off one is recognised
{
  const a = require('../electron/agent.js');
  const defs = [{ function: { name: 'create_artifact' } }];
  const D = (t) => t.replace(/<(\/?)/g, '<$1｜DSML｜');
  const full = D('<function_calls><invoke name="create_artifact"><parameter name="title" string="true">A 1</parameter><parameter name="n" string="false">5</parameter><parameter name="content" string="true"><!DOCTYPE html><p>hi</p></parameter></invoke></function_calls>').replace('<｜DSML｜/', '</｜DSML｜');
  const calls = a.parsePseudoCalls(full, defs);
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(JSON.parse(calls[0].arguments), { title: 'A 1', n: 5, content: '<!DOCTYPE html><p>hi</p>' });
  const cut = '<｜DSML｜invoke name="create_artifact"><｜DSML｜parameter name="content" string="true"><html>';
  assert.strictEqual(a.parsePseudoCalls(cut, defs).length, 0);
  assert.strictEqual(a.pseudoCallCutOff(cut), true);
  assert.strictEqual(a.pseudoCallCutOff(full), false);
  console.log('agent: DSML text calls ok');
}
