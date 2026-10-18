// Fuzzy matching for the command palette. Pure functions, tested by scripts/test-tabs.js.

const FOLD = { 'ß': 's' };
/** Lowercase and strip accents one character at a time, so match positions stay valid for the original text. */
export function fold(s) {
  let out = '';
  for (const ch of String(s || '')) {
    if (FOLD[ch]) { out += FOLD[ch]; continue; }
    const base = ch.normalize('NFD')[0] || ch;
    const low = base.toLowerCase();
    out += low.length === 1 ? low : base.length === 1 ? base : '\u0001'; // one unit per character (emoji etc. become a placeholder)
  }
  return out;
}

const isWord = (c) => /[a-z0-9À-￿]/i.test(c || '');
/** Index where each word starts: after a separator, or a lower-to-upper case change. */
function starts(raw) {
  const a = [...String(raw || '')];
  const set = new Set();
  for (let i = 0; i < a.length; i++) {
    const prev = a[i - 1];
    if (i === 0 || !isWord(prev) || (/[a-z]/.test(prev) && /[A-Z]/.test(a[i]))) set.add(i);
  }
  return set;
}

/** Match one term against one text. Returns { score, idx } (idx: matched character positions) or null. */
function matchTerm(term, text, f, ws) {
  if (!term) return { score: 0, idx: [] };
  const n = f.length, m = term.length;
  if (m > n) return null;
  // a plain substring is the strongest kind of match
  const sub = f.indexOf(term);
  let best = null;
  if (sub >= 0) {
    let at = sub;
    for (let k = sub; k >= 0; k = f.indexOf(term, k + 1)) { if (ws.has(k)) { at = k; break; } }
    const idx = Array.from({ length: m }, (_, i) => at + i);
    let score = m * 6 + (at === 0 ? 30 : ws.has(at) ? 18 : 0) + (m === n ? 40 : 0) - Math.min(at, 20) * 0.5;
    best = { score, idx };
  }
  // otherwise a subsequence, tried from a few starting points; word starts and runs score extra
  const tries = [];
  for (let k = f.indexOf(term[0]); k >= 0 && tries.length < 12; k = f.indexOf(term[0], k + 1)) tries.push(k);
  for (const st of tries) {
    const idx = [st];
    let j = st + 1;
    for (let q = 1; q < m; q++) {
      // prefer the next word start that has this character, if there is no direct continuation
      let k = -1;
      if (f[j] === term[q]) k = j;
      else {
        for (let x = j; x < n; x++) if (f[x] === term[q] && ws.has(x)) { k = x; break; }
        if (k < 0) k = f.indexOf(term[q], j);
      }
      if (k < 0) { idx.length = 0; break; }
      idx.push(k); j = k + 1;
    }
    if (!idx.length) continue;
    let score = 0;
    for (let i = 0; i < idx.length; i++) {
      const p = idx[i];
      score += 1;
      if (p === 0) score += 8;
      else if (ws.has(p)) score += 6;
      if (i > 0 && p === idx[i - 1] + 1) score += 4;
      if (i > 0) score -= Math.min(idx[i] - idx[i - 1] - 1, 6) * 0.4;
    }
    score -= Math.min(st, 20) * 0.3;
    if (!best || score > best.score) best = { score, idx };
  }
  return best;
}

/**
 * Score a query against a label (highlighted) and optional extra text (group, keywords; matched but not highlighted).
 * Every whitespace-separated term has to match. Returns { score, idx } or null. An empty query matches with score 0.
 */
export function fuzzyScore(query, label, extra = '') {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return { score: 0, idx: [] };
  const fl = fold(label), wl = starts(label);
  const fx = fold(extra), wx = starts(extra);
  let score = 0; const all = new Set();
  for (const t of terms) {
    const a = matchTerm(t, label, fl, wl);
    if (a) { score += a.score; a.idx.forEach((i) => all.add(i)); continue; }
    const b = fx ? matchTerm(t, extra, fx, wx) : null;
    if (!b) return null;
    score += b.score * 0.5; // a keyword hit counts less than a label hit
  }
  // shorter labels win ties ("Settings" before "Settings: Providers")
  score -= Math.min(fl.length, 80) * 0.05;
  return { score, idx: [...all].sort((x, y) => x - y) };
}

/** Split text into [{ t, m }] runs for rendering; m marks matched characters. */
export function highlight(text, idx) {
  const chars = [...String(text || '')];
  const on = new Set(idx || []);
  const out = [];
  for (let i = 0; i < chars.length; i++) {
    const m = on.has(i);
    if (out.length && out[out.length - 1].m === m) out[out.length - 1].t += chars[i];
    else out.push({ t: chars[i], m });
  }
  return out;
}

/** Rank items ({ label, extra }) for a query, best first; drops the ones that do not match. Stable for equal scores. */
export function rank(query, items, get = (x) => x) {
  const out = [];
  items.forEach((it, i) => {
    const v = get(it);
    const r = fuzzyScore(query, v.label, v.extra);
    if (r) out.push({ item: it, score: r.score, idx: r.idx, i });
  });
  out.sort((a, b) => b.score - a.score || a.i - b.i);
  return out;
}
