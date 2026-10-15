// Imports conversations from ChatGPT and Claude data exports (.zip or conversations.json).
const JSZip = require('jszip');

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const ms = (t) => { if (typeof t === 'number') return t < 1e12 ? t * 1000 : t; const d = Date.parse(t); return Number.isNaN(d) ? Date.now() : d; };
const user = (content, t) => ({ id: uid(), role: 'user', content, createdAt: t });
const asst = (text, t) => ({ id: uid(), role: 'assistant', steps: [{ text, toolCalls: [] }], createdAt: t });

function chatgptText(content) {
  if (!content) return '';
  const parts = Array.isArray(content.parts) ? content.parts : [];
  const out = [];
  for (const p of parts) {
    if (typeof p === 'string') { if (p.trim()) out.push(p); }
    else if (p && typeof p === 'object') {
      if (p.content_type === 'image_asset_pointer') out.push('[image]');
      else if (typeof p.text === 'string' && p.text.trim()) out.push(p.text);
    }
  }
  if (!out.length && content.content_type === 'code' && content.text) out.push('```\n' + content.text + '\n```');
  return out.join('\n\n').trim();
}

function fromChatGPT(conv) {
  const map = conv.mapping || {};
  let id = conv.current_node;
  if (!id || !map[id]) { // fall back to the last node without children
    id = Object.keys(map).find((k) => !(map[k].children || []).length) || null;
  }
  const path = [];
  const seen = new Set();
  while (id && map[id] && !seen.has(id)) { seen.add(id); path.push(map[id]); id = map[id].parent; }
  path.reverse();
  const messages = [];
  for (const node of path) {
    const m = node.message;
    if (!m || !m.author || !m.content) continue;
    if (m.metadata && m.metadata.is_visually_hidden_from_conversation) continue;
    const role = m.author.role;
    if (role !== 'user' && role !== 'assistant') continue;
    const text = chatgptText(m.content);
    if (!text) continue;
    messages.push(role === 'user' ? user(text, ms(m.create_time)) : asst(text, ms(m.create_time)));
  }
  return { key: 'chatgpt:' + (conv.conversation_id || conv.id || conv.title), title: conv.title, model: conv.default_model_slug, updated: conv.update_time || conv.create_time, messages };
}

function fromClaude(conv) {
  const messages = [];
  for (const m of conv.chat_messages || []) {
    let text = '';
    if (Array.isArray(m.content) && m.content.length) text = m.content.filter((c) => c.type === 'text' && c.text).map((c) => c.text).join('\n\n');
    if (!text) text = m.text || '';
    text = text.trim();
    if (!text) continue;
    const t = ms(m.created_at);
    messages.push(m.sender === 'human' ? user(text, t) : asst(text, t));
  }
  return { key: 'claude:' + conv.uuid, title: conv.name, messages, updated: conv.updated_at || conv.created_at };
}

/** Takes the parsed JSON of a conversations file; returns chats in the app's format. */
function convert(list, fallbackModel) {
  if (!Array.isArray(list)) throw new Error('This file does not look like a chat export.');
  const chats = [];
  let source = '';
  for (const conv of list) {
    if (!conv || typeof conv !== 'object') continue;
    let r;
    if (conv.mapping) { r = fromChatGPT(conv); source = source || 'ChatGPT'; }
    else if (conv.chat_messages) { r = fromClaude(conv); source = source || 'Claude'; }
    else continue;
    if (!r.messages.length) continue;
    chats.push({
      id: uid(), importKey: r.key, imported: r.key.split(':')[0],
      title: String(r.title || r.messages[0].content || 'Imported chat').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Imported chat',
      model: fallbackModel, projectId: null, messages: r.messages, updatedAt: ms(r.updated)
    });
  }
  if (!chats.length && !source) throw new Error('No ChatGPT or Claude conversations found in this file.');
  return { source, chats };
}

/** buffer: .zip or .json file contents. */
function isManifest(value) {
  return value && typeof value === 'object' && Array.isArray(value.data_files) && value.data_files.some((f) => f && f.export_url);
}

