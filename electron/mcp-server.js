// Artemis as an MCP server: other apps (Claude Code, Claude Desktop, the Claude proxy …) can control Artemis through MCP tools.
// Streamable HTTP, JSON replies only, no extra packages. It listens on 127.0.0.1 only and every request needs the bearer token.
const http = require('http');
const crypto = require('crypto');

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BODY = 1024 * 1024;

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const hostOk = (h) => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(String(h || ''));

function createMcpServer({ getToken, tools = () => [], info = { name: 'artemis', version: '1.0.0' }, log = () => {}, isLocked = () => false }) {
  let server = null, listening = 0;
  const toolList = () => (typeof tools === 'function' ? tools() : tools);

  async function handle(msg) {
    const id = msg && msg.id;
    const reply = (result) => ({ jsonrpc: '2.0', id, result });
    const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
    if (!msg || typeof msg !== 'object' || typeof msg.method !== 'string') return id !== undefined && msg && (msg.result !== undefined || msg.error) ? null : fail(-32600, 'Invalid request');
    if (id === undefined || id === null) return null; // a notification: no reply
    switch (msg.method) {
      case 'initialize': {
        const want = msg.params && msg.params.protocolVersion;
        return reply({ protocolVersion: VERSIONS.includes(want) ? want : VERSIONS[0], capabilities: { tools: { listChanged: false } }, serverInfo: info,
          instructions: 'Artemis is a desktop AI app. These tools read and change its settings, theme, providers, memory, notes and its visible terminal.' });
      }
      case 'ping': return reply({});
      case 'tools/list':
        return reply({ tools: toolList().map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema || { type: 'object', properties: {} }, ...(t.annotations ? { annotations: t.annotations } : {}) })) });
      case 'tools/call': {
        const name = msg.params && msg.params.name;
        const t = toolList().find((x) => x.name === name);
        if (!t) return fail(-32602, `Unknown tool: ${name}`);
        if (isLocked()) return reply({ content: [{ type: 'text', text: 'Artemis is locked. Unlock it on the computer first.' }], isError: true }); // the app lock stops outside apps too
        try {
          const args = (msg.params && msg.params.arguments) || {};
          log('info', `${name} ${JSON.stringify(args).slice(0, 300)}`);
          const out = await t.run(args);
          log('info', `${name} -> ${out && Array.isArray(out.__content) ? out.__content.map((c) => (c.type === 'text' ? c.text : '[' + c.type + ']')).join(' ') : String(typeof out === 'string' ? out : JSON.stringify(out)).replace(/\s+/g, ' ')}`.slice(0, 400));
          if (out && Array.isArray(out.__content)) return reply({ content: out.__content });
          const text = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
          return reply({ content: [{ type: 'text', text: text === undefined ? '' : text }] });
        } catch (e) {
          log('warn', `${name} failed: ${(e && e.message) || e}`);
          return reply({ content: [{ type: 'text', text: String((e && e.message) || e) }], isError: true });
        }
      }
      default: return fail(-32601, `Method not found: ${msg.method}`);
    }
  }

  const send = (res, code, body, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }); res.end(body === undefined ? '' : JSON.stringify(body)); };

  const onRequest = (req, res) => {
    if (!hostOk(req.headers.host)) return send(res, 403, { error: 'Forbidden host' });
    if (req.headers.origin) return send(res, 403, { error: 'Browser requests are not allowed' }); // a web page must never reach this
    const url = String(req.url || '').split('?')[0];
    if (url !== '/mcp' && url !== '/mcp/') return send(res, 404, { error: 'Not found' });
    const auth = String(req.headers.authorization || '');
    const token = getToken();
    if (!token || !/^Bearer /i.test(auth) || !safeEqual(auth.slice(7).trim(), token)) return send(res, 401, { error: 'Missing or wrong token' }, { 'www-authenticate': 'Bearer' });
    if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' }, { allow: 'POST' });
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { req.destroy(); } else chunks.push(c); });
    req.on('end', async () => {
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
      try {
        if (Array.isArray(body)) {
          const out = (await Promise.all(body.map(handle))).filter(Boolean);
          return out.length ? send(res, 200, out) : send(res, 202);
        }
        const out = await handle(body);
        return out ? send(res, 200, out) : send(res, 202);
      } catch (e) { return send(res, 500, { jsonrpc: '2.0', id: null, error: { code: -32603, message: String((e && e.message) || e) } }); }
    });
  };

  return {
    handle,
    start(port) {
      return new Promise((resolve, reject) => {
        if (server) return resolve(listening);
        const s = http.createServer(onRequest);
        s.once('error', (e) => { server = null; reject(e); });
        s.listen(port, '127.0.0.1', () => { server = s; listening = s.address().port; resolve(listening); });
      });
    },
    stop() { return new Promise((resolve) => { const s = server; server = null; listening = 0; if (!s) return resolve(); s.close(() => resolve()); try { s.closeAllConnections && s.closeAllConnections(); } catch {} }); },
    running: () => !!server,
    port: () => listening
  };
}

module.exports = { createMcpServer };
