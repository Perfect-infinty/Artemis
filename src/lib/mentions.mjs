// "@" mentions in the composer: tokens like "@artemis" or "@My Skill" that stand for a connector, skill, agent or Make.
// Pure helpers shared by the composer (highlight, Backspace), the chat bubble and the model request.

const KINDS = ['connector', 'skill', 'agent', 'make'];
const WORD = /[\p{L}\p{N}_-]/u;

/** Keeps only well-formed { kind, name } entries, without duplicates. */
export function cleanMentions(list) {
  const out = []; const seen = new Set();
  for (const m of Array.isArray(list) ? list : []) {
    if (!m || typeof m.name !== 'string' || !m.name.trim() || !KINDS.includes(m.kind)) continue;
    const k = m.kind + '\u0000' + m.name;
    if (seen.has(k)) continue;
    seen.add(k); out.push({ kind: m.kind, name: m.name });
  }
  return out;
}

/** Every "@name" token in the text that matches a mention: [{ start, end, mention }], sorted, not overlapping. Longer names win. */
export function findTokens(text, mentions) {
  const s = String(text || '');
  const list = cleanMentions(mentions).sort((a, b) => b.name.length - a.name.length);
  const hits = [];
  for (const m of list) {
    const tok = '@' + m.name;
    let i = s.indexOf(tok);
    while (i >= 0) {
      const end = i + tok.length;
      const okBefore = i === 0 || /\s/.test(s[i - 1]);
      const okAfter = end >= s.length || !WORD.test(s[end]);
      if (okBefore && okAfter && !hits.some((h) => i < h.end && end > h.start)) hits.push({ start: i, end, mention: m });
      i = s.indexOf(tok, i + 1);
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

/** Splits the text into plain parts and mention parts: [{ text, mention? }]. */
export function splitMentions(text, mentions) {
  const s = String(text || '');
  const out = []; let at = 0;
  for (const h of findTokens(s, mentions)) {
    if (h.start > at) out.push({ text: s.slice(at, h.start) });
    out.push({ text: s.slice(h.start, h.end), mention: h.mention });
    at = h.end;
  }
  if (at < s.length || !out.length) out.push({ text: s.slice(at) });
  return out;
}

/** The mentions (from the list) that still appear as a token in the text. */
export function liveMentions(text, mentions) {
  return cleanMentions(findTokens(text, mentions).map((h) => h.mention));
}

/** For Backspace: the range to delete when the caret sits right after a token (or after the token and one space), else null. */
export function tokenBefore(text, caret, mentions) {
  const s = String(text || '');
  for (const h of findTokens(s, mentions)) {
    if (caret === h.end) return { start: h.start, end: h.end };
    if (caret === h.end + 1 && s[h.end] === ' ') return { start: h.start, end: h.end + 1 };
  }
  return null;
}

/** One line for the model saying what the user picked in the "@" menu. Empty when nothing was picked. */
export function mentionHint(mentions) {
  const parts = cleanMentions(mentions).map((m) => (
    m.kind === 'make' ? 'Make — use the Make tools'
      : m.kind === 'skill' ? `the "${m.name}" skill — load it with use_skill first`
        : m.kind === 'agent' ? `the "${m.name}" agent — delegate to it`
          : `the "${m.name}" connector — use its tools for this request`
  ));
  return parts.length ? `[The user selected: ${parts.join('; ')}]` : '';
}
