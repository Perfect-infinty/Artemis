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

/** Models that think first and write only the closing tag (</think>): their reasoning looks like plain text until it arrives. */
export const THINK_FIRST = /deepseek|(^|[^a-z])r1([^a-z]|$)|qwq|qwen3|qwen-3|hermes|magistral|reason|think|gpt-oss|glm|kimi|minimax|nemotron|phi-4/i;

/**
 * What Sentinel may read aloud from a reply that is still streaming: no thinking blocks, and no half-written tag at the end.
 * hold = the model thinks first without an opening tag: say nothing until the closing tag shows where the thinking ended.
 */
export const STEP = '\u2063'; // marks where a new step of a run begins (after a tool call): every step may think again, with or without an opening tag

export function speechText(raw, hold = false) {
  let s = String(raw == null ? '' : raw);
  s = s.replace(/<\/?(?:t(?:h(?:i(?:n(?:k(?:i(?:n(?:g)?)?)?)?)?)?)?)?$/i, ''); // "<thi" may still become "<think>"
  const segs = s.split(STEP);
  return segs.map((seg, i) => {
    if (hold && i === segs.length - 1 && !/<\/?think(?:ing)?>/i.test(seg)) return ''; // the step that is being written may still turn out to be thinking
    return splitThink(seg).filter((p) => p.type === 'text').map((p) => p.text).join('');
  }).join(segs.length > 1 ? '\n\n' : '');
}

// ---- thinking blocks on assistant messages ----
// Reasoning streamed on its own channel ('thinking' events) is kept on the step it precedes: step.thinking = { text, start, ms, cut }.
export const THINK_CAP = 50000; // characters kept per step

/** Appends streamed reasoning to a step's thinking block (capped). New reasoning after an end clears `ms` until the next end arrives. */
export function addThinking(prev, piece, now = Date.now()) {
  const p = prev || {};
  const old = String(p.text || '');
  const add = String(piece || '');
  const room = Math.max(0, THINK_CAP - old.length);
  const out = { text: old + add.slice(0, room), start: p.start || now };
  if (p.cut || add.length > room) out.cut = true;
  return out;
}

/**
 * A step split for display: the visible text, and all of its thinking (the reasoning channel plus any <think> block still in the text,
 * e.g. older chats or a model that only wrote the closing tag). open = an unclosed <think> block in the text is still being written.
 */
export function stepParts(step) {
  const s = step || {};
  const raw = String(s.text || '');
  let text = raw, open = false;
  const extra = [];
  const tag = /<\/?think(?:ing)?>/i.exec(raw);
  if (tag && !raw.slice(0, tag.index).includes('```')) { // a tag after a code fence is most likely an example, not thinking
    const parts = splitThink(raw);
    text = parts.filter((p) => p.type === 'text').map((p) => p.text).join('').replace(/^\s+/, '');
    for (const p of parts) if (p.type === 'think') { if (p.text) extra.push(p.text); if (!p.done) open = true; }
  }
  const th = s.thinking && s.thinking.text ? s.thinking : null;
  const thinking = [th ? th.text : '', ...extra].filter(Boolean).join('\n\n');
  return { text, thinking, ms: th && typeof th.ms === 'number' ? th.ms : undefined, start: th ? th.start : undefined, open, cut: !!(th && th.cut) };
}

/** "Thought for 12s" for a finished block. */
export function thoughtLabel(ms) {
  if (typeof ms !== 'number' || !isFinite(ms)) return 'Thought process';
  const s = Math.round(ms / 1000);
  if (s < 1) return 'Thought for a moment';
  if (s < 60) return `Thought for ${s}s`;
  return `Thought for ${Math.floor(s / 60)}m ${s % 60}s`;
}

/** The last non-empty line of the thinking, for the collapsed header while it streams. */
export function lastThinkLine(text, max = 120) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const l = (lines[lines.length - 1] || '').replace(/[*_`#>]+/g, '').trim();
  return l.length > max ? '…' + l.slice(-max) : l;
}
