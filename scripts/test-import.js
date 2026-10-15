const assert = require('assert'), JSZip = require('jszip');
const { parseExport } = require('../electron/importer');
const gpt = [{
  title: 'Trip plan', conversation_id: 'c1', update_time: 1700000000, current_node: 'a2',
  mapping: {
    root: { id: 'root', parent: null, children: ['s'], message: null },
    s: { id: 's', parent: 'root', children: ['u1'], message: { author: { role: 'system' }, content: { content_type: 'text', parts: [''] } } },
    u1: { id: 'u1', parent: 's', children: ['a1', 'a1b'], message: { author: { role: 'user' }, create_time: 1699999990, content: { content_type: 'text', parts: ['Plan a trip to Lisbon'] } } },
    a1b: { id: 'a1b', parent: 'u1', children: [], message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['discarded branch'] } } },
    a1: { id: 'a1', parent: 'u1', children: ['t', 'u2'], message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Sure! Day 1...'] } } },
    t: { id: 't', parent: 'a1', children: [], message: { author: { role: 'tool' }, content: { content_type: 'text', parts: ['tool noise'] } } },
    u2: { id: 'u2', parent: 'a1', children: ['a2'], message: { author: { role: 'user' }, content: { content_type: 'multimodal_text', parts: [{ content_type: 'image_asset_pointer' }, 'what is this?'] } } },
    a2: { id: 'a2', parent: 'u2', children: [], message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['A bridge.'] } } }
  }
}, { title: 'empty', mapping: { r: { id: 'r', parent: null, children: [], message: null } } }];
const claude = [{ uuid: 'x1', name: 'Hello', updated_at: '2026-01-02T10:00:00Z', chat_messages: [
  { sender: 'human', text: 'hi', created_at: '2026-01-02T09:00:00Z' },
  { sender: 'assistant', text: 'old', content: [{ type: 'text', text: 'Hello there' }], created_at: '2026-01-02T09:00:05Z' }] }];
(async () => {
  let r = await parseExport(Buffer.from(JSON.stringify(gpt)), 'm/x');
  assert.strictEqual(r.source, 'ChatGPT'); assert.strictEqual(r.chats.length, 1);
  const c = r.chats[0];
  assert.deepStrictEqual(c.messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.strictEqual(c.messages[0].content, 'Plan a trip to Lisbon');
  assert.strictEqual(c.messages[2].content, '[image]\n\nwhat is this?');
  assert.strictEqual(c.messages[3].steps[0].text, 'A bridge.');
  assert.strictEqual(c.importKey, 'chatgpt:c1'); assert.strictEqual(c.title, 'Trip plan');
  const zip = new JSZip(); zip.file('export/conversations.json', JSON.stringify(claude)); zip.file('export/users.json', '[]');
  r = await parseExport(await zip.generateAsync({ type: 'nodebuffer' }), 'm/x');
  assert.strictEqual(r.source, 'Claude'); assert.strictEqual(r.chats[0].messages[1].steps[0].text, 'Hello there');
  await assert.rejects(parseExport(Buffer.from('{"a":1}'), 'm'), /No ChatGPT or Claude/);
  await assert.rejects(parseExport(Buffer.from('[{"foo":1}]'), 'm'), /No ChatGPT or Claude/);
  console.log('import: all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
