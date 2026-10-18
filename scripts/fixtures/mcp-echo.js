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
      ...(process.env.ECHO_EXTRA ? [] : [{ name: 'echo', description: 'Echo text', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, annotations: { readOnlyHint: true } },
      { name: 'wipe', description: 'Dangerous', inputSchema: { type: 'object', properties: {} } },
      { name: 'boom', description: 'Fails', inputSchema: { type: 'object', properties: {} } }]),
      ...(process.env.ECHO_EXTRA ? [
        { name: 'my.tool v2', description: 'Odd name', inputSchema: { type: 'object', properties: {} } },
        { name: 'my_tool_v2', description: 'Collides after cleaning', inputSchema: { type: 'object', properties: {} } },
        { name: 'x'.repeat(80), description: 'Long name', inputSchema: { type: 'object', properties: {} } },
        { name: 'utf', description: 'Multibyte text', inputSchema: { type: 'object', properties: {} } },
        { name: 'pics', description: 'Two images', inputSchema: { type: 'object', properties: {} } },
        { name: 'die', description: 'Exits', inputSchema: { type: 'object', properties: {} } }
      ] : [])
    ] } });
    else if (m.method === 'tools/call') {
      const { name, arguments: a } = m.params;
      if (name === 'echo') send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'echo: ' + a.text }] } });
      else if (name === 'utf') {
        // write in odd-sized byte slices so multibyte characters straddle chunks
        const b = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'é€😀'.repeat(3000) }] } }) + '\n');
        let i = 0; const next = () => { if (i >= b.length) return; process.stdout.write(b.subarray(i, i + 7), next); i += 7; }; next();
      }
      else if (name === 'pics') send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'image', mimeType: 'image/png', data: 'AAA' }, { type: 'image', mimeType: 'image/jpeg', data: 'BBB' }] } });
      else if (name === 'die') process.exit(3);
      else if (name === 'boom') send({ jsonrpc: '2.0', id: m.id, result: { isError: true, content: [{ type: 'text', text: 'it broke' }] } });
      else send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'wiped' }] } });
    } else if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, result: {} });
  }
});
