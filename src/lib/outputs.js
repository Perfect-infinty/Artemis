// Derives the "Progress / Outputs / Used in this session" overview from a chat.
const FILE_TOOLS = new Set(['write_file', 'edit_file', 'write_spreadsheet', 'update_cells']);

const lastAssistant = (chat) => [...(chat.messages || [])].reverse().find((m) => m.role === 'assistant');
const callsOf = (m) => (m ? (m.steps || []).flatMap((s) => s.toolCalls || []) : []);

export function progressOf(chat) {
  const calls = callsOf(lastAssistant(chat));
  const done = calls.filter((c) => c.status === 'done' || c.status === 'error' || c.status === 'denied' || c.status === 'cancelled').length;
  return { calls, done, total: calls.length };
}

export function summarize(chat) {
  const outputs = [];
  const seen = new Set();
  const used = { uploads: [], web: 0, connectors: new Set(), memory: 0, terminal: 0, computer: 0, media: 0 };
  for (const m of chat.messages || []) {
    if (m.role === 'user') {
      for (const a of m.attachments || []) used.uploads.push(a.name);
      continue;
    }
    for (const step of m.steps || []) {
      for (const tc of step.toolCalls || []) {
        const n = tc.name;
        if (FILE_TOOLS.has(n) && tc.args?.path && tc.status === 'done' && !seen.has('f:' + tc.args.path)) {
          seen.add('f:' + tc.args.path);
          outputs.push({ kind: 'file', path: tc.args.path, name: tc.args.path.split('/').pop() });
        }
        if (n === 'web_search' || n === 'web_fetch') used.web++;
        else if (n === 'run_command') used.terminal++;
        else if (n === 'computer') used.computer++;
        else if (n === 'memory_save' || n === 'memory_forget') used.memory++;
        else if (n.startsWith('mcp__')) used.connectors.add(n.split('__')[1].replace(/_/g, ' '));
      }
      for (const it of step.media || []) {
        used.media++;
        outputs.push({ kind: 'media', path: it.path, name: it.path.split('/').pop(), media: it.kind });
      }
    }
  }
  for (const a of Object.values(chat.artifacts || {})) outputs.push({ kind: 'artifact', id: a.id, name: a.title, type: a.type });
  return { outputs, used: { ...used, connectors: [...used.connectors] } };
}
