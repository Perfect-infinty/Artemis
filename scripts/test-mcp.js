// MCP client tests: stdio fixture + mock Streamable HTTP server. node scripts/test-mcp.js
const assert = require('assert');
const http = require('http');
const path = require('path');
const { createMcpManager, parseImport } = require('../electron/mcp');
const tools = require('../electron/tools');

(async () => {
  // HTTP mock: JSON for some methods, SSE for tools/call, requires a session id after initialize
  let sessions = 0;
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => {
      if (req.method === 'DELETE') { res.writeHead(200); return res.end(); }
      if (req.headers['x-api'] !== 'secret') { res.writeHead(401); return res.end('no'); }
      const m = JSON.parse(b);
      if (m.method === 'initialize') {
        res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'S' + ++sessions });
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-03-26', serverInfo: { name: 'h' }, capabilities: {} } }));
      }
      if (m.id === undefined) { res.writeHead(202); return res.end(); }
      assert(req.headers['mcp-session-id'] === 'S1', 'session id must be echoed');
      if (m.method === 'tools/list') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'time', description: 'Now', inputSchema: { type: 'object', properties: {} } }] } })); }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: {} })}\n\n`);
      res.write(`data: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'noon' }] } })}\n\n`);
      res.end();
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));

  const mgr = createMcpManager();
  const list = [
    { id: 'a', name: 'Echo Server', type: 'stdio', command: process.execPath, args: [path.join(__dirname, 'fixtures/mcp-echo.js')], enabled: true },
    { id: 'b', name: 'Clock', type: 'http', url: `http://127.0.0.1:${srv.address().port}/mcp`, headers: { 'x-api': 'secret' }, enabled: true },
    { id: 'c', name: 'Broken', type: 'stdio', command: 'definitely-not-a-command-xyz', enabled: true },
    { id: 'd', name: 'Off', type: 'stdio', command: 'x', enabled: false },
    { id: 'e', name: 'Bad HTTP', type: 'http', url: `http://127.0.0.1:${srv.address().port}/mcp`, headers: {}, enabled: true }
  ];
  await mgr.configure(list);
  const st = Object.fromEntries(mgr.status(list).map((s) => [s.id, s]));
  assert.strictEqual(st.a.state, 'connected'); assert.deepStrictEqual(st.a.tools, ['echo', 'wipe', 'boom']);
  assert.strictEqual(st.b.state, 'connected');
  assert.strictEqual(st.c.state, 'error'); assert(/not found/i.test(st.c.error), st.c.error);
  assert.strictEqual(st.d.state, 'off');
  assert.strictEqual(st.e.state, 'error');

  const names = mgr.definitions().map((d) => d.function.name);
  assert(names.includes('mcp__echo_server__echo') && names.includes('mcp__clock__time'), names.join());
  assert(mgr.definitions().every((d) => d.function.parameters.type === 'object'));

  let r = await mgr.call('mcp__echo_server__echo', { text: 'hi' });
  assert(r.ok && r.text === 'echo: hi');
  r = await mgr.call('mcp__echo_server__boom', {});
  assert(!r.ok && r.text === 'it broke');
  r = await mgr.call('mcp__clock__time', {});
  assert(r.ok && r.text === 'noon');

  // through tools.run: read-only tools skip approval, others ask once per run per server
  let asked = 0;
  const ctx = { mcp: mgr, session: new Set(), approve: async (i) => { asked++; assert(/^mcp:echo_server$/.test(i.category) && i.session); return true; } };
  r = await tools.run('mcp__echo_server__echo', { text: 'x' }, ctx); assert(r.ok && asked === 0);
  r = await tools.run('mcp__echo_server__wipe', {}, ctx); assert(r.ok && r.text === 'wiped' && asked === 1);
  r = await tools.run('mcp__echo_server__wipe', {}, ctx); assert(asked === 1);
  r = await tools.run('mcp__echo_server__wipe', {}, { mcp: mgr, session: new Set(), approve: async () => false }); assert(r.denied);
  r = await tools.run('mcp__nope__x', {}, ctx); assert(!r.ok);
  assert(/Connectors: echo_server \(connected/.test(r.text) && /built-in tools/.test(r.text), r.text);
  // a mangled server name still reaches the one connected tool with that name; an ambiguous or unknown tool name does not
  r = await tools.run('mcp__echoserver__echo', { text: 'typo' }, ctx); assert(r.ok && r.text === 'echo: typo', r.text);
  assert.strictEqual(mgr.info('mcp__clokc__time').server, 'clock');
  assert.strictEqual(mgr.info('mcp__clock__nothing'), null);
  assert(tools.definitions({ hasFolder: false }).every((d) => d.function.name === 'create_artifact'));

  // import
  const imp = parseImport(JSON.stringify({ mcpServers: { fs: { command: 'npx', args: ['-y', 'x'], env: { A: '1' } }, remote: { url: 'https://x/mcp', headers: { Authorization: 'Bearer t' } } } }));
  assert(imp.length === 2 && imp[0].type === 'stdio' && imp[1].type === 'http' && imp[1].headers.Authorization === 'Bearer t');
  assert.throws(() => parseImport('{"mcpServers":{}}'), /No servers/);

  mgr.close(); srv.close();
  console.log('mcp: all tests passed');
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