// Claude's account export is a manifest, not the conversation zip itself.  The
// manifest points at several single-use downloads (conversations, projects,
// memories, etc.), so download every listed file and import the useful parts.
async function parseClaudeManifest(manifest, fallbackModel, download = async (url) => {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 Chrome/131 Safari/537.36',
      accept: 'application/zip, application/octet-stream, */*'
    },
    redirect: 'follow'
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('Claude export download was denied (403). The export link requires an active Claude.ai login/session. Download the export ZIP files from the links in the manifest using your browser, then import the conversations ZIP here.');
    }
    throw new Error(`Claude export download failed (${res.status}).`);
  }
  return Buffer.from(await res.arrayBuffer());
}) {
  const files = Array.isArray(manifest.data_files) ? manifest.data_files.filter((f) => f && f.export_url) : [];
  if (!files.length) throw new Error('The Claude manifest contains no downloadable files.');
  const results = await Promise.all(files.map(async (f) => ({ ...f, buffer: await download(f.export_url) })));
  const lists = [];
  const projectRecords = [];
  const memoryRecords = [];
  for (const item of results) {
    const jsons = await readJsonFiles(item.buffer);
    for (const value of jsons) {
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) {
        if (v && typeof v === 'object' && (v.chat_messages || v.mapping)) lists.push(v);
        // Project exports have varied slightly between Claude versions. Keep
        // only records that look like a project and normalize them below.
        if (item.category === 'projects' && v && typeof v === 'object') {
          const p = v.project || v;
          if (p && (p.name || p.title) && !p.chat_messages) projectRecords.push(p);
        }
        if (item.category === 'memories') collectMemoryRecords(v, memoryRecords);
      }
    }
  }
  const out = convert(lists, fallbackModel);
  out.projects = normalizeProjects(projectRecords);
  out.memory = [...new Map(memoryRecords.filter(Boolean).map((text) => [text, { id: uid(), text: text.slice(0, 500), createdAt: Date.now() }])).values()];
  return out;
}

function collectMemoryRecords(value, out) {
  if (!value) return;
  if (typeof value === 'string' && value.trim().length > 2) { out.push(value.trim()); return; }
  if (Array.isArray(value)) { value.forEach((x) => collectMemoryRecords(x, out)); return; }
  if (typeof value !== 'object') return;
  for (const [k, v] of Object.entries(value)) {
    if (/memory|fact|remember/i.test(k)) collectMemoryRecords(v, out);
  }
}

function normalizeProjects(records) {
  const seen = new Set();
  return records.map((p) => {
    const name = String(p.name || p.title || 'Imported project').trim();
    const key = String(p.uuid || p.id || name);
    if (seen.has(key)) return null;
    seen.add(key);
    return { id: uid(), importKey: 'claude-project:' + key, name, instructions: String(p.instructions || p.description || p.prompt || '').trim(), folder: '' };
  }).filter(Boolean);
}

async function readJsonFiles(buffer) {
  const isZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (!isZip) {
    try { return [JSON.parse(buffer.toString('utf8'))]; } catch { return []; }
  }
  const zip = await JSZip.loadAsync(buffer);
  const files = Object.values(zip.files).filter((f) => !f.dir && /\.json$/i.test(f.name));
  const out = [];
  for (const f of files) {
    try { out.push(JSON.parse(await f.async('string'))); } catch {}
  }
  return out;
}

async function parseExport(buffer, fallbackModel) {
  let parsed = null;
  try { parsed = JSON.parse(buffer.toString('utf8')); } catch {}
  if (isManifest(parsed)) return parseClaudeManifest(parsed, fallbackModel);
  const values = await readJsonFiles(buffer);
  const lists = [];
  for (const value of values) {
    if (Array.isArray(value)) lists.push(...value);
    else if (value && typeof value === 'object') lists.push(value);
  }
  return convert(lists, fallbackModel);
}

module.exports = { parseExport, convert, parseClaudeManifest };
