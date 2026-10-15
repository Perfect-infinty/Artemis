// Tiny MCP server over stdio for tests.
let buf = '';
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    const m = JSON.parse(line);
    if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'echo', version: '1' } } });
    else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: [
      { name: 'echo', description: 'Echo text', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, annotations: { readOnlyHint: true } },
      { name: 'wipe', description: 'Dangerous', inputSchema: { type: 'object', properties: {} } },
      { name: 'boom', description: 'Fails', inputSchema: { type: 'object', properties: {} } }
    ] } });
    else if (m.method === 'tools/call') {
      const { name, arguments: a } = m.params;
      if (name === 'echo') send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'echo: ' + a.text }] } });
      else if (name === 'boom') send({ jsonrpc: '2.0', id: m.id, result: { isError: true, content: [{ type: 'text', text: 'it broke' }] } });
      else send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'wiped' }] } });
    } else if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, result: {} });
  }
});
