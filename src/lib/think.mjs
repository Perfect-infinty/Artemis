// Splits model output into plain text and <think>…</think> blocks. An unclosed block is still streaming (done: false).
export function splitThink(text) {
  let s = String(text == null ? '' : text);
  const out = [];
  // Some models (DeepSeek, Hermes) start thinking without writing the opening tag, because it is part of their prompt: everything before a lone closing tag is thinking.
  const close = /<\/think(?:ing)?>/i.exec(s), open = /<think(?:ing)?>/i.exec(s);
  if (close && (!open || close.index < open.index)) {
    const body = s.slice(0, close.index).trim();
    if (body) out.push({ type: 'think', text: body, done: true });
    s = s.slice(close.index + close[0].length);
  }
  const re = /<(think|thinking)>([\s\S]*?)(<\/\1>|$)/gi;
  let last = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ type: 'text', text: s.slice(last, m.index) });
    const body = m[2].trim(), done = !!m[3];
    if (body || !done) out.push({ type: 'think', text: body, done });
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  if (last < s.length) out.push({ type: 'text', text: s.slice(last) });
  return out;
}

/** The text without its thinking blocks: what gets copied, read aloud and sent back to the model. */
export function stripThink(text) {
  const s = String(text == null ? '' : text);
  if (!/<\/?think(ing)?>/i.test(s)) return s;
  return splitThink(s).filter((p) => p.type === 'text').map((p) => p.text).join('').trim();
}
